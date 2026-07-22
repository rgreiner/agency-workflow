-- 147_rh_fase1.sql
-- Módulo RH — Fase 1: permissão can_rh + ficha do colaborador + documentos.
-- Colaborador ≠ membro (ex-funcionário não tem login). Documentos são sensíveis:
-- ficam num prefixo privado do volume, servidos por rota autenticada (nunca /uploads).
-- RPCs no padrão SEGURO pós-143: auth.uid() interno, sem confiar em p_user_id.
-- Idempotente.

-- ── Permissão ──
alter table organization_members add column if not exists can_rh boolean not null default false;

-- ── Helper: quem opera RH (owner/admin OU can_rh) na org ──
create or replace function rh_can(p_org uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from organization_members
    where org_id = p_org and user_id = auth.uid()
      and (role in ('owner','admin') or can_rh)
  );
$$;
revoke execute on function rh_can(uuid) from public;
grant execute on function rh_can(uuid) to authenticated;

-- ── Colaborador (ativo, desligado ou afastado) ──
create table if not exists rh_colaborador (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  nome          text not null,
  cpf           text,
  email         text,
  telefone      text,
  cargo         text,
  tipo_vinculo  text,                       -- clt | pj | estagio | outro
  data_admissao date,
  data_demissao date,
  status        text not null default 'ativo',   -- ativo | desligado | afastado
  gestor_id     uuid references rh_colaborador(id) on delete set null,
  membro_user_id uuid,                       -- vínculo opcional ao login (nullable)
  salario_atual numeric,
  observacao    text,
  arquivado     boolean not null default false,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists rh_colaborador_org_idx on rh_colaborador (org_id) where not arquivado;

-- ── Documento do colaborador (arquivo no prefixo privado do volume) ──
create table if not exists rh_documento (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  colaborador_id uuid not null references rh_colaborador(id) on delete cascade,
  tipo           text not null,             -- admissao|aso|rg|cpf|holerite|rescisao|atestado|contrato|ferias|outro
  nome           text,                      -- nome original do arquivo
  chave          text,                      -- caminho relativo em rh-privado/... (nunca URL pública)
  competencia    date,                      -- p/ holerite/atestado/férias
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index if not exists rh_documento_colab_idx on rh_documento (colaborador_id);

-- ── RLS: só quem opera RH na org enxerga/gerencia ──
alter table rh_colaborador enable row level security;
alter table rh_documento  enable row level security;
drop policy if exists rh_colaborador_all on rh_colaborador;
create policy rh_colaborador_all on rh_colaborador for all using (rh_can(org_id)) with check (rh_can(org_id));
drop policy if exists rh_documento_all on rh_documento;
create policy rh_documento_all on rh_documento for all using (rh_can(org_id)) with check (rh_can(org_id));

-- ── RPCs (SECURITY DEFINER, auth.uid()) ──
create or replace function rh_upsert_colaborador(p_org_id uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if coalesce(nullif(p_data->>'nome',''), '') = '' then raise exception 'Nome é obrigatório'; end if;

  if p_id is null then
    insert into rh_colaborador (org_id, nome, cpf, email, telefone, cargo, tipo_vinculo,
      data_admissao, data_demissao, status, gestor_id, membro_user_id, salario_atual, observacao, created_by)
    values (p_org_id,
      p_data->>'nome', nullif(p_data->>'cpf',''), nullif(p_data->>'email',''), nullif(p_data->>'telefone',''),
      nullif(p_data->>'cargo',''), nullif(p_data->>'tipo_vinculo',''),
      nullif(p_data->>'data_admissao','')::date, nullif(p_data->>'data_demissao','')::date,
      coalesce(nullif(p_data->>'status',''), 'ativo'),
      nullif(p_data->>'gestor_id','')::uuid, nullif(p_data->>'membro_user_id','')::uuid,
      nullif(p_data->>'salario_atual','')::numeric, nullif(p_data->>'observacao',''), auth.uid())
    returning id into v_id;
  else
    update rh_colaborador set
      nome = p_data->>'nome', cpf = nullif(p_data->>'cpf',''), email = nullif(p_data->>'email',''),
      telefone = nullif(p_data->>'telefone',''), cargo = nullif(p_data->>'cargo',''),
      tipo_vinculo = nullif(p_data->>'tipo_vinculo',''),
      data_admissao = nullif(p_data->>'data_admissao','')::date,
      data_demissao = nullif(p_data->>'data_demissao','')::date,
      status = coalesce(nullif(p_data->>'status',''), status),
      gestor_id = nullif(p_data->>'gestor_id','')::uuid,
      membro_user_id = nullif(p_data->>'membro_user_id','')::uuid,
      salario_atual = nullif(p_data->>'salario_atual','')::numeric,
      observacao = nullif(p_data->>'observacao',''), updated_at = now()
    where id = p_id and org_id = p_org_id
    returning id into v_id;
    if v_id is null then raise exception 'Colaborador não encontrado'; end if;
  end if;
  return v_id;
end; $$;

create or replace function rh_set_colaborador_arquivado(p_id uuid, p_arquivado boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_colaborador where id = p_id;
  if v_org is null then return; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update rh_colaborador set arquivado = p_arquivado, updated_at = now() where id = p_id;
end; $$;

create or replace function rh_add_documento(p_colaborador_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid; v_id uuid;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador_id;
  if v_org is null then raise exception 'Colaborador não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  insert into rh_documento (org_id, colaborador_id, tipo, nome, chave, competencia, created_by)
  values (v_org, p_colaborador_id, coalesce(nullif(p_data->>'tipo',''),'outro'),
    nullif(p_data->>'nome',''), nullif(p_data->>'chave',''),
    nullif(p_data->>'competencia','')::date, auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

create or replace function rh_delete_documento(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_documento where id = p_id;
  if v_org is null then return; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  delete from rh_documento where id = p_id;
end; $$;

revoke execute on function rh_upsert_colaborador(uuid,uuid,jsonb) from public;
revoke execute on function rh_set_colaborador_arquivado(uuid,boolean) from public;
revoke execute on function rh_add_documento(uuid,jsonb) from public;
revoke execute on function rh_delete_documento(uuid) from public;
grant execute on function rh_upsert_colaborador(uuid,uuid,jsonb) to authenticated;
grant execute on function rh_set_colaborador_arquivado(uuid,boolean) to authenticated;
grant execute on function rh_add_documento(uuid,jsonb) to authenticated;
grant execute on function rh_delete_documento(uuid) to authenticated;

-- ── update_member ganha p_can_rh (drop+recreate: PostgREST não aceita overload) ──
drop function if exists update_member(uuid, uuid, uuid, uuid, member_role, boolean, boolean);
create or replace function update_member(
  p_user_id uuid, p_org_id uuid, p_member_id uuid, p_position_id uuid, p_role member_role,
  p_can_finance boolean default null, p_can_vendas boolean default null, p_can_rh boolean default null
) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
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
      can_finance = coalesce(p_can_finance, can_finance),
      can_vendas  = coalesce(p_can_vendas, can_vendas),
      can_rh      = coalesce(p_can_rh, can_rh)
  where id = p_member_id and org_id = p_org_id;
end; $$;
revoke execute on function update_member(uuid,uuid,uuid,uuid,member_role,boolean,boolean,boolean) from public;
grant execute on function update_member(uuid,uuid,uuid,uuid,member_role,boolean,boolean,boolean) to authenticated;

notify pgrst, 'reload schema';
