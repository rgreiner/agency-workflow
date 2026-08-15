-- 235_cargo_toggle_midia_hub.sql
-- Expõe o toggle `op_midia_hub` (migration 234) na tela de Cargos.
--
-- DROP antes do CREATE porque o parâmetro novo tem DEFAULT: um `create or
-- replace` com assinatura diferente criaria um OVERLOAD, e o PostgREST
-- self-hosted recusa RPC com mais de uma assinatura ("Could not choose the best
-- candidate function"). Uma assinatura por RPC é regra da casa.
--
-- Idempotente.

drop function if exists create_org_position(uuid, uuid, text, text, text[], boolean, boolean, boolean);
drop function if exists update_org_position(uuid, uuid, text, text, text[], boolean, boolean, boolean);
drop function if exists create_org_position(uuid, uuid, text, text, text[], boolean, boolean, boolean, boolean);
drop function if exists update_org_position(uuid, uuid, text, text, text[], boolean, boolean, boolean, boolean);

create function create_org_position(
  p_user_id uuid, p_org_id uuid, p_name text, p_color text, p_allowed_statuses text[],
  p_op_ver_tudo boolean default false, p_op_midias boolean default false,
  p_op_producao boolean default false, p_op_midia_hub boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members m
     where m.org_id = p_org_id and m.user_id = p_user_id and m.role in ('owner','admin')
  ) then raise exception 'Acesso negado'; end if;

  insert into org_positions (org_id, name, color, allowed_statuses, op_ver_tudo, op_midias, op_producao, op_midia_hub)
  values (p_org_id, p_name, p_color, p_allowed_statuses,
          coalesce(p_op_ver_tudo, false), coalesce(p_op_midias, false),
          coalesce(p_op_producao, false), coalesce(p_op_midia_hub, false))
  returning id into v_id;
  return v_id;
end $$;

create function update_org_position(
  p_user_id uuid, p_position_id uuid, p_name text, p_color text, p_allowed_statuses text[],
  p_op_ver_tudo boolean default null, p_op_midias boolean default null,
  p_op_producao boolean default null, p_op_midia_hub boolean default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from org_positions pos
    join organization_members m on m.org_id = pos.org_id
    where pos.id = p_position_id and m.user_id = p_user_id and m.role in ('owner','admin')
  ) then raise exception 'Acesso negado'; end if;

  update org_positions set
    name = p_name, color = p_color, allowed_statuses = p_allowed_statuses,
    op_ver_tudo  = coalesce(p_op_ver_tudo, op_ver_tudo),
    op_midias    = coalesce(p_op_midias, op_midias),
    op_producao  = coalesce(p_op_producao, op_producao),
    op_midia_hub = coalesce(p_op_midia_hub, op_midia_hub)
  where id = p_position_id;
end $$;

revoke execute on function create_org_position(uuid, uuid, text, text, text[], boolean, boolean, boolean, boolean) from public, anon;
revoke execute on function update_org_position(uuid, uuid, text, text, text[], boolean, boolean, boolean, boolean) from public, anon;
grant  execute on function create_org_position(uuid, uuid, text, text, text[], boolean, boolean, boolean, boolean) to authenticated;
grant  execute on function update_org_position(uuid, uuid, text, text, text[], boolean, boolean, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
