-- 039_midias.sql
-- Documento de Mídia (tela "Mídia Simplificada", cobre todos os tipos via `tipo`).
-- Sem geração de lançamento financeiro ainda — isso entra junto com o Conta Azul.
-- Idempotente.

create table if not exists midias (
  id                   uuid primary key default uuid_generate_v4(),
  org_id               uuid not null references organizations(id) on delete cascade,
  numero               integer,                       -- sequencial por org (referência)
  workspace_id         uuid not null references workspaces(id) on delete cascade,  -- cliente
  campaign_id          uuid references campaigns(id) on delete set null,
  veiculo_id           uuid not null references veiculos(id),
  tipo                 text,                          -- impressa_jornal | impressa_revista | eletronica | externa | digital | outros
  titulo               text not null,
  emissao              date,
  job                  text,
  aut_veiculo          text,
  codigo_identificador text,
  nota_fiscal          text,
  pecas                text,
  praca                text,
  abrangencia          text,
  valor                numeric(14,2) not null default 0,   -- valor bruto/base
  desconto_pct         numeric(5,2)  not null default 20,  -- desconto padrão da agência
  faturamento          text,                          -- ver app: 5 modos
  prazo                text,
  data_base            date,
  dias_agencia         integer not null default 7,
  primeira_veiculacao  date,
  ultima_veiculacao    date,
  contato              text,
  responsavel_id       uuid references profiles(id),
  situacao             text not null default 'em_aberto',  -- em_aberto|aprovado|cancelado|faturar|faturado
  observacao           text,
  texto_legal          text,
  archived             boolean not null default false,
  created_by           uuid references profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_midias_org on midias(org_id);
create index if not exists idx_midias_workspace on midias(workspace_id);

alter table midias enable row level security;

drop policy if exists "Org members read midias" on midias;
create policy "Org members read midias" on midias
  for select using (is_org_member(org_id));

drop policy if exists "Manager+ manage midias" on midias;
create policy "Manager+ manage midias" on midias
  for all using (org_member_role(org_id) in ('owner','admin','manager'));

drop trigger if exists set_midias_updated_at on midias;
create trigger set_midias_updated_at before update on midias
  for each row execute function set_updated_at();

-- ── RPCs ─────────────────────────────────────────────────────
create or replace function create_midia(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_numero integer;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  select coalesce(max(numero), 0) + 1 into v_numero from midias where org_id = p_org_id;

  insert into midias (
    org_id, numero, workspace_id, campaign_id, veiculo_id, tipo, titulo, emissao, job,
    aut_veiculo, codigo_identificador, nota_fiscal, pecas, praca, abrangencia,
    valor, desconto_pct, faturamento, prazo, data_base, dias_agencia,
    primeira_veiculacao, ultima_veiculacao, contato, responsavel_id, situacao,
    observacao, texto_legal, created_by
  ) values (
    p_org_id, v_numero,
    (p_data->>'workspace_id')::uuid,
    nullif(p_data->>'campaign_id','')::uuid,
    (p_data->>'veiculo_id')::uuid,
    nullif(p_data->>'tipo',''),
    coalesce(nullif(p_data->>'titulo',''), '(sem título)'),
    nullif(p_data->>'emissao','')::date,
    nullif(p_data->>'job',''),
    nullif(p_data->>'aut_veiculo',''),
    nullif(p_data->>'codigo_identificador',''),
    nullif(p_data->>'nota_fiscal',''),
    nullif(p_data->>'pecas',''),
    nullif(p_data->>'praca',''),
    nullif(p_data->>'abrangencia',''),
    coalesce(nullif(p_data->>'valor','')::numeric, 0),
    coalesce(nullif(p_data->>'desconto_pct','')::numeric, 20),
    nullif(p_data->>'faturamento',''),
    nullif(p_data->>'prazo',''),
    nullif(p_data->>'data_base','')::date,
    coalesce(nullif(p_data->>'dias_agencia','')::int, 7),
    nullif(p_data->>'primeira_veiculacao','')::date,
    nullif(p_data->>'ultima_veiculacao','')::date,
    nullif(p_data->>'contato',''),
    nullif(p_data->>'responsavel_id','')::uuid,
    coalesce(nullif(p_data->>'situacao',''), 'em_aberto'),
    nullif(p_data->>'observacao',''),
    nullif(p_data->>'texto_legal',''),
    p_user_id
  ) returning id into v_id;
  return v_id;
end; $$;

create or replace function update_midia(p_user_id uuid, p_midia_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from midias m
    join organization_members om on om.org_id = m.org_id
    where m.id = p_midia_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  update midias set
    workspace_id         = coalesce(nullif(p_data->>'workspace_id','')::uuid, workspace_id),
    campaign_id          = nullif(p_data->>'campaign_id','')::uuid,
    veiculo_id           = coalesce(nullif(p_data->>'veiculo_id','')::uuid, veiculo_id),
    tipo                 = nullif(p_data->>'tipo',''),
    titulo               = coalesce(nullif(p_data->>'titulo',''), titulo),
    emissao              = nullif(p_data->>'emissao','')::date,
    job                  = nullif(p_data->>'job',''),
    aut_veiculo          = nullif(p_data->>'aut_veiculo',''),
    codigo_identificador = nullif(p_data->>'codigo_identificador',''),
    nota_fiscal          = nullif(p_data->>'nota_fiscal',''),
    pecas                = nullif(p_data->>'pecas',''),
    praca                = nullif(p_data->>'praca',''),
    abrangencia          = nullif(p_data->>'abrangencia',''),
    valor                = coalesce(nullif(p_data->>'valor','')::numeric, 0),
    desconto_pct         = coalesce(nullif(p_data->>'desconto_pct','')::numeric, 20),
    faturamento          = nullif(p_data->>'faturamento',''),
    prazo                = nullif(p_data->>'prazo',''),
    data_base            = nullif(p_data->>'data_base','')::date,
    dias_agencia         = coalesce(nullif(p_data->>'dias_agencia','')::int, 7),
    primeira_veiculacao  = nullif(p_data->>'primeira_veiculacao','')::date,
    ultima_veiculacao    = nullif(p_data->>'ultima_veiculacao','')::date,
    contato              = nullif(p_data->>'contato',''),
    responsavel_id       = nullif(p_data->>'responsavel_id','')::uuid,
    situacao             = coalesce(nullif(p_data->>'situacao',''), situacao),
    observacao           = nullif(p_data->>'observacao',''),
    texto_legal          = nullif(p_data->>'texto_legal',''),
    updated_at           = now()
  where id = p_midia_id;
end; $$;

create or replace function set_midia_situacao(p_user_id uuid, p_midia_id uuid, p_situacao text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from midias m
    join organization_members om on om.org_id = m.org_id
    where m.id = p_midia_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  -- NOTA: a geração do lançamento financeiro (situacao='faturado') entra junto com o Conta Azul.
  update midias set situacao = p_situacao, updated_at = now() where id = p_midia_id;
end; $$;

create or replace function set_midia_archived(p_user_id uuid, p_midia_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from midias m
    join organization_members om on om.org_id = m.org_id
    where m.id = p_midia_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update midias set archived = p_archived, updated_at = now() where id = p_midia_id;
end; $$;

grant execute on function create_midia(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function update_midia(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function set_midia_situacao(uuid,uuid,text) to anon, authenticated;
grant execute on function set_midia_archived(uuid,uuid,boolean) to anon, authenticated;

notify pgrst, 'reload schema';
