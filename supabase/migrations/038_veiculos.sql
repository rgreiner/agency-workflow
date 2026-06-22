-- 038_veiculos.sql
-- Cadastro de Veículos (mídia): jornais/revistas, emissoras, OOH, plataformas digitais.
-- Idempotente.

create table if not exists veiculos (
  id             uuid primary key default uuid_generate_v4(),
  org_id         uuid not null references organizations(id) on delete cascade,
  name           text not null,
  type           text,                       -- impressa | eletronica | externa | digital | outros
  tax_id         text,                       -- CNPJ
  commission_pct numeric(5,2) not null default 20,  -- desconto/comissão padrão da agência
  notes          text,
  archived       boolean not null default false,
  created_by     uuid references profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_veiculos_org on veiculos(org_id);

alter table veiculos enable row level security;

drop policy if exists "Org members read veiculos" on veiculos;
create policy "Org members read veiculos" on veiculos
  for select using (is_org_member(org_id));

drop policy if exists "Manager+ manage veiculos" on veiculos;
create policy "Manager+ manage veiculos" on veiculos
  for all using (org_member_role(org_id) in ('owner','admin','manager'));

drop trigger if exists set_veiculos_updated_at on veiculos;
create trigger set_veiculos_updated_at before update on veiculos
  for each row execute function set_updated_at();

-- ── RPCs (SECURITY DEFINER) ──────────────────────────────────
create or replace function create_veiculo(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  insert into veiculos (org_id, name, type, tax_id, commission_pct, notes, created_by)
  values (
    p_org_id,
    coalesce(nullif(p_data->>'name',''), '(sem nome)'),
    nullif(p_data->>'type',''),
    nullif(p_data->>'tax_id',''),
    coalesce(nullif(p_data->>'commission_pct','')::numeric, 20),
    nullif(p_data->>'notes',''),
    p_user_id
  ) returning id into v_id;
  return v_id;
end; $$;

create or replace function update_veiculo(p_user_id uuid, p_veiculo_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from veiculos v
    join organization_members om on om.org_id = v.org_id
    where v.id = p_veiculo_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  update veiculos set
    name           = coalesce(nullif(p_data->>'name',''), name),
    type           = nullif(p_data->>'type',''),
    tax_id         = nullif(p_data->>'tax_id',''),
    commission_pct = coalesce(nullif(p_data->>'commission_pct','')::numeric, commission_pct),
    notes          = nullif(p_data->>'notes',''),
    updated_at     = now()
  where id = p_veiculo_id;
end; $$;

create or replace function set_veiculo_archived(p_user_id uuid, p_veiculo_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from veiculos v
    join organization_members om on om.org_id = v.org_id
    where v.id = p_veiculo_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  update veiculos set archived = p_archived, updated_at = now() where id = p_veiculo_id;
end; $$;

grant execute on function create_veiculo(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function update_veiculo(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function set_veiculo_archived(uuid,uuid,boolean) to anon, authenticated;

notify pgrst, 'reload schema';
