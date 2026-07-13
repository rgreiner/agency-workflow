-- 107_btg_conciliacao_itens.sql
-- Estágio 3 da conciliação BTG: um movimento do banco pode quitar VÁRIOS lançamentos
-- (Pix de R$5.000 = 2 notas de R$2.500) e um lançamento pode ser quitado em VÁRIOS
-- movimentos (baixa parcial). O FK 1:1 de btg_movements.lancamento_id não modela isso,
-- então a verdade passa a ser esta tabela de ligação (movimento ↔ lançamento + o valor
-- aplicado em cada). Regra central: a soma dos itens de um movimento tem que bater 100%
-- com o valor do movimento — validada no servidor, não só no front. Idempotente.

create table if not exists btg_conciliacao_itens (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organizations(id) on delete cascade,
  movement_id   uuid not null references btg_movements(id) on delete cascade,
  lancamento_id uuid not null references lancamentos(id) on delete cascade,
  valor         numeric(14,2) not null,   -- quanto DESTE movimento foi aplicado neste lançamento
  created_by    uuid,
  created_at    timestamptz not null default now(),
  unique (movement_id, lancamento_id)
);
create index if not exists idx_conc_itens_mov  on btg_conciliacao_itens(movement_id);
create index if not exists idx_conc_itens_lanc on btg_conciliacao_itens(lancamento_id);

alter table btg_conciliacao_itens enable row level security;
drop policy if exists "Finance read conc itens" on btg_conciliacao_itens;
create policy "Finance read conc itens" on btg_conciliacao_itens
  for select using (
    exists (
      select 1 from organization_members om
      where om.org_id = btg_conciliacao_itens.org_id
        and om.user_id = auth.uid()
        and (om.can_finance or om.role in ('owner','admin'))
    )
  );
-- Escrita só via RPC (security definer); sem policy de insert/update/delete.

-- ── Recalcula a situação de um lançamento a partir dos itens conciliados ──────
-- Sem baixa → em_aberto. Baixa total (aplicado ≥ valor) → recebido/pago com
-- data_liquidacao/valor_realizado. Baixa parcial → segue em_aberto, mas grava o
-- valor_realizado acumulado (o saldo = valor − valor_realizado é o que falta casar).
create or replace function _recompute_lanc_conciliacao(p_lanc uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l record; v_aplicado numeric; v_last date;
begin
  select * into l from lancamentos where id = p_lanc;
  if not found then return; end if;

  select coalesce(sum(i.valor), 0), max(m.data_mov)
    into v_aplicado, v_last
    from btg_conciliacao_itens i
    join btg_movements m on m.id = i.movement_id
    where i.lancamento_id = p_lanc;

  if v_aplicado <= 0.005 then
    update lancamentos set situacao = 'em_aberto', valor_realizado = null, data_liquidacao = null, updated_at = now()
    where id = p_lanc;
  elsif v_aplicado >= l.valor - 0.005 then
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
end; $$;

-- ── Conciliar N lançamentos com 1 movimento (valida a soma = 100% do movimento) ──
create or replace function conciliar_btg_multi(p_user_id uuid, p_movement_id uuid, p_itens jsonb)
returns void language plpgsql security definer set search_path = public as $$
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
    lancamento_id = case when v_count = 1 then (p_itens->0->>'lancamento_id')::uuid else null end,
    updated_at = now()
  where id = p_movement_id;
end; $$;

-- ── Conciliar 1:1 (compat): delega pro multi com um único item = valor do movimento ──
create or replace function conciliar_btg_movimento(p_user_id uuid, p_movement_id uuid, p_lancamento_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m record;
begin
  select * into m from btg_movements where id = p_movement_id;
  if not found then raise exception 'Movimento não encontrado'; end if;
  perform conciliar_btg_multi(
    p_user_id, p_movement_id,
    jsonb_build_array(jsonb_build_object('lancamento_id', p_lancamento_id, 'valor', m.valor))
  );
end; $$;

-- ── Desfazer: remove os itens do movimento e recalcula cada lançamento afetado ──
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

  update btg_movements set status = 'pendente', lancamento_id = null, updated_at = now()
  where id = p_movement_id;
end; $$;

grant execute on function _recompute_lanc_conciliacao(uuid) to anon, authenticated;
grant execute on function conciliar_btg_multi(uuid, uuid, jsonb) to anon, authenticated;
grant execute on function conciliar_btg_movimento(uuid, uuid, uuid) to anon, authenticated;
grant execute on function desfazer_conciliacao_btg(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
