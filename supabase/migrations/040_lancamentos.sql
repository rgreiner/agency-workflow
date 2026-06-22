-- 040_lancamentos.sql
-- Financeiro: lançamentos gerados a partir das mídias faturadas (comissão da agência).
-- A integração/export com o Conta Azul entra depois. Idempotente.

create table if not exists lancamentos (
  id                uuid primary key default uuid_generate_v4(),
  org_id            uuid not null references organizations(id) on delete cascade,
  tipo              text not null default 'entrada',  -- entrada (a receber) | saida (a pagar)
  origem_tipo       text,                              -- midia | producao | fee | manual
  origem_id         uuid,
  contato_tipo      text,                              -- veiculo | cliente | fornecedor
  contato_nome      text,
  descricao         text,
  valor             numeric(14,2) not null default 0,
  vencimento        date,
  situacao          text not null default 'em_aberto', -- em_aberto | recebido | pago
  conta_corrente_id uuid,                              -- (futuro, com Conta Azul)
  created_by        uuid references profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_lancamentos_org on lancamentos(org_id);
create index if not exists idx_lancamentos_origem on lancamentos(origem_tipo, origem_id);

alter table lancamentos enable row level security;

drop policy if exists "Org members read lancamentos" on lancamentos;
create policy "Org members read lancamentos" on lancamentos
  for select using (is_org_member(org_id));

drop policy if exists "Manager+ manage lancamentos" on lancamentos;
create policy "Manager+ manage lancamentos" on lancamentos
  for all using (org_member_role(org_id) in ('owner','admin','manager'));

drop trigger if exists set_lancamentos_updated_at on lancamentos;
create trigger set_lancamentos_updated_at before update on lancamentos
  for each row execute function set_updated_at();

-- ── Geração do lançamento de comissão de uma mídia ───────────
-- Idempotente: remove o(s) lançamento(s) anteriores da mídia e recria conforme a
-- situação. Não mexe em lançamentos já liquidados (recebido/pago).
create or replace function gerar_lancamento_midia(p_midia_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m record;
  v_comissao numeric(14,2);
  v_base date;
  v_venc date;
  v_pagador text;
  v_contato_tipo text;
  v_contato_nome text;
begin
  select mi.*, w.name as cliente_nome, ve.name as veiculo_nome
    into m
    from midias mi
    join workspaces w on w.id = mi.workspace_id
    join veiculos ve on ve.id = mi.veiculo_id
    where mi.id = p_midia_id;
  if not found then return; end if;

  -- preserva lançamentos já liquidados
  if exists (
    select 1 from lancamentos
    where origem_tipo = 'midia' and origem_id = p_midia_id and situacao in ('recebido','pago')
  ) then return; end if;

  delete from lancamentos where origem_tipo = 'midia' and origem_id = p_midia_id;

  if m.situacao <> 'faturado' then return; end if;

  v_comissao := round(coalesce(m.valor,0) * coalesce(m.desconto_pct,0) / 100.0, 2);

  v_base := case
    when m.prazo = 'a_vista' then m.data_base
    when m.prazo = '10_dfm' then (date_trunc('month', m.data_base) + interval '1 month - 1 day')::date + 10
    when m.prazo = '15_dfm' then (date_trunc('month', m.data_base) + interval '1 month - 1 day')::date + 15
    when m.prazo = '20_dfm' then (date_trunc('month', m.data_base) + interval '1 month - 1 day')::date + 20
    when m.prazo = '30_dfm' then (date_trunc('month', m.data_base) + interval '1 month - 1 day')::date + 30
    else m.data_base
  end;
  v_venc := case when v_base is not null then v_base + coalesce(m.dias_agencia, 0) else null end;

  -- quem paga a comissão da agência (ver memória regras-faturamento-midia)
  v_pagador := case
    when m.faturamento in ('valor_bruto','liquido_contra_agencia') then 'veiculo'
    when m.faturamento = 'valor_bruto_comissao_cliente' then 'cliente'
    else 'cliente'
  end;
  if v_pagador = 'veiculo' then
    v_contato_tipo := 'veiculo'; v_contato_nome := m.veiculo_nome;
  else
    v_contato_tipo := 'cliente'; v_contato_nome := m.cliente_nome;
  end if;

  insert into lancamentos (
    org_id, tipo, origem_tipo, origem_id, contato_tipo, contato_nome,
    descricao, valor, vencimento, situacao, created_by
  ) values (
    m.org_id, 'entrada', 'midia', p_midia_id, v_contato_tipo, v_contato_nome,
    'Desconto Padrão Agência', v_comissao, v_venc, 'em_aberto', m.created_by
  );
end; $$;

-- set_midia_situacao agora gera/remove o lançamento conforme a situação.
create or replace function set_midia_situacao(p_user_id uuid, p_midia_id uuid, p_situacao text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from midias m
    join organization_members om on om.org_id = m.org_id
    where m.id = p_midia_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update midias set situacao = p_situacao, updated_at = now() where id = p_midia_id;
  perform gerar_lancamento_midia(p_midia_id);
end; $$;

-- update_midia também ressincroniza o lançamento (caso edite uma mídia já faturada).
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

  perform gerar_lancamento_midia(p_midia_id);
end; $$;

-- Backfill: regera os lançamentos das mídias faturadas da org (botão "Gerar Lançamentos").
create or replace function regerar_lancamentos_midias(p_user_id uuid, p_org_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  for r in select id from midias where org_id = p_org_id and situacao = 'faturado' loop
    perform gerar_lancamento_midia(r.id);
  end loop;
end; $$;

grant execute on function gerar_lancamento_midia(uuid) to anon, authenticated;
grant execute on function set_midia_situacao(uuid,uuid,text) to anon, authenticated;
grant execute on function update_midia(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function regerar_lancamentos_midias(uuid,uuid) to anon, authenticated;

notify pgrst, 'reload schema';
