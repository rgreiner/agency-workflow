-- 190_conciliacao_encargos.sql
-- Auditoria 02/08, Financeiro #2: "Conciliação não fecha com diferença de
-- juros/multa e não vê título baixado na mão".
--
-- Hoje o par banco × Flow exige soma IDÊNTICA ao movimento. Boleto pago com
-- juros, recebimento com tarifa descontada ou desconto concedido na hora —
-- qualquer centavo de diferença obriga a sair da tela, baixar o título na mão e
-- só então voltar. Pior: título já baixado na mão nem aparece como candidato,
-- então o movimento fica pendente para sempre.
--
-- Convenção adotada é a MESMA do liquidar_lancamento (que já grava esses quatro
-- campos): valor_realizado = valor + juros + multa − desconto − tarifa.
-- Em `btg_conciliacao_itens.valor` continua indo o DINHEIRO QUE PASSOU NO BANCO
-- (por isso a soma dos itens segue tendo que bater 100% com o movimento) — o que
-- os encargos explicam é por que esse dinheiro difere da face do título.
--
-- Medido antes de escrever: 0 lançamentos com juros/multa/desconto/tarifa ≠ 0,
-- então a mudança de fórmula abaixo não reclassifica nada do que já existe.
--
-- Idempotente.

-- ── O que conta como "título quitado" ───────────────────────────────────────
-- Antes: aplicado >= valor. Agora o desconto e a tarifa TAMBÉM abatem a dívida
-- (o cliente pagou menos porque combinamos assim), e juros/multa NÃO contam como
-- pagamento da face (é dinheiro a mais que entrou, não abate nada).
-- Sem isso, título recebido com R$ 2 de tarifa ficava eternamente "faltando R$ 2".
create or replace function _recompute_lanc_conciliacao(p_lanc uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l record; v_aplicado numeric; v_coberto numeric; v_last date;
begin
  select * into l from lancamentos where id = p_lanc;
  if not found then return; end if;

  select coalesce(sum(i.valor), 0), max(m.data_mov)
    into v_aplicado, v_last
    from btg_conciliacao_itens i
    join btg_movements m on m.id = i.movement_id
    where i.lancamento_id = p_lanc;

  v_coberto := v_aplicado
             + coalesce(l.desconto, 0) + coalesce(l.tarifa, 0)
             - coalesce(l.juros, 0)    - coalesce(l.multa, 0);

  if v_aplicado <= 0.005 then
    update lancamentos set situacao = 'em_aberto', valor_realizado = null, data_liquidacao = null, updated_at = now()
    where id = p_lanc;
  elsif v_coberto >= l.valor - 0.005 then
    update lancamentos set
      situacao = case when l.tipo = 'entrada' then 'recebido' else 'pago' end,
      valor_realizado = v_aplicado,
      data_liquidacao = coalesce(v_last, current_date),
      updated_at = now()
    where id = p_lanc;
  else
    update lancamentos set situacao = 'em_aberto', valor_realizado = v_aplicado, data_liquidacao = null, updated_at = now()
    where id = p_lanc;
  end if;
end $$;

-- ── Conciliar com encargos ──────────────────────────────────────────────────
-- Os encargos viajam DENTRO de p_itens (mesma assinatura de antes — o PostgREST
-- self-hosted não tolera overload). Cada item aceita juros/multa/desconto/tarifa
-- opcionais; ausentes = não mexe no que o lançamento já tem.
create or replace function conciliar_btg_multi(
  p_user_id uuid, p_movement_id uuid, p_itens jsonb, p_modo text default 'manual'
) returns void language plpgsql security definer set search_path = public as $$
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

  -- O dinheiro do banco continua tendo que ser 100% distribuído entre os títulos.
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

    -- Saldo do título desconsiderando este movimento (permite reconciliar).
    select l.valor - coalesce((
      select sum(i.valor) from btg_conciliacao_itens i
      where i.lancamento_id = r.lanc and i.movement_id <> p_movement_id
    ), 0) into v_saldo;

    -- Quanto da FACE do título este movimento cobre: o dinheiro que passou, mais
    -- o que foi perdoado (desconto/tarifa), menos o que era acréscimo (juros/multa).
    v_coberto := r.valor + r.desconto + r.tarifa - r.juros - r.multa;
    if v_coberto > v_saldo + 0.01 then
      raise exception 'Valor aplicado (R$ %) maior que o saldo do lançamento (R$ %) — se a diferença for juros ou multa, declare o encargo',
        v_coberto, v_saldo;
    end if;

    -- Encargo só é gravado quando declarado: título baixado na mão com desconto
    -- e depois conciliado não pode ter o desconto zerado pela conciliação.
    if r.tem_encargo then
      update lancamentos
         set juros = r.juros, multa = r.multa, desconto = r.desconto, tarifa = r.tarifa, updated_at = now()
       where id = r.lanc;
    end if;

    insert into btg_conciliacao_itens (org_id, movement_id, lancamento_id, valor, created_by)
      values (m.org_id, p_movement_id, r.lanc, r.valor, p_user_id)
      on conflict (movement_id, lancamento_id) do update set valor = excluded.valor;
    perform _recompute_lanc_conciliacao(r.lanc);
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

-- ── Desfazer: encargo é atributo da baixa, some junto com ela ───────────────
create or replace function desfazer_conciliacao_btg(p_user_id uuid, p_movement_id uuid)
returns void language plpgsql security definer set search_path = public as $$
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
      perform _recompute_lanc_conciliacao(v_lanc);
      -- Voltou pra em_aberto = não há mais baixa; juros/desconto daquela baixa
      -- não podem ficar pendurados (o próximo cálculo os leria como abatimento).
      update lancamentos set juros = 0, multa = 0, desconto = 0, tarifa = 0
       where id = v_lanc and situacao = 'em_aberto' and valor_realizado is null;
    end loop;
  end if;

  -- Legado: conciliações antigas gravaram só o FK direto, sem itens de ligação.
  if m.lancamento_id is not null and (v_lancs is null or not (m.lancamento_id = any(v_lancs))) then
    perform _recompute_lanc_conciliacao(m.lancamento_id);
  end if;

  update btg_movements set
    status = 'pendente', lancamento_id = null,
    conciliado_modo = null, conciliado_em = null, conciliado_por = null,
    updated_at = now()
  where id = p_movement_id;
end $$;

revoke execute on function conciliar_btg_multi(uuid, uuid, jsonb, text) from public, anon;
revoke execute on function desfazer_conciliacao_btg(uuid, uuid)         from public, anon;
grant  execute on function conciliar_btg_multi(uuid, uuid, jsonb, text) to authenticated;
grant  execute on function desfazer_conciliacao_btg(uuid, uuid)         to authenticated;

notify pgrst, 'reload schema';
