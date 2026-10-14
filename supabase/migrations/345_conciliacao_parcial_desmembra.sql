-- Conciliação parcial vira DOIS lançamentos: o pago e o saldo em aberto.
--
-- Caso real (14/10/2026): a Distribuição de Lucros de agosto estava prevista em
-- R$ 20.000 e saiu um Pix de R$ 12.000. A conciliação gravou valor_realizado =
-- 12.000 e deixou o título 'em_aberto' (faltavam 8 mil). Só que saldo da conta,
-- fluxo e DRE contam realizado só de título pago/recebido: os 12 mil que saíram
-- do banco sumiram de todos eles, e o Flow ficou R$ 12 mil acima do extrato por
-- seis semanas. Meio-pago é um estado que nenhuma tela sabe ler.
--
-- Regra do Rafael: o título se divide. O original fica com o valor coberto e
-- vira pago/recebido; nasce um irmão com o que falta, em aberto, no mesmo
-- vencimento, ligado ao original por `desmembrado_de`. Desfazer a conciliação
-- junta os dois de volta — desde que o irmão não tenha sido mexido (baixado,
-- conciliado). Mexido, ele já é um título com vida própria e fica.

alter table lancamentos add column if not exists desmembrado_de uuid references lancamentos(id) on delete set null;
comment on column lancamentos.desmembrado_de is
  'Saldo em aberto que nasceu de uma conciliação parcial: aponta o título original (que ficou com a parte paga).';

