-- 060_cadastro_edit_perms.sql
-- Edição de cadastros passa a respeitar os toggles can_finance / can_vendas.
-- Antes exigia role manager+ e ignorava as permissões novas (o toggle dava menu
-- mas não permissão de salvar). Idempotente.
--   · Cliente (workspace): manager+ OU Financeiro OU Vendas
--   · Veículo / Fornecedor: manager+ OU Vendas (igual ao gating do menu Cadastros)
-- Parênteses no predicado são essenciais (precedência: AND liga mais forte que OR).

-- ── Cliente (cadastro do workspace) ──────────────────────────
create or replace function update_workspace_cadastro(
  p_user_id uuid, p_workspace_id uuid, p_data jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from workspaces w join organization_members om on om.org_id = w.org_id
    where w.id = p_workspace_id and om.user_id = p_user_id
      and (om.role in ('owner','admin','manager') or om.can_finance or om.can_vendas)
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
    atividade          = nullif(p_data->>'atividade',''),
    enderecos          = coalesce(p_data->'enderecos', enderecos),
    telefones          = coalesce(p_data->'telefones', telefones),
    emails             = coalesce(p_data->'emails', emails),
    contas_bancarias   = coalesce(p_data->'contas_bancarias', contas_bancarias),
    updated_at         = now()
  where id = p_workspace_id;
end; $$;

-- ── Veículo: create/update (manager+ OU Vendas) ──────────────
create or replace function create_veiculo(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from organization_members where org_id=p_org_id and user_id=p_user_id
    and (role in ('owner','admin','manager') or can_vendas))
  then raise exception 'Acesso negado'; end if;
  insert into veiculos (org_id, name, type, tax_id, commission_pct, notes, enderecos, telefones, emails, contas_bancarias, created_by)
  values (p_org_id, coalesce(nullif(p_data->>'name',''),'(sem nome)'), nullif(p_data->>'type',''), nullif(p_data->>'tax_id',''),
    coalesce(nullif(p_data->>'commission_pct','')::numeric,20), nullif(p_data->>'notes',''),
    coalesce(p_data->'enderecos','[]'::jsonb), coalesce(p_data->'telefones','[]'::jsonb), coalesce(p_data->'emails','[]'::jsonb), coalesce(p_data->'contas_bancarias','[]'::jsonb), p_user_id)
  returning id into v_id;
  return v_id;
end; $$;

create or replace function update_veiculo(p_user_id uuid, p_veiculo_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from veiculos v join organization_members om on om.org_id=v.org_id
    where v.id=p_veiculo_id and om.user_id=p_user_id and (om.role in ('owner','admin','manager') or om.can_vendas))
  then raise exception 'Acesso negado'; end if;
  update veiculos set
    name=coalesce(nullif(p_data->>'name',''),name), type=nullif(p_data->>'type',''), tax_id=nullif(p_data->>'tax_id',''),
    commission_pct=coalesce(nullif(p_data->>'commission_pct','')::numeric, commission_pct), notes=nullif(p_data->>'notes',''),
    enderecos=coalesce(p_data->'enderecos', enderecos), telefones=coalesce(p_data->'telefones', telefones),
    emails=coalesce(p_data->'emails', emails), contas_bancarias=coalesce(p_data->'contas_bancarias', contas_bancarias),
    updated_at=now()
  where id=p_veiculo_id;
end; $$;

-- ── Fornecedor: create/update (manager+ OU Vendas) ───────────
create or replace function create_fornecedor(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from organization_members where org_id=p_org_id and user_id=p_user_id
    and (role in ('owner','admin','manager') or can_vendas))
  then raise exception 'Acesso negado'; end if;
  insert into fornecedores (org_id, name, tipo, tax_id, notes, enderecos, telefones, emails, contas_bancarias, created_by)
  values (p_org_id, coalesce(nullif(p_data->>'name',''),'(sem nome)'), nullif(p_data->>'tipo',''), nullif(p_data->>'tax_id',''), nullif(p_data->>'notes',''),
    coalesce(p_data->'enderecos','[]'::jsonb), coalesce(p_data->'telefones','[]'::jsonb), coalesce(p_data->'emails','[]'::jsonb), coalesce(p_data->'contas_bancarias','[]'::jsonb), p_user_id)
  returning id into v_id;
  return v_id;
end; $$;

create or replace function update_fornecedor(p_user_id uuid, p_fornecedor_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from fornecedores f join organization_members om on om.org_id=f.org_id
    where f.id=p_fornecedor_id and om.user_id=p_user_id and (om.role in ('owner','admin','manager') or om.can_vendas))
  then raise exception 'Acesso negado'; end if;
  update fornecedores set
    name=coalesce(nullif(p_data->>'name',''),name), tipo=nullif(p_data->>'tipo',''), tax_id=nullif(p_data->>'tax_id',''), notes=nullif(p_data->>'notes',''),
    enderecos=coalesce(p_data->'enderecos', enderecos), telefones=coalesce(p_data->'telefones', telefones),
    emails=coalesce(p_data->'emails', emails), contas_bancarias=coalesce(p_data->'contas_bancarias', contas_bancarias),
    updated_at=now()
  where id=p_fornecedor_id;
end; $$;

notify pgrst, 'reload schema';
