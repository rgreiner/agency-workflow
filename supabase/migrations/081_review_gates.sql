-- 081_review_gates.sql
-- Liga/desliga a revisão por IA POR GATE (redacao/design/finalizacao), por org.
-- Config em org_settings.review_gates; ausente/nulo = todos ligados (default-on).
-- Idempotente.

alter table org_settings add column if not exists review_gates jsonb not null
  default '{"redacao": true, "design": true, "finalizacao": true}';

-- RPC separada (não mexe na assinatura de upsert_org_settings — PostgREST é
-- estrito com overloads). Só owner/admin.
create or replace function set_org_review_gates(
  p_user_id uuid,
  p_org_id  uuid,
  p_gates   jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role
  from organization_members
  where org_id = p_org_id and user_id = p_user_id;

  if v_role not in ('owner', 'admin') then
    raise exception 'Apenas administradores podem alterar as configurações';
  end if;

  insert into org_settings (org_id, review_gates, updated_at)
  values (p_org_id, coalesce(p_gates, '{"redacao": true, "design": true, "finalizacao": true}'), now())
  on conflict (org_id) do update set
    review_gates = excluded.review_gates,
    updated_at   = now();
end;
$$;

grant execute on function set_org_review_gates(uuid, uuid, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
