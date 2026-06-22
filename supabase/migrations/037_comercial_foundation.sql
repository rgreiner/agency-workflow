-- 037_comercial_foundation.sql
-- Fundação do módulo comercial/financeiro:
--   (1) cadastro fiscal/comercial do cliente (workspace)
--   (2) permissão de Financeiro por membro
-- Idempotente (add column if not exists / create or replace).

-- ─────────────────────────────────────────────────────────────
-- (1) Cliente (workspace): dados cadastrais
-- ─────────────────────────────────────────────────────────────
alter table workspaces add column if not exists legal_name         text; -- razão social
alter table workspaces add column if not exists trade_name         text; -- nome fantasia
alter table workspaces add column if not exists tax_id             text; -- CNPJ ou CPF
alter table workspaces add column if not exists state_registration text; -- inscrição estadual (IE)
alter table workspaces add column if not exists city_registration  text; -- inscrição municipal (IM)
alter table workspaces add column if not exists finance_email      text; -- e-mail financeiro
alter table workspaces add column if not exists phone              text;
alter table workspaces add column if not exists contact_name       text; -- pessoa de contato
alter table workspaces add column if not exists address_zip        text; -- CEP
alter table workspaces add column if not exists address_street     text;
alter table workspaces add column if not exists address_number     text;
alter table workspaces add column if not exists address_complement text;
alter table workspaces add column if not exists address_district   text; -- bairro
alter table workspaces add column if not exists address_city       text;
alter table workspaces add column if not exists address_state      text; -- UF
alter table workspaces add column if not exists payment_terms      text; -- condição/prazo padrão

-- Salva o cadastro completo do cliente a partir de um jsonb (evita uma função com
-- ~17 parâmetros). Mantém a mesma checagem de acesso do update_workspace.
create or replace function update_workspace_cadastro(
  p_user_id      uuid,
  p_workspace_id uuid,
  p_data         jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from workspaces w
    join organization_members om on om.org_id = w.org_id
    where w.id = p_workspace_id and om.user_id = p_user_id
      and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  update workspaces set
    name               = coalesce(nullif(p_data->>'name',''), name),
    description        = nullif(p_data->>'description',''),
    color              = coalesce(nullif(p_data->>'color',''), color),
    legal_name         = nullif(p_data->>'legal_name',''),
    trade_name         = nullif(p_data->>'trade_name',''),
    tax_id             = nullif(p_data->>'tax_id',''),
    state_registration = nullif(p_data->>'state_registration',''),
    city_registration  = nullif(p_data->>'city_registration',''),
    finance_email      = nullif(p_data->>'finance_email',''),
    phone              = nullif(p_data->>'phone',''),
    contact_name       = nullif(p_data->>'contact_name',''),
    address_zip        = nullif(p_data->>'address_zip',''),
    address_street     = nullif(p_data->>'address_street',''),
    address_number     = nullif(p_data->>'address_number',''),
    address_complement = nullif(p_data->>'address_complement',''),
    address_district   = nullif(p_data->>'address_district',''),
    address_city       = nullif(p_data->>'address_city',''),
    address_state      = nullif(p_data->>'address_state',''),
    payment_terms      = nullif(p_data->>'payment_terms',''),
    updated_at         = now()
  where id = p_workspace_id;
end;
$$;

grant execute on function update_workspace_cadastro(uuid,uuid,jsonb) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- (2) Permissão de Financeiro por membro
-- ─────────────────────────────────────────────────────────────
alter table organization_members add column if not exists can_finance boolean not null default false;

-- Estende update_member com p_can_finance (default null = não altera o valor atual).
drop function if exists update_member(uuid,uuid,uuid,uuid,member_role);
create or replace function update_member(
  p_user_id     uuid,
  p_org_id      uuid,
  p_member_id   uuid,
  p_position_id uuid,
  p_role        member_role,
  p_can_finance boolean default null
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin')
  ) then raise exception 'Acesso negado'; end if;

  if p_user_id = p_member_id and p_role != 'owner' then
    raise exception 'Não é possível alterar o próprio papel de owner';
  end if;

  update organization_members
  set position_id = p_position_id,
      role        = p_role,
      can_finance = coalesce(p_can_finance, can_finance)
  where id = p_member_id and org_id = p_org_id;
end;
$$;

grant execute on function update_member(uuid,uuid,uuid,uuid,member_role,boolean) to anon, authenticated;

notify pgrst, 'reload schema';
