-- 044_fornecedores_producao.sql
-- Cadastro de Fornecedores + documento de Produção (Orçamento/Pedido/FEE).
-- Idempotente.

-- ── Fornecedores ─────────────────────────────────────────────
create table if not exists fornecedores (
  id         uuid primary key default uuid_generate_v4(),
  org_id     uuid not null references organizations(id) on delete cascade,
  name       text not null,
  tipo       text,            -- gráfica, brindes, áudio/vídeo, etc.
  tax_id     text,            -- CNPJ
  notes      text,
  archived   boolean not null default false,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_fornecedores_org on fornecedores(org_id);
alter table fornecedores enable row level security;
drop policy if exists "Org members read fornecedores" on fornecedores;
create policy "Org members read fornecedores" on fornecedores for select using (is_org_member(org_id));
drop policy if exists "Manager+ manage fornecedores" on fornecedores;
create policy "Manager+ manage fornecedores" on fornecedores for all using (org_member_role(org_id) in ('owner','admin','manager'));
drop trigger if exists set_fornecedores_updated_at on fornecedores;
create trigger set_fornecedores_updated_at before update on fornecedores for each row execute function set_updated_at();

create or replace function create_fornecedor(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from organization_members where org_id=p_org_id and user_id=p_user_id and role in ('owner','admin','manager'))
  then raise exception 'Acesso negado'; end if;
  insert into fornecedores (org_id, name, tipo, tax_id, notes, created_by)
  values (p_org_id, coalesce(nullif(p_data->>'name',''),'(sem nome)'), nullif(p_data->>'tipo',''), nullif(p_data->>'tax_id',''), nullif(p_data->>'notes',''), p_user_id)
  returning id into v_id;
  return v_id;
end; $$;

create or replace function update_fornecedor(p_user_id uuid, p_fornecedor_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from fornecedores f join organization_members om on om.org_id=f.org_id where f.id=p_fornecedor_id and om.user_id=p_user_id and om.role in ('owner','admin','manager'))
  then raise exception 'Acesso negado'; end if;
  update fornecedores set name=coalesce(nullif(p_data->>'name',''),name), tipo=nullif(p_data->>'tipo',''), tax_id=nullif(p_data->>'tax_id',''), notes=nullif(p_data->>'notes',''), updated_at=now() where id=p_fornecedor_id;
end; $$;

create or replace function set_fornecedor_archived(p_user_id uuid, p_fornecedor_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from fornecedores f join organization_members om on om.org_id=f.org_id where f.id=p_fornecedor_id and om.user_id=p_user_id and om.role in ('owner','admin','manager'))
  then raise exception 'Acesso negado'; end if;
  update fornecedores set archived=p_archived, updated_at=now() where id=p_fornecedor_id;
end; $$;

grant execute on function create_fornecedor(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function update_fornecedor(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function set_fornecedor_archived(uuid,uuid,boolean) to anon, authenticated;

-- ── Produção (Orçamento / Pedido / FEE) ──────────────────────
create table if not exists producao (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  numero          integer,
  tipo            text not null default 'orcamento',  -- orcamento | pedido | fee
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  campaign_id     uuid references campaigns(id) on delete set null,
  titulo          text not null,
  faturar         text,                               -- contra_cliente | contra_agencia
  emissao         date,
  validade_dias   integer,
  bv_pct          numeric(5,2) not null default 15,
  honorarios_pct  numeric(5,2) not null default 0,
  valor           numeric(14,2) not null default 0,   -- valor a faturar (soma das opções escolhidas)
  codigo_identificador text,
  nota_fiscal     text,
  situacao        text not null default 'em_aberto',
  observacao      text,
  texto_legal     text,
  contato         text,
  responsavel_id  uuid references profiles(id),
  archived        boolean not null default false,
  detalhe         jsonb not null default '{}'::jsonb, -- itens: [{nome, descricao, job, opcoes:[{fornecedor_id, fornecedor_nome, n_orc, pgto, quant, valor_unit, selecionado}]}]
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_producao_org on producao(org_id);
alter table producao enable row level security;
drop policy if exists "Org members read producao" on producao;
create policy "Org members read producao" on producao for select using (is_org_member(org_id));
drop policy if exists "Manager+ manage producao" on producao;
create policy "Manager+ manage producao" on producao for all using (org_member_role(org_id) in ('owner','admin','manager'));
drop trigger if exists set_producao_updated_at on producao;
create trigger set_producao_updated_at before update on producao for each row execute function set_updated_at();

create or replace function create_producao(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_numero integer; v_tipo text;
begin
  if not exists (select 1 from organization_members where org_id=p_org_id and user_id=p_user_id and role in ('owner','admin','manager'))
  then raise exception 'Acesso negado'; end if;
  v_tipo := coalesce(nullif(p_data->>'tipo',''), 'orcamento');
  select coalesce(max(numero),0)+1 into v_numero from producao where org_id=p_org_id and tipo=v_tipo;
  insert into producao (org_id, numero, tipo, workspace_id, campaign_id, titulo, faturar, emissao, validade_dias,
    bv_pct, honorarios_pct, valor, codigo_identificador, nota_fiscal, situacao, observacao, texto_legal, contato, responsavel_id, detalhe, created_by)
  values (p_org_id, v_numero, v_tipo, (p_data->>'workspace_id')::uuid, nullif(p_data->>'campaign_id','')::uuid,
    coalesce(nullif(p_data->>'titulo',''),'(sem título)'), nullif(p_data->>'faturar',''), nullif(p_data->>'emissao','')::date,
    nullif(p_data->>'validade_dias','')::int, coalesce(nullif(p_data->>'bv_pct','')::numeric,15), coalesce(nullif(p_data->>'honorarios_pct','')::numeric,0),
    coalesce(nullif(p_data->>'valor','')::numeric,0), nullif(p_data->>'codigo_identificador',''), nullif(p_data->>'nota_fiscal',''),
    coalesce(nullif(p_data->>'situacao',''),'em_aberto'), nullif(p_data->>'observacao',''), nullif(p_data->>'texto_legal',''),
    nullif(p_data->>'contato',''), nullif(p_data->>'responsavel_id','')::uuid, coalesce(p_data->'detalhe','{}'::jsonb), p_user_id)
  returning id into v_id;
  return v_id;
end; $$;

create or replace function update_producao(p_user_id uuid, p_producao_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from producao p join organization_members om on om.org_id=p.org_id where p.id=p_producao_id and om.user_id=p_user_id and om.role in ('owner','admin','manager'))
  then raise exception 'Acesso negado'; end if;
  update producao set
    workspace_id=coalesce(nullif(p_data->>'workspace_id','')::uuid, workspace_id),
    campaign_id=nullif(p_data->>'campaign_id','')::uuid,
    titulo=coalesce(nullif(p_data->>'titulo',''), titulo),
    faturar=nullif(p_data->>'faturar',''),
    emissao=nullif(p_data->>'emissao','')::date,
    validade_dias=nullif(p_data->>'validade_dias','')::int,
    bv_pct=coalesce(nullif(p_data->>'bv_pct','')::numeric,15),
    honorarios_pct=coalesce(nullif(p_data->>'honorarios_pct','')::numeric,0),
    valor=coalesce(nullif(p_data->>'valor','')::numeric,0),
    codigo_identificador=nullif(p_data->>'codigo_identificador',''),
    nota_fiscal=nullif(p_data->>'nota_fiscal',''),
    situacao=coalesce(nullif(p_data->>'situacao',''), situacao),
    observacao=nullif(p_data->>'observacao',''),
    texto_legal=nullif(p_data->>'texto_legal',''),
    contato=nullif(p_data->>'contato',''),
    responsavel_id=nullif(p_data->>'responsavel_id','')::uuid,
    detalhe=coalesce(p_data->'detalhe', detalhe),
    updated_at=now()
  where id=p_producao_id;
end; $$;

create or replace function set_producao_situacao(p_user_id uuid, p_producao_id uuid, p_situacao text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from producao p join organization_members om on om.org_id=p.org_id where p.id=p_producao_id and om.user_id=p_user_id and om.role in ('owner','admin','manager'))
  then raise exception 'Acesso negado'; end if;
  update producao set situacao=p_situacao, updated_at=now() where id=p_producao_id;
end; $$;

create or replace function set_producao_archived(p_user_id uuid, p_producao_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from producao p join organization_members om on om.org_id=p.org_id where p.id=p_producao_id and om.user_id=p_user_id and om.role in ('owner','admin','manager'))
  then raise exception 'Acesso negado'; end if;
  update producao set archived=p_archived, updated_at=now() where id=p_producao_id;
end; $$;

grant execute on function create_producao(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function update_producao(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function set_producao_situacao(uuid,uuid,text) to anon, authenticated;
grant execute on function set_producao_archived(uuid,uuid,boolean) to anon, authenticated;

notify pgrst, 'reload schema';
