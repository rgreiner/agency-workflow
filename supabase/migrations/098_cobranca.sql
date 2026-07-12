-- 098_cobranca.sql
-- Cobrança: lembrete de vencimento por e-mail ao cliente (D-3 / D0 / D+3), opt-in por
-- cliente (workspaces.cobranca_auto, default OFF). Dados bancários da org em
-- org_settings.payment_info. Dedup em cobranca_avisos (não repete o mesmo aviso). O
-- cron chama cobranca_payload (security definer, roda anon) e marca via mark_cobranca_aviso.
-- Cliente do recebível vem via origem (mídia/produção) → workspace. Idempotente.

alter table workspaces   add column if not exists cobranca_auto boolean not null default false;
alter table org_settings add column if not exists payment_info  text;

create table if not exists cobranca_avisos (
  lancamento_id uuid not null references lancamentos(id) on delete cascade,
  bucket        text not null,                       -- 'd-3' | 'd0' | 'd+3'
  org_id        uuid not null references organizations(id) on delete cascade,
  sent_at       timestamptz not null default now(),
  primary key (lancamento_id, bucket)
);
alter table cobranca_avisos enable row level security;
drop policy if exists "finance read cobranca_avisos" on cobranca_avisos;
create policy "finance read cobranca_avisos" on cobranca_avisos for select using (
  exists (select 1 from organization_members om
    where om.org_id = cobranca_avisos.org_id and om.user_id = auth.uid()
      and (om.can_finance or om.role in ('owner','admin'))));

create or replace function cobranca_payload()
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select l.id as lancamento_id,
      (case when l.vencimento = current_date + 3 then 'd-3'
            when l.vencimento = current_date     then 'd0'
            else 'd+3' end) as bucket,
      o.slug as org_slug, o.name as org_name,
      w.name as cliente, w.finance_email as email,
      coalesce(nullif(l.descricao, ''), 'Cobrança') as descricao,
      l.valor::float8 as valor, l.vencimento::text as vencimento,
      coalesce(os.payment_info, '') as payment_info
    from lancamentos l
    join organizations o on o.id = l.org_id
    left join org_settings os on os.org_id = l.org_id
    left join midias   mi on l.origem_tipo = 'midia' and mi.id = l.origem_id
    left join producao pr on l.origem_tipo in ('producao','fee') and pr.id = l.origem_id
    join workspaces w on w.id = coalesce(mi.workspace_id, pr.workspace_id)
    where l.tipo = 'entrada' and l.situacao = 'em_aberto'
      and l.vencimento in (current_date + 3, current_date, current_date - 3)
      and w.cobranca_auto = true and coalesce(w.finance_email, '') <> ''
      and not exists (
        select 1 from cobranca_avisos ca where ca.lancamento_id = l.id
          and ca.bucket = (case when l.vencimento = current_date + 3 then 'd-3'
                                when l.vencimento = current_date     then 'd0'
                                else 'd+3' end))
  ) t
$$;

create or replace function mark_cobranca_aviso(p_lancamento_id uuid, p_bucket text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into cobranca_avisos (lancamento_id, bucket, org_id)
  select p_lancamento_id, p_bucket, l.org_id from lancamentos l where l.id = p_lancamento_id
  on conflict do nothing;
end $$;

create or replace function set_org_payment_info(p_user_id uuid, p_org_id uuid, p_info text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))) then raise exception 'Acesso negado'; end if;
  update org_settings set payment_info = nullif(p_info, '') where org_id = p_org_id;
  if not found then insert into org_settings (org_id, payment_info) values (p_org_id, nullif(p_info, '')); end if;
end $$;

grant execute on function cobranca_payload() to anon, authenticated;
grant execute on function mark_cobranca_aviso(uuid, text) to anon, authenticated;
grant execute on function set_org_payment_info(uuid, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
