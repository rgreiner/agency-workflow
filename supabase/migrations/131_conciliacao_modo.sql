-- 131_conciliacao_modo.sql
-- Conciliação banco × Flow: registrar COMO o casamento foi feito.
--
-- A tela mostra "Conciliado" e pronto — não dá pra saber se foi a máquina que
-- casou sozinha (sugestão aceita em lote) ou se alguém escolheu na mão. Quem
-- confere o extrato precisa dessa distinção: o casamento automático é o que
-- merece um segundo olhar.
--
-- CUIDADO: o PostgREST self-hosted é estrito com overload (1 assinatura por RPC),
-- então a versão de 3 args é DROPADA antes de criar a de 4 — não dá pra só
-- adicionar o parâmetro com default, isso criaria uma segunda assinatura e
-- quebraria a chamada por HTTP.
-- Idempotente.

alter table btg_movements add column if not exists conciliado_modo text;   -- 'auto' | 'manual' | null (legado)
alter table btg_movements add column if not exists conciliado_em  timestamptz;
alter table btg_movements add column if not exists conciliado_por uuid references profiles(id) on delete set null;

-- ── Conciliar N lançamentos com 1 movimento, agora gravando o modo ──────────
drop function if exists conciliar_btg_multi(uuid, uuid, jsonb);

create or replace function conciliar_btg_multi(
  p_user_id uuid, p_movement_id uuid, p_itens jsonb, p_modo text default 'manual'
) returns void language plpgsql security definer set search_path = public as $$
declare m record; l record; v_sum numeric := 0; v_count int; v_saldo numeric; r record;
begin
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

  for r in select (x->>'lancamento_id')::uuid as lanc, (x->>'valor')::numeric as valor
           from jsonb_array_elements(p_itens) x loop
    select * into l from lancamentos where id = r.lanc and org_id = m.org_id;
    if not found then raise exception 'Lançamento não encontrado'; end if;
    if (m.tipo = 'credit' and l.tipo <> 'entrada') or (m.tipo = 'debit' and l.tipo <> 'saida') then
      raise exception 'Lançamento com natureza incompatível com o movimento';
    end if;
    if r.valor <= 0 then raise exception 'Valor aplicado inválido'; end if;
    -- saldo do lançamento desconsiderando este movimento (permite reconciliar/atualizar)
    select l.valor - coalesce((
      select sum(i.valor) from btg_conciliacao_itens i
      where i.lancamento_id = r.lanc and i.movement_id <> p_movement_id
    ), 0) into v_saldo;
    if r.valor > v_saldo + 0.01 then raise exception 'Valor aplicado maior que o saldo do lançamento'; end if;

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
end; $$;

-- Compat 1:1 — sempre manual (é sempre alguém clicando).
create or replace function conciliar_btg_movimento(p_user_id uuid, p_movement_id uuid, p_lancamento_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m record;
begin
  select * into m from btg_movements where id = p_movement_id;
  if not found then raise exception 'Movimento não encontrado'; end if;
  perform conciliar_btg_multi(
    p_user_id, p_movement_id,
    jsonb_build_array(jsonb_build_object('lancamento_id', p_lancamento_id, 'valor', m.valor)),
    'manual'
  );
end; $$;

-- Desfazer tem que limpar o modo junto, senão o movimento volta pra pendente
-- carregando o selo da conciliação antiga.
create or replace function desfazer_conciliacao_btg(p_user_id uuid, p_movement_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m record; v_lancs uuid[]; v_lanc uuid;
begin
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
end; $$;

grant execute on function conciliar_btg_multi(uuid, uuid, jsonb, text) to anon, authenticated;
grant execute on function conciliar_btg_movimento(uuid, uuid, uuid) to anon, authenticated;
grant execute on function desfazer_conciliacao_btg(uuid, uuid) to anon, authenticated;

-- Os 8 movimentos já conciliados ficam com modo NULL de propósito: não sabemos
-- como foram feitos, e chutar 'manual' seria inventar histórico. A tela mostra
-- só "Conciliado" quando o modo é desconhecido.

notify pgrst, 'reload schema';
