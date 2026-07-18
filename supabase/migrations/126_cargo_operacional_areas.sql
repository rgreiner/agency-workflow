-- 126_cargo_operacional_areas.sql
-- A visibilidade do Operacional passa a depender do CARGO (org_positions), não só das
-- flags can_vendas/can_finance do membro. Cada cargo ganha marcadores do que libera:
--   op_ver_tudo → Diretoria: vê todas as seções, ignora os toggles
--   op_midias   → sob can_vendas, libera "Liberação de mídias"
--   op_producao → sob can_vendas, libera "Liberação de Produção"
-- Financeiro segue can_finance; Cadastros segue (can_vendas OU can_finance).
-- Owner/admin continuam vendo tudo (implícito no código). Idempotente.

alter table org_positions add column if not exists op_ver_tudo boolean not null default false;
alter table org_positions add column if not exists op_midias   boolean not null default false;
alter table org_positions add column if not exists op_producao boolean not null default false;

-- Pré-configura os cargos conhecidos (por nome, case-insensitive) conforme a regra.
update org_positions set op_ver_tudo = true where lower(name) = 'diretoria';
update org_positions set op_producao = true where lower(name) = 'atendimento';
update org_positions set op_midias   = true where lower(name) in ('midia', 'mídia');
update org_positions set op_midias = true, op_producao = true where lower(name) in ('revisao', 'revisão');

-- RPCs de cargo passam a receber os marcadores. PostgREST é estrito com overloads:
-- dropa as assinaturas antigas (5 args) antes de recriar com os novos parâmetros.
drop function if exists create_org_position(uuid, uuid, text, text, activity_status[]);
drop function if exists update_org_position(uuid, uuid, text, text, activity_status[]);

create or replace function create_org_position(
  p_user_id uuid, p_org_id uuid, p_name text, p_color text,
  p_allowed_statuses activity_status[],
  p_op_ver_tudo boolean default false,
  p_op_midias boolean default false,
  p_op_producao boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin')
  ) then raise exception 'Acesso negado'; end if;

  insert into org_positions (org_id, name, color, allowed_statuses, op_ver_tudo, op_midias, op_producao)
  values (p_org_id, p_name, p_color, p_allowed_statuses,
          coalesce(p_op_ver_tudo,false), coalesce(p_op_midias,false), coalesce(p_op_producao,false))
  returning id into v_id;
  return v_id;
end; $$;

create or replace function update_org_position(
  p_user_id uuid, p_position_id uuid, p_name text, p_color text,
  p_allowed_statuses activity_status[],
  p_op_ver_tudo boolean default null,
  p_op_midias boolean default null,
  p_op_producao boolean default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from org_positions pos
    join organization_members m on m.org_id = pos.org_id
    where pos.id = p_position_id and m.user_id = p_user_id and m.role in ('owner','admin')
  ) then raise exception 'Acesso negado'; end if;

  update org_positions set
    name = p_name, color = p_color, allowed_statuses = p_allowed_statuses,
    op_ver_tudo = coalesce(p_op_ver_tudo, op_ver_tudo),
    op_midias   = coalesce(p_op_midias, op_midias),
    op_producao = coalesce(p_op_producao, op_producao)
  where id = p_position_id;
end; $$;

grant execute on function create_org_position(uuid, uuid, text, text, activity_status[], boolean, boolean, boolean) to anon, authenticated;
grant execute on function update_org_position(uuid, uuid, text, text, activity_status[], boolean, boolean, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
