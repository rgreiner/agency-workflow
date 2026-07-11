-- 087_digest.sql
-- Resumo diário por e-mail: preferência por usuário (opt-out) + RPC que monta,
-- por pessoa, os 3 blocos (atrasadas · hoje · próximas 7 dias). Idempotente.

create table if not exists user_prefs (
  user_id        uuid primary key references profiles(id) on delete cascade,
  digest_enabled boolean not null default true,
  updated_at     timestamptz not null default now()
);
alter table user_prefs enable row level security;
drop policy if exists "own prefs" on user_prefs;
create policy "own prefs" on user_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on user_prefs to anon, authenticated;

create or replace function set_digest_enabled(p_user_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into user_prefs (user_id, digest_enabled, updated_at) values (p_user_id, p_enabled, now())
  on conflict (user_id) do update set digest_enabled = excluded.digest_enabled, updated_at = now();
end; $$;
grant execute on function set_digest_enabled(uuid, boolean) to anon, authenticated;

-- Payload do digest: 1 objeto por pessoa COM pendências (e com digest ligado).
-- Buckets pela data de HOJE em Brasília. Só tarefas atribuídas, ativas, com prazo.
create or replace function digest_payload()
returns jsonb language sql security definer set search_path = public stable as $$
  with today as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  tasks as (
    select aa.user_id, a.id, a.title, a.due_date::text as due,
           c.name as campaign, w.name as cliente, o.slug as org_slug,
           case when a.due_date <  (select d from today) then 'atrasadas'
                when a.due_date =  (select d from today) then 'hoje'
                else 'proximas' end as bucket
    from activity_assignees aa
    join activities a  on a.id = aa.activity_id
    join campaigns  c  on c.id = a.campaign_id
    join workspaces w  on w.id = c.workspace_id
    join organizations o on o.id = w.org_id
    where a.archived = false and a.status <> 'concluido' and a.due_date is not null
      and a.due_date <= (select d from today) + 7
  ),
  agg as (
    select t.user_id, max(t.org_slug) as org_slug,
      jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'due',t.due,'campaign',t.campaign,'cliente',t.cliente) order by t.due)
        filter (where t.bucket='atrasadas') as atrasadas,
      jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'due',t.due,'campaign',t.campaign,'cliente',t.cliente) order by t.due)
        filter (where t.bucket='hoje')      as hoje,
      jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'due',t.due,'campaign',t.campaign,'cliente',t.cliente) order by t.due)
        filter (where t.bucket='proximas')  as proximas
    from tasks t
    group by t.user_id
  )
  -- E-mail vem do LOGIN (auth.users) — fonte da verdade. Nome vem do profiles.
  -- (função é security-definer, então pode ler o schema auth.)
  select coalesce(jsonb_agg(jsonb_build_object(
           'email', u.email, 'name', p.full_name, 'org_slug', a.org_slug,
           'atrasadas', coalesce(a.atrasadas, '[]'::jsonb),
           'hoje',      coalesce(a.hoje,      '[]'::jsonb),
           'proximas',  coalesce(a.proximas,  '[]'::jsonb)
         )), '[]'::jsonb)
  from agg a
  join auth.users u on u.id = a.user_id
  left join profiles p on p.id = a.user_id
  where u.email is not null
    and coalesce((select up.digest_enabled from user_prefs up where up.user_id = a.user_id), true)
    and (a.atrasadas is not null or a.hoje is not null or a.proximas is not null);
$$;
grant execute on function digest_payload() to anon, authenticated;

notify pgrst, 'reload schema';
