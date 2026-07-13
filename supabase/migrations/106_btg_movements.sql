-- 106_btg_movements.sql
-- Estágio 2 da integração BTG: movimentos sincronizados do extrato + conciliação
-- com `lancamentos`. Tabela própria (não reaproveita extrato_importado, que é
-- moldado no formato da Conta Azul) — snapshot do banco, casado manualmente/
-- automaticamente com o livro-caixa. RLS igual extrato_importado (só can_finance/
-- owner/admin leem; escrita só via RPC). Idempotente.

create table if not exists btg_movements (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organizations(id) on delete cascade,
  btg_id        text not null,               -- movement.id (chave de dedup)
  end_to_end_id text,                        -- id do Pix, quando houver
  tipo          text not null,               -- 'credit' | 'debit' (como vem do BTG)
  valor         numeric(14,2) not null,      -- sempre positivo
  data_mov      date not null,
  descricao     text,
  categoria     text,
  raw           jsonb not null default '{}'::jsonb,
  lancamento_id uuid references lancamentos(id) on delete set null,
  status        text not null default 'pendente',  -- pendente | conciliado | ignorado
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists uq_btg_mov on btg_movements(org_id, btg_id);
create index if not exists idx_btg_mov_org_status on btg_movements(org_id, status);

alter table btg_movements enable row level security;

drop policy if exists "Finance read btg_movements" on btg_movements;
create policy "Finance read btg_movements" on btg_movements
  for select using (
    exists (
      select 1 from organization_members om
      where om.org_id = btg_movements.org_id
        and om.user_id = auth.uid()
        and (om.can_finance or om.role in ('owner','admin'))
    )
  );
-- Escrita só via RPC (security definer); sem policy de insert/update/delete.

-- ── Sync: upsert em lote a partir do extrato buscado no BTG ──────────────────
-- SEM p_user_id de propósito (mesmo padrão de notify_due_soon/cobranca_payload):
-- chamada só por código server confiável — Server Action já gated por
-- assertFinanceAccess, ou o cron (protegido pelo secret do /api/cron). Preserva
-- status/lancamento_id de linhas já conciliadas/ignoradas ao ressincronizar.
create or replace function sync_btg_movements(p_org_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_inserted int := 0;
  v_updated  int := 0;
begin
  with rows as (
    select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      btg_id text, end_to_end_id text, tipo text, valor numeric,
      data_mov date, descricao text, categoria text, raw jsonb
    )
  ),
  ins as (
    insert into btg_movements (org_id, btg_id, end_to_end_id, tipo, valor, data_mov, descricao, categoria, raw)
    select p_org_id, r.btg_id, r.end_to_end_id, r.tipo, r.valor, r.data_mov, r.descricao, r.categoria, coalesce(r.raw, '{}'::jsonb)
    from rows r
    where r.btg_id is not null and r.data_mov is not null
    on conflict (org_id, btg_id) do update set
      end_to_end_id = excluded.end_to_end_id,
      tipo = excluded.tipo,
      valor = excluded.valor,
      descricao = excluded.descricao,
      categoria = excluded.categoria,
      raw = excluded.raw,
      updated_at = now()
    returning (xmax = 0) as is_insert
  )
  select count(*) filter (where is_insert), count(*) filter (where not is_insert)
    into v_inserted, v_updated from ins;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'total', v_inserted + v_updated);
end; $$;

grant execute on function sync_btg_movements(uuid, jsonb) to anon, authenticated;

-- ── Conciliar: liga o movimento a um lançamento e dá baixa nele ──────────────
create or replace function conciliar_btg_movimento(p_user_id uuid, p_movement_id uuid, p_lancamento_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m record; l record;
begin
  select * into m from btg_movements where id = p_movement_id;
  if not found then raise exception 'Movimento não encontrado'; end if;
  if not exists (
    select 1 from organization_members
    where org_id = m.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  select * into l from lancamentos where id = p_lancamento_id and org_id = m.org_id;
  if not found then raise exception 'Lançamento não encontrado'; end if;

  update lancamentos set
    situacao = case when l.tipo = 'entrada' then 'recebido' else 'pago' end,
    data_liquidacao = m.data_mov,
    valor_realizado = m.valor,
    updated_at = now()
  where id = p_lancamento_id;

  update btg_movements set status = 'conciliado', lancamento_id = p_lancamento_id, updated_at = now()
  where id = p_movement_id;
end; $$;

-- ── Ignorar: movimento não corresponde a nenhum lançamento (ex.: transferência interna) ──
create or replace function ignorar_btg_movimento(p_user_id uuid, p_movement_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from btg_movements where id = p_movement_id;
  if v_org is null then raise exception 'Movimento não encontrado'; end if;
  if not exists (
    select 1 from organization_members
    where org_id = v_org and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  update btg_movements set status = 'ignorado', lancamento_id = null, updated_at = now()
  where id = p_movement_id;
end; $$;

-- ── Desfazer: volta o movimento pra pendente (e reabre o lançamento, se ligado) ──
create or replace function desfazer_conciliacao_btg(p_user_id uuid, p_movement_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m record;
begin
  select * into m from btg_movements where id = p_movement_id;
  if not found then raise exception 'Movimento não encontrado'; end if;
  if not exists (
    select 1 from organization_members
    where org_id = m.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  if m.lancamento_id is not null then
    update lancamentos set
      situacao = 'em_aberto', data_liquidacao = null, valor_realizado = null,
      juros = 0, multa = 0, desconto = 0, tarifa = 0, updated_at = now()
    where id = m.lancamento_id;
  end if;

  update btg_movements set status = 'pendente', lancamento_id = null, updated_at = now()
  where id = p_movement_id;
end; $$;

grant execute on function conciliar_btg_movimento(uuid,uuid,uuid) to anon, authenticated;
grant execute on function ignorar_btg_movimento(uuid,uuid) to anon, authenticated;
grant execute on function desfazer_conciliacao_btg(uuid,uuid) to anon, authenticated;

notify pgrst, 'reload schema';
