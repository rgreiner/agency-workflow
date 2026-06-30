-- 076_system_errors.sql
-- Captura de erros do sistema (ex.: falha da revisão por IA / quota do provider).
-- Em vez de despejar o erro cru no comentário da tarefa, registra aqui e o admin
-- vê numa tela em Configurações. Idempotente.

create table if not exists system_errors (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid references organizations(id) on delete cascade,
  context     text not null,                 -- ex.: 'review:redacao'
  message     text not null,                 -- mensagem curta (já enxuta)
  detail      text,                           -- dump completo (JSON do provider / stack)
  activity_id uuid,                           -- tarefa relacionada (opcional)
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_system_errors_org on system_errors(org_id, created_at desc);

alter table system_errors enable row level security;

-- Só owner/admin da org leem os erros.
drop policy if exists "Admin read system_errors" on system_errors;
create policy "Admin read system_errors" on system_errors
  for select using (
    org_id is not null and exists (
      select 1 from organization_members om
      where om.org_id = system_errors.org_id and om.user_id = auth.uid()
        and om.role in ('owner','admin')
    )
  );

-- Registra um erro (server-side). Deriva a org a partir da tarefa quando informada.
create or replace function log_system_error(
  p_user_id uuid, p_context text, p_message text, p_detail text, p_activity_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid;
begin
  if p_activity_id is not null then
    select w.org_id into v_org
      from activities a
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id
      where a.id = p_activity_id;
  end if;
  -- evita insert arbitrário via PostgREST: exige ser membro da org (ou de alguma, se global)
  if v_org is not null then
    if not exists (select 1 from organization_members where org_id = v_org and user_id = p_user_id) then
      raise exception 'Acesso negado';
    end if;
  elsif not exists (select 1 from organization_members where user_id = p_user_id) then
    raise exception 'Acesso negado';
  end if;

  insert into system_errors (org_id, context, message, detail, activity_id)
  values (v_org, left(coalesce(p_context,'?'), 120), left(coalesce(p_message,''), 500), p_detail, p_activity_id)
  returning id into v_id;
  return v_id;
end; $$;

-- Marca um erro como resolvido / reabre (admin).
create or replace function resolve_system_error(p_user_id uuid, p_error_id uuid, p_resolved boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from system_errors where id = p_error_id;
  if not exists (
    select 1 from organization_members where org_id = v_org and user_id = p_user_id and role in ('owner','admin')
  ) then raise exception 'Acesso negado'; end if;
  update system_errors set resolved = p_resolved where id = p_error_id;
end; $$;

grant execute on function log_system_error(uuid,text,text,text,uuid) to anon, authenticated;
grant execute on function resolve_system_error(uuid,uuid,boolean) to anon, authenticated;

notify pgrst, 'reload schema';