-- Divide o título se, depois da conciliação, ele ficou parcialmente coberto.
create or replace function _desmembrar_parcial(p_lanc uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare l lancamentos%rowtype; v_aplicado numeric; v_coberto numeric; v_resto numeric; v_novo uuid;
begin
  select * into l from lancamentos where id = p_lanc;
  if not found or l.situacao <> 'em_aberto' or coalesce(l.valor_realizado, 0) <= 0 then return null; end if;

  select coalesce(sum(valor), 0) into v_aplicado from btg_conciliacao_itens where lancamento_id = p_lanc;
  v_coberto := v_aplicado + coalesce(l.desconto, 0) + coalesce(l.tarifa, 0) - coalesce(l.juros, 0) - coalesce(l.multa, 0);
  v_resto := round(l.valor - v_coberto, 2);
  if v_aplicado <= 0.005 or v_resto <= 0.005 then return null; end if;

  -- O irmão copia o título inteiro (categoria, centro de custo, contato, documento
  -- de origem, parcela) e zera o que é da baixa. origem_ref não vai junto: ela
  -- amarra UMA linha do extrato importado, e duas linhas com a mesma ref seriam
  -- descartadas juntas pela regra de dupla contagem.
  v_novo := gen_random_uuid();
  l.id := v_novo;
  l.valor := v_resto;
  l.valor_realizado := null;
  l.data_liquidacao := null;
  l.juros := 0; l.multa := 0; l.desconto := 0; l.tarifa := 0;
  l.origem_ref := null;
  l.desmembrado_de := p_lanc;
  l.created_at := now(); l.updated_at := now();
  insert into lancamentos select l.*;

  update lancamentos set valor = round(v_coberto, 2), updated_at = now() where id = p_lanc;
  perform _recompute_lanc_conciliacao(p_lanc);
  return v_novo;
end $$;

-- Junta de volta o saldo intocado ao original (usado ao desfazer a conciliação).
create or replace function _rejuntar_desmembrado(p_lanc uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare f record;
begin
  for f in
    select id, valor from lancamentos x
     where x.desmembrado_de = p_lanc and x.situacao = 'em_aberto' and x.valor_realizado is null
       and not exists (select 1 from btg_conciliacao_itens i where i.lancamento_id = x.id)
       and not exists (select 1 from btg_movements b where b.lancamento_id = x.id)
  loop
    update lancamentos set valor = valor + f.valor, updated_at = now() where id = p_lanc;
    delete from lancamentos where id = f.id;
  end loop;
end $$;

-- conciliar_btg_multi: idêntica à que estava no ar, + o desmembramento no fim.
create or replace function conciliar_btg_multi(p_user_id uuid, p_movement_id uuid, p_itens jsonb, p_modo text default 'manual')
returns void
language plpgsql security definer set search_path = public as $$
declare
  m record; l record; v_sum numeric := 0; v_count int; v_saldo numeric; v_coberto numeric; r record;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into m from btg_movements where id = p_movement_id;
  if not found then raise exception 'Movimento não encontrado'; end if;
  if not exists (
    select 1 from organization_members
    where org_id = m.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  if m.status = 'conciliado' then raise exception 'Movimento já conciliado'; end if;

  v_count := coalesce(jsonb_array_length(p_itens), 0);
  if v_count = 0 then raise exception 'Selecione ao menos um lançamento'; end if;

  select coalesce(sum((x->>'valor')::numeric), 0) into v_sum from jsonb_array_elements(p_itens) x;
  if abs(v_sum - m.valor) > 0.01 then
    raise exception 'A soma dos lançamentos (R$ %) não confere com o movimento (R$ %)', v_sum, m.valor;
  end if;

  for r in
    select (x->>'lancamento_id')::uuid as lanc,
           (x->>'valor')::numeric      as valor,
           coalesce(nullif(x->>'juros',    '')::numeric, 0) as juros,
           coalesce(nullif(x->>'multa',    '')::numeric, 0) as multa,
           coalesce(nullif(x->>'desconto', '')::numeric, 0) as desconto,
           coalesce(nullif(x->>'tarifa',   '')::numeric, 0) as tarifa,
           (x ?| array['juros','multa','desconto','tarifa'])  as tem_encargo
      from jsonb_array_elements(p_itens) x
  loop
    select * into l from lancamentos where id = r.lanc and org_id = m.org_id;
    if not found then raise exception 'Lançamento não encontrado'; end if;
    if (m.tipo = 'credit' and l.tipo <> 'entrada') or (m.tipo = 'debit' and l.tipo <> 'saida') then
      raise exception 'Lançamento com natureza incompatível com o movimento';
    end if;
    if r.valor <= 0 then raise exception 'Valor aplicado inválido'; end if;
    if r.juros < 0 or r.multa < 0 or r.desconto < 0 or r.tarifa < 0 then
      raise exception 'Encargo negativo — use juros/multa para o que entrou a mais e desconto/tarifa para o que entrou a menos';
    end if;

    select l.valor - coalesce((
      select sum(i.valor) from btg_conciliacao_itens i
      where i.lancamento_id = r.lanc and i.movement_id <> p_movement_id
    ), 0) into v_saldo;

    v_coberto := r.valor + r.desconto + r.tarifa - r.juros - r.multa;
    if v_coberto > v_saldo + 0.01 then
      raise exception 'Valor aplicado (R$ %) maior que o saldo do lançamento (R$ %) — se a diferença for juros ou multa, declare o encargo',
        v_coberto, v_saldo;
    end if;

    if r.tem_encargo then
      update lancamentos
         set juros = r.juros, multa = r.multa, desconto = r.desconto, tarifa = r.tarifa, updated_at = now()
       where id = r.lanc;
    end if;

    insert into btg_conciliacao_itens (org_id, movement_id, lancamento_id, valor, created_by)
      values (m.org_id, p_movement_id, r.lanc, r.valor, p_user_id)
      on conflict (movement_id, lancamento_id) do update set valor = excluded.valor;
    perform _recompute_lanc_conciliacao(r.lanc);
    -- Ficou meio-pago? Vira pago + saldo em aberto (mig. 345).
    perform _desmembrar_parcial(r.lanc);
  end loop;

  update btg_movements set
    status = 'conciliado',
    conciliado_modo = case when p_modo = 'auto' then 'auto' else 'manual' end,
    conciliado_em = now(),
    conciliado_por = p_user_id,
    lancamento_id = case when v_count = 1 then (p_itens->0->>'lancamento_id')::uuid else null end,
    updated_at = now()
  where id = p_movement_id;
end $$;

-- desfazer_conciliacao_btg: idêntica à que estava no ar, + rejuntar o saldo.
create or replace function desfazer_conciliacao_btg(p_user_id uuid, p_movement_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare m record; v_lancs uuid[]; v_lanc uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into m from btg_movements where id = p_movement_id;
  if not found then raise exception 'Movimento não encontrado'; end if;
  if not exists (
    select 1 from organization_members
    where org_id = m.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  select array_agg(distinct lancamento_id) into v_lancs
    from btg_conciliacao_itens where movement_id = p_movement_id;
  delete from btg_conciliacao_itens where movement_id = p_movement_id;

  if v_lancs is not null then
    foreach v_lanc in array v_lancs loop
      -- Antes de recalcular: o saldo que nasceu desta conciliação volta para o original.
      perform _rejuntar_desmembrado(v_lanc);
      perform _recompute_lanc_conciliacao(v_lanc);
      update lancamentos set juros = 0, multa = 0, desconto = 0, tarifa = 0
       where id = v_lanc and situacao = 'em_aberto' and valor_realizado is null;
    end loop;
  end if;

  if m.lancamento_id is not null and (v_lancs is null or not (m.lancamento_id = any(v_lancs))) then
    perform _rejuntar_desmembrado(m.lancamento_id);
    perform _recompute_lanc_conciliacao(m.lancamento_id);
  end if;

  update btg_movements set
    status = 'pendente', lancamento_id = null,
    conciliado_modo = null, conciliado_em = null, conciliado_por = null,
    updated_at = now()
  where id = p_movement_id;
end $$;

-- Helpers internos: ninguém de fora chama.
revoke execute on function _desmembrar_parcial(uuid) from public, anon, authenticated;
revoke execute on function _rejuntar_desmembrado(uuid) from public, anon, authenticated;
revoke execute on function conciliar_btg_multi(uuid, uuid, jsonb, text) from public, anon;
grant execute on function conciliar_btg_multi(uuid, uuid, jsonb, text) to authenticated;
revoke execute on function desfazer_conciliacao_btg(uuid, uuid) from public, anon;
grant execute on function desfazer_conciliacao_btg(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
