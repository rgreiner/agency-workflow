-- 115_doc_series.sql
-- Numeração própria de documentos, por SÉRIE, continuando a sequência histórica do Siga.
--
-- Contexto: no Siga todo documento liberado tem um número com prefixo (PP 1896, MX 1625,
-- Fee 63, ...). O Flow gravava um `numero` que recomeçava do zero e não tinha prefixo.
-- Aqui: (1) tabela de contadores por série, (2) função que "queima" e devolve o próximo
-- número (gaps são OK — o que importa é ser único e pesquisável), (3) coluna `serie` em
-- producao/midias, (4) fiação de create/update, (5) seed dos últimos números do Siga,
-- (6) tabela de histórico consultável com os documentos do último ano.
--
-- Séries e mapeamento (confirmado com o Rafael):
--   PP  = Pedido de Produção   (producao tipo=pedido)
--   PR  = Projeto/Proposta     (producao tipo=proposta)
--   FEE = Fee                  (producao tipo=fee)
--   MX  = Mídia Externa        (midias tipo=externa)
--   ME  = Mídia Eletrônica     (midias tipo=eletronica — TV/rádio)
--   MI  = Mídia Impressa       (midias tipo=impressa_jornal|impressa_revista)
--   MS  = Mídia Digital/Social (midias tipo=digital — default)
--   MD  = Mídia CGN/Portais    (midias tipo=digital com serie=MD)
--   (Orçamento é interno: mantém numeração própria, sem série externa.)
-- Idempotente.

-- ── Contadores por série ─────────────────────────────────────
create table if not exists doc_series (
  org_id         uuid    not null references organizations(id) on delete cascade,
  serie          text    not null,   -- PP, PR, FEE, MX, ME, MS, MD, MI, ...
  prefixo        text,               -- como aparece no documento (default = serie)
  label          text,               -- descrição amigável
  proximo_numero integer not null default 1,
  updated_at     timestamptz not null default now(),
  primary key (org_id, serie)
);

alter table doc_series enable row level security;
drop policy if exists "Org members read doc_series" on doc_series;
create policy "Org members read doc_series" on doc_series for select using (is_org_member(org_id));
drop policy if exists "Manager+ manage doc_series" on doc_series;
create policy "Manager+ manage doc_series" on doc_series for all using (org_member_role(org_id) in ('owner','admin','manager'));

-- Queima e devolve o próximo número da série (cria o contador em 1 se não existir).
create or replace function next_doc_numero(p_org_id uuid, p_serie text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_num integer;
begin
  insert into doc_series (org_id, serie, prefixo)
  values (p_org_id, p_serie, p_serie)
  on conflict (org_id, serie) do nothing;

  update doc_series
     set proximo_numero = proximo_numero + 1, updated_at = now()
   where org_id = p_org_id and serie = p_serie
   returning proximo_numero - 1 into v_num;

  return v_num;
end; $$;

-- Mapeia o tipo do documento na sua série. Devolve null quando não há série externa
-- (ex.: orçamento interno, ou mídia ainda sem tipo definido).
create or replace function serie_de_producao(p_tipo text)
returns text language sql immutable as $$
  select case p_tipo
    when 'pedido'   then 'PP'
    when 'fee'      then 'FEE'
    when 'proposta' then 'PR'
    else null
  end;
$$;

create or replace function serie_de_midia(p_tipo text, p_serie text default null)
returns text language sql immutable as $$
  select case
    when p_tipo = 'externa'          then 'MX'
    when p_tipo = 'eletronica'       then 'ME'
    when p_tipo like 'impressa%'     then 'MI'
    when p_tipo = 'digital'          then coalesce(nullif(p_serie,''), 'MS')
    else nullif(p_serie,'')  -- 'outros'/sem tipo: só se vier série explícita
  end;
$$;

-- ── Coluna `serie` nos documentos ────────────────────────────
alter table producao add column if not exists serie text;
alter table midias   add column if not exists serie text;
create index if not exists idx_producao_serie on producao(org_id, serie);
create index if not exists idx_midias_serie   on midias(org_id, serie);

-- ── Seed dos últimos números do Siga ─────────────────────────
-- Aplica só nas orgs que JÁ têm produção/mídia (a One a One hoje). `greatest` garante
-- que re-rodar nunca rebobina um contador que já avançou.
insert into doc_series (org_id, serie, prefixo, label, proximo_numero)
select o.id, s.serie, s.serie, s.label, s.prox
from organizations o
cross join (values
  ('PP', 'Pedido de Produção',   1897),
  ('PR', 'Projeto/Proposta',      145),
  ('FEE','Fee',                    64),
  ('MX', 'Mídia Externa',        1626),
  ('ME', 'Mídia Eletrônica',     1578),
  ('MS', 'Mídia Digital/Social',  831),
  ('MD', 'Mídia CGN/Portais',     147),
  ('MI', 'Mídia Impressa',        403)
) as s(serie, label, prox)
where exists (select 1 from producao p where p.org_id = o.id)
   or exists (select 1 from midias   m where m.org_id = o.id)
on conflict (org_id, serie) do update
  set proximo_numero = greatest(doc_series.proximo_numero, excluded.proximo_numero),
      label          = excluded.label,
      prefixo        = excluded.prefixo,
      updated_at     = now();

-- Backfill da série nos documentos já existentes no Flow (display consistente).
update producao set serie = serie_de_producao(tipo) where serie is null and serie_de_producao(tipo) is not null;
update midias   set serie = serie_de_midia(tipo)     where serie is null and serie_de_midia(tipo) is not null;

-- ── create_producao: grava série + número da série ───────────
create or replace function create_producao(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_numero integer; v_tipo text; v_serie text;
begin
  if not exists (select 1 from organization_members where org_id=p_org_id and user_id=p_user_id and role in ('owner','admin','manager'))
  then raise exception 'Acesso negado'; end if;
  v_tipo := coalesce(nullif(p_data->>'tipo',''), 'orcamento');
  v_serie := serie_de_producao(v_tipo);

  if v_serie is not null then
    v_numero := next_doc_numero(p_org_id, v_serie);         -- PP / FEE / PR: contador da série
  else
    select coalesce(max(numero),0)+1 into v_numero          -- orçamento: numeração interna
      from producao where org_id=p_org_id and tipo=v_tipo;
  end if;

  insert into producao (org_id, numero, serie, tipo, workspace_id, campaign_id, titulo, faturar, emissao, validade_dias,
    bv_pct, honorarios_pct, valor, codigo_identificador, nota_fiscal, situacao, observacao, texto_legal, contato, responsavel_id, detalhe, created_by)
  values (p_org_id, v_numero, v_serie, v_tipo, (p_data->>'workspace_id')::uuid, nullif(p_data->>'campaign_id','')::uuid,
    coalesce(nullif(p_data->>'titulo',''),'(sem título)'), nullif(p_data->>'faturar',''), nullif(p_data->>'emissao','')::date,
    nullif(p_data->>'validade_dias','')::int, coalesce(nullif(p_data->>'bv_pct','')::numeric,15), coalesce(nullif(p_data->>'honorarios_pct','')::numeric,0),
    coalesce(nullif(p_data->>'valor','')::numeric,0), nullif(p_data->>'codigo_identificador',''), nullif(p_data->>'nota_fiscal',''),
    coalesce(nullif(p_data->>'situacao',''),'em_aberto'), nullif(p_data->>'observacao',''), nullif(p_data->>'texto_legal',''),
    nullif(p_data->>'contato',''), nullif(p_data->>'responsavel_id','')::uuid, coalesce(p_data->'detalhe','{}'::jsonb), p_user_id)
  returning id into v_id;
  return v_id;
end; $$;

-- ── create_midia: grava série + número da série ──────────────
-- Tipos definidos (externa/eletronica/impressa/digital) queimam o número na criação.
-- 'outros' / sem tipo ficam sem série e sem número até serem classificados (update).
create or replace function create_midia(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_numero integer; v_tipo text; v_serie text;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  v_tipo  := nullif(p_data->>'tipo','');
  v_serie := serie_de_midia(v_tipo, p_data->>'serie');
  if v_serie is not null then
    v_numero := next_doc_numero(p_org_id, v_serie);
  else
    v_numero := null;
  end if;

  insert into midias (
    org_id, numero, serie, workspace_id, campaign_id, veiculo_id, tipo, titulo, emissao, job,
    aut_veiculo, codigo_identificador, nota_fiscal, pecas, praca, abrangencia,
    valor, desconto_pct, faturamento, prazo, data_base, dias_agencia,
    primeira_veiculacao, ultima_veiculacao, contato, responsavel_id, situacao,
    observacao, texto_legal, created_by
  ) values (
    p_org_id, v_numero, v_serie,
    (p_data->>'workspace_id')::uuid,
    nullif(p_data->>'campaign_id','')::uuid,
    (p_data->>'veiculo_id')::uuid,
    v_tipo,
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

-- ── update_midia: atribui série/número ao classificar (lazy) ─
-- Mantém a assinatura original + atribui número quando um rascunho 'outros' ganha tipo.
create or replace function update_midia(p_user_id uuid, p_midia_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_serie_atual text; v_num_atual integer; v_novo_tipo text; v_nova_serie text; v_num integer;
begin
  select org_id, serie, numero into v_org, v_serie_atual, v_num_atual
    from midias m where m.id = p_midia_id;
  if not exists (
    select 1 from organization_members om
    where om.org_id = v_org and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  v_novo_tipo  := nullif(p_data->>'tipo','');
  v_nova_serie := serie_de_midia(v_novo_tipo, coalesce(p_data->>'serie', v_serie_atual));
  -- Queima número novo quando ainda não tinha (rascunho classificado agora) OU
  -- quando a série mudou (reclassificação): o número tem que pertencer à sua série.
  if v_nova_serie is not null and (v_num_atual is null or v_nova_serie is distinct from v_serie_atual) then
    v_num := next_doc_numero(v_org, v_nova_serie);
  else
    v_num := v_num_atual;
  end if;

  update midias set
    numero               = v_num,
    serie                = coalesce(v_nova_serie, serie),
    workspace_id         = coalesce(nullif(p_data->>'workspace_id','')::uuid, workspace_id),
    campaign_id          = nullif(p_data->>'campaign_id','')::uuid,
    veiculo_id           = coalesce(nullif(p_data->>'veiculo_id','')::uuid, veiculo_id),
    tipo                 = v_novo_tipo,
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

grant execute on function next_doc_numero(uuid,text)  to anon, authenticated;
grant execute on function serie_de_producao(text)     to anon, authenticated;
grant execute on function serie_de_midia(text,text)   to anon, authenticated;
grant execute on function create_producao(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function create_midia(uuid,uuid,jsonb)    to anon, authenticated;
grant execute on function update_midia(uuid,uuid,jsonb)    to anon, authenticated;

-- ── Histórico consultável (documentos gerados no Siga) ───────
create table if not exists doc_historico (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organizations(id) on delete cascade,
  serie         text not null,
  numero        integer not null,
  documento     text not null,       -- "PP 1673"
  emissao       date,
  vencimento    date,
  contato       text,                 -- fornecedor/veículo
  descricao     text,
  categoria     text,
  centro_custos text,
  conta_corrente text,
  cliente       text,
  empresa       text,
  valor         numeric(14,2),
  fonte         text not null default 'siga',
  created_at    timestamptz not null default now()
);
create index if not exists idx_doc_historico_org      on doc_historico(org_id);
create index if not exists idx_doc_historico_doc      on doc_historico(org_id, serie, numero);
create index if not exists idx_doc_historico_busca    on doc_historico using gin (to_tsvector('portuguese', coalesce(documento,'')||' '||coalesce(descricao,'')||' '||coalesce(cliente,'')||' '||coalesce(contato,'')));

alter table doc_historico enable row level security;
drop policy if exists "Org members read doc_historico" on doc_historico;
create policy "Org members read doc_historico" on doc_historico for select using (is_org_member(org_id));
drop policy if exists "Manager+ manage doc_historico" on doc_historico;
create policy "Manager+ manage doc_historico" on doc_historico for all using (org_member_role(org_id) in ('owner','admin','manager'));

-- Import do histórico (idempotente por org+documento+descricao+vencimento+valor).
insert into doc_historico (org_id, serie, numero, documento, emissao, vencimento, contato, descricao, categoria, centro_custos, conta_corrente, cliente, empresa, valor, fonte)
select org.id, v.serie, v.numero, v.documento, v.emissao, v.vencimento, v.contato, v.descricao, v.categoria, v.centro_custos, v.conta_corrente, v.cliente, v.empresa, v.valor, 'siga'
from (
  select id from organizations o
  where exists (select 1 from producao p where p.org_id=o.id)
     or exists (select 1 from midias   m where m.org_id=o.id)
  order by created_at asc
  limit 1
) org
cross join (values
('PP',1509,'PP 1509',date '2025-11-28',date '2024-05-31','Adi Gráfica Rápida','Boneco catalogo institucional - Construtora SF - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',50.3),
('PP',1527,'PP 1527',date '2025-11-28',date '2024-06-27','Adi Gráfica Rápida','Bonecos - Folder Rocambole - Construtora SF - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',44.48),
('PP',1570,'PP 1570',date '2025-11-28',date '2024-09-02','Adi Gráfica Rápida','Convites - Lançamento Olympus  - Construtora SF - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',24.99),
('PP',1571,'PP 1571',date '2025-11-28',date '2024-09-02','Adi Gráfica Rápida','Pulseiras de identificação - Evento de lançamento Olympus  - Construtora SF - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',73.5),
('PP',1656,'PP 1656',date '2025-11-28',date '2025-01-20','Adi Gráfica Rápida','Banner - Comum - Construtora SF - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',64.8),
('PP',1673,'PP 1673',date '2025-12-04',date '2025-02-10','Web Thomaz','CRIAÇÃO DE WEBSITE - KSBIG - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',225.0),
('MD',130,'MD 130',date '2025-09-09',date '2025-02-15','CGN','SF Empreendimentos | CGN | Janeiro  - Construtora SF - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',600.0),
('PP',1673,'PP 1673',date '2025-12-04',date '2025-03-10','Web Thomaz','CRIAÇÃO DE WEBSITE - KSBIG - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',104.5),
('MD',131,'MD 131',date '2025-09-09',date '2025-03-15','CGN','SF Empreendimentos | CGN | Fevereiro  - Construtora SF - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',600.0),
('PP',1673,'PP 1673',date '2025-12-04',date '2025-04-10','Web Thomaz','CRIAÇÃO DE WEBSITE - KSBIG - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',104.5),
('MD',132,'MD 132',date '2025-09-09',date '2025-04-15','CGN','SF Empreendimentos | CGN | Março - Construtora SF - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',600.0),
('PP',1673,'PP 1673',date '2025-12-04',date '2025-05-10','Web Thomaz','CRIAÇÃO DE WEBSITE - KSBIG - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',104.5),
('MD',133,'MD 133',date '2025-09-09',date '2025-05-15','CGN','SF Empreendimentos | CGN | Abril - Construtora SF - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',600.0),
('PR',142,'PR 142',date '2025-08-28',date '2025-06-10','Di Napoli','Projeto lançamento Di Napoli -','1. Receitas Operacionais','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',13500.0),
('MD',134,'MD 134',date '2025-09-09',date '2025-06-15','CGN','SF Empreendimentos | CGN | Maio - Construtora SF - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',600.0),
('PP',1752,'PP 1752',date '2025-11-28',date '2025-06-20','Adi Gráfica Rápida','ADESIVOS E VOUCHERS - EVENTO DE VENDAS  - Construtora SF - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',66.83),
('MS',794,'MS 794',date '2025-12-10',date '2025-06-20','Tarobá FM','Mascor Empreendimentos | Maranello | Ação Rádio Tarobá | Dezembro - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',240.0),
('PR',142,'PR 142',date '2025-08-28',date '2025-07-10','Di Napoli','Projeto lançamento Di Napoli -','1. Receitas Operacionais','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',13500.0),
('MD',135,'MD 135',date '2025-09-09',date '2025-07-15','CGN','SF Empreendimentos | CGN | Junho  - Construtora SF - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',600.0),
('PP',1755,'PP 1755',date '2025-11-28',date '2025-07-25','Adi Gráfica Rápida','CONVITES CORRETORES - VALE A PENA VENDER DE NOVO  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',32.63),
('PP',1759,'PP 1759',date '2025-11-28',date '2025-08-04','Adi Gráfica Rápida','CONVITES CORRETORES - VALE A PENA VENDER DE NOVO - AJUSTE  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',32.63),
('PP',1783,'PP 1783',date '2025-08-08',date '2025-08-08','Midia Fix','DPL DIST PEÇAS - FACHADA ALTERAÇÃO 2 - DPL - Distribuidora - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','DPL - Distribuidora','One a One Comunicação e Estratégia',5452.54),
('FEE',58,'FEE 58',date '2025-08-01',date '2025-08-08','Opera','Fee | Agenciamento publicitário -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',10000.0),
('PP',1778,'PP 1778',date '2025-08-05',date '2025-08-08','Midia Fix','TROFÉU ENCANTO CORRETORES - Construtora SF - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',36.12),
('PR',142,'PR 142',date '2025-08-28',date '2025-08-10','Di Napoli','Projeto lançamento Di Napoli -','1. Receitas Operacionais','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',13500.0),
('PP',1767,'PP 1767',date '2025-11-28',date '2025-08-11','Adi Gráfica Rápida','CARTÕES PREMIAÇÃO CORRETORES  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',22.5),
('MS',748,'MS 748',date '2025-08-06',date '2025-08-11','Dinâmica Merchandising','Dinamica Merchandising | Google | Julho  - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Dinâmica Merchandising','One a One Comunicação e Estratégia',1002.18),
('MS',749,'MS 749',date '2025-08-06',date '2025-08-11','KSBIG','KSBIG | Google | Julho  - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',13.94),
('MS',746,'MS 746',date '2025-08-06',date '2025-08-11','MASCOR','Mascor | Google | Julho  - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',1605.97),
('MS',745,'MS 745',date '2025-08-06',date '2025-08-11','MASCOR','Mascor | Meta | Julho  - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',1645.84),
('MS',747,'MS 747',date '2025-08-05',date '2025-08-11','Construtora SF','SF Empreendimentos | Meta | Julho  - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',390.67),
('MD',136,'MD 136',date '2025-09-09',date '2025-08-15','CGN','SF Empreendimentos | CGN | Julho - Construtora SF - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',600.0),
('PP',1777,'PP 1777',date '2025-07-31',date '2025-08-22','ADI Soluções Gráficas','BONECO - FOLDER A3 DI NAPOLI VOLTOU  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',10.2),
('ME',1543,'ME 1543',date '2025-08-18',date '2025-08-22','MASCOR','Mascor | RPC | Julho - Final Mundial de Clubes - RPC Cascavel - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',374.74),
('PP',1785,'PP 1785',date '2025-08-08',date '2025-08-25','Daniel Xavier Violinista','VIOLINISTA DIA DOS PAIS  - Jardins Cemitério-Parque  - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Jardins Cemitério-Parque','One a One Comunicação e Estratégia',88.23),
('PP',1792,'PP 1792',date '2025-08-18',date '2025-09-01','MOBIMKT','LANDING PAGE DI NAPOLI  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',141.75),
('PP',1794,'PP 1794',date '2025-08-19',date '2025-09-02','Di Napoli','COFFEE BREAK CORRETEORES  - Bom Gosto  - Honorários','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',377.7),
('PP',1796,'PP 1796',date '2025-08-19',date '2025-09-02','DC Som e Luz','EVENTO CORRETORES SOM E LUZ - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',975.0),
('PP',1803,'PP 1803',date '2025-08-21',date '2025-09-03','FineArt','FIGURANTES - FILME DI NAPOLI VOLTOU - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',180.0),
('PP',1795,'PP 1795',date '2025-08-19',date '2025-09-05','Di Napoli','COFFEE BREAK MORADORES  - Bom Gosto  - Honorários','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',377.7),
('PP',1795,'PP 1795',date '2025-08-28',date '2025-09-05','Di Napoli','COFFEE BREAK MORADORES  - Bom Gosto  - Honorários','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',392.7),
('PP',1800,'PP 1800',date '2025-08-19',date '2025-09-05','DC Som e Luz','EVENTO MORADORES SOM E LUZ - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',375.0),
('PP',1781,'PP 1781',date '2025-08-08',date '2025-09-05','FineArt','FILME - DI NAPOLI VOLTOU  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',1237.5),
('PP',1781,'PP 1781',date '2025-08-21',date '2025-09-05','FineArt','FILME - DI NAPOLI VOLTOU  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',1237.5),
('PP',1804,'PP 1804',date '2025-08-21',date '2025-09-05','GOLDING STARS','PIPOQUEIRA / ALGODÃO DOCE EVENTO MORADORES - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',132.37),
('PP',1786,'PP 1786',date '2025-08-08',date '2025-09-08','Di Napoli','BANDEIRA  - Meinerz Esportes - Honorários','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',53.04),
('PP',1779,'PP 1779',date '2025-08-08',date '2025-09-08','Di Napoli','CAMISETAS CAMPANHA  - Meinerz Esportes - Honorários','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',360.0),
('FEE',58,'FEE 58',date '2025-08-01',date '2025-09-08','Opera','Fee | Agenciamento publicitário -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',10000.0),
('MS',756,'MS 756',date '2025-09-07',date '2025-09-10','Di Napoli','Di Napoli | Google | Agosto - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',625.51),
('MS',755,'MS 755',date '2025-09-07',date '2025-09-10','MASCOR','Mascor | Google | Agosto  - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',1083.58),
('PR',142,'PR 142',date '2025-08-28',date '2025-09-10','Di Napoli','Projeto lançamento Di Napoli -','1. Receitas Operacionais','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',13500.0),
('MS',758,'MS 758',date '2025-09-07',date '2025-09-11','COMIL SILOS','Comil | Meta | Agosto  - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',36.94),
('MS',759,'MS 759',date '2025-09-07',date '2025-09-11','Di Napoli','Di Napoli | Meta | Agosto  - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',1041.23),
('MS',760,'MS 760',date '2025-09-07',date '2025-09-11','KSBIG','KSBIG | Meta | Agosto  - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',195.17),
('MS',757,'MS 757',date '2025-09-07',date '2025-09-11','MASCOR','Mascor | Meta | Agosto  - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',1188.26),
('PP',1784,'PP 1784',date '2025-08-08',date '2025-09-15','ADI Soluções Gráficas','CONVITE FÍSICO - COFFEE CORRETORES  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',84.0),
('PP',1775,'PP 1775',date '2025-09-10',date '2025-09-15','FineArt','FILME - CAMPANHA FRUTA FELIZ  - KSBIG - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',4233.34),
('MD',137,'MD 137',date '2025-09-09',date '2025-09-15','CGN','SF Empreendimentos | CGN | Agosto - Construtora SF - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',600.0),
('PP',1808,'PP 1808',date '2025-09-02',date '2025-09-19','KSBIG','CANETAS PERSOANLIZADAS - PREMIER BRINDES - 02 - Honorários','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',70.5),
('MX',1495,'MX 1495',date '2025-08-18',date '2025-09-22','Múltipla Mídia','Residencial Dinapoli | Campanha O Campeão Voltou | Múltipla Mídia | Agosto - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',1009.65),
('ME',1545,'ME 1545',date '2025-08-15',date '2025-09-22','RÁDIO CAPITAL FM.','Residencial Dinapoli | Campanha O Campeão Voltou | Rádio Capital FM | Agosto - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',500.0),
('ME',1548,'ME 1548',date '2025-08-19',date '2025-09-22','Rádio Massa Cascavel','Residencial Dinapoli | Campanha O Campeão Voltou | Rádio Massa FM | Agosto - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',130.18),
('ME',1546,'ME 1546',date '2025-08-15',date '2025-09-22','Tarobá FM','Residencial Dinapoli | Campanha O Campeão Voltou | Rádio Tarobá FM | Agosto - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',302.4),
('ME',1550,'ME 1550',date '2025-08-19',date '2025-09-22','Di Napoli','Residencial Dinapoli | Campanha O Campeão Voltou | RIC TV OESTE | Agosto - RICTV OESTE - TOLEDO - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',609.86),
('ME',1551,'ME 1551',date '2025-08-21',date '2025-09-22','Di Napoli','Residencial Dinapoli | Campanha O Campeão Voltou | RPC | Agosto | AGOLIBERT - RPC Cascavel - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',490.2),
('ME',1551,'ME 1551',date '2025-09-02',date '2025-09-22','Di Napoli','Residencial Dinapoli | Campanha O Campeão Voltou | RPC | Agosto | AGOLIBERT - RPC Cascavel - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',431.38),
('ME',1547,'ME 1547',date '2025-08-15',date '2025-09-22','RPC Cascavel','Residencial Dinapoli | Campanha O Campeão Voltou | RPC | Agosto | AGOSTO25 - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',3499.58),
('ME',1547,'ME 1547',date '2025-09-02',date '2025-09-22','Di Napoli','Residencial Dinapoli | Campanha O Campeão Voltou | RPC | Agosto | AGOSTO25 - RPC Cascavel - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',3499.59),
('MX',1498,'MX 1498',date '2025-09-02',date '2025-09-22','Outmar propagandas','Residencial Dinapoli | O Campeão Voltou | Outmar | Bi 36 - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',67.5),
('MX',1493,'MX 1493',date '2025-08-08',date '2025-09-22','Outmar propagandas','Residencial Dinapoli | Teaser | Outmar | Bi 34 - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',22.5),
('MX',1467,'MX 1467',date '2025-08-08',date '2025-09-22','Vision Outdoor','Vision Outdoor | Di Napoli | BI 34  - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',2238.0),
('MX',1492,'MX 1492',date '2025-08-21',date '2025-09-22','Vision Outdoor','Vision Outdoor | Di Napoli | BI 36 - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',932.5),
('PP',1791,'PP 1791',date '2025-08-15',date '2025-09-25','Positiva','CAIXA P CASA DE POST IT - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',108.0),
('PP',1790,'PP 1790',date '2025-08-15',date '2025-09-25','ADI Soluções Gráficas','FOLDER A3 DI NAPOLI VOLTOU  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',486.0),
('PP',1780,'PP 1780',date '2025-08-08',date '2025-09-25','Edison Lucas Fotografia','FOTOS CAMPANHA  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',315.0),
('PP',1802,'PP 1802',date '2025-08-21',date '2025-09-26','Di Napoli','CAMISETAS CAMPANHA - SEGUNDA PRODUÇÃO  - Meinerz Esportes - Honorários','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',150.0),
('PP',1799,'PP 1799',date '2025-08-19',date '2025-09-26','ADI Soluções Gráficas','CONVITES FÍSICOS FIGURAS PÚBLICAS - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',18.0),
('PP',1812,'PP 1812',date '2025-09-09',date '2025-09-26','MOBIMKT','NOVA LANDING PAGE  - Jardins Cemitério-Parque  - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Jardins Cemitério-Parque','One a One Comunicação e Estratégia',141.75),
('PP',1793,'PP 1793',date '2025-08-18',date '2025-09-29','Site Stickers','ADESIVO JANELA PÉROLA/NATAL 1845 - Construtora SF - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',108.0),
('PP',1787,'PP 1787',date '2025-08-08',date '2025-09-29','Valdir Pqd','CAPTAÇÃO - EVENTO MORADORES  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',150.0),
('PP',1801,'PP 1801',date '2025-08-21',date '2025-09-29','ADI Soluções Gráficas','FOLDERS A3 DI NAPOLI VOLTOU  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',486.0),
('PP',1798,'PP 1798',date '2025-08-19',date '2025-09-29','NALDO PAINÉIS','PLOTAGEM CENTRAL DE VENDAS - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',729.0),
('PP',1806,'PP 1806',date '2025-09-02',date '2025-10-02','ADI Soluções Gráficas','FLYER DI NAPOLI VOLTOU  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',265.5),
('PP',1782,'PP 1782',date '2025-08-08',date '2025-10-02','MRG | O som tá na gente','SPOT/JINGLE CAMPANHA  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',525.0),
('PP',1781,'PP 1781',date '2025-08-08',date '2025-10-05','FineArt','FILME - DI NAPOLI VOLTOU  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',1237.5),
('PP',1781,'PP 1781',date '2025-08-21',date '2025-10-05','FineArt','FILME - DI NAPOLI VOLTOU  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',1237.5),
('PP',1820,'PP 1820',date '2025-09-29',date '2025-10-07','Danieli Terluk','COBERTURA - BRASA  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',150.0),
('PP',1810,'PP 1810',date '2025-09-07',date '2025-10-07','Valdir Pqd','FILME - INSTITUCIONAL  - Jardins Cemitério-Parque  - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Jardins Cemitério-Parque','One a One Comunicação e Estratégia',1050.0),
('PP',1812,'PP 1812',date '2025-09-07',date '2025-10-07','MOBIMKT','NOVA LANDING PAGE  - Jardins Cemitério-Parque  - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Jardins Cemitério-Parque','One a One Comunicação e Estratégia',141.75),
('PP',1779,'PP 1779',date '2025-08-08',date '2025-10-08','Di Napoli','CAMISETAS CAMPANHA  - Meinerz Esportes - Honorários','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',360.0),
('FEE',58,'FEE 58',date '2025-08-01',date '2025-10-08','Opera','Fee | Agenciamento publicitário -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',10000.0),
('PP',1817,'PP 1817',date '2025-09-22',date '2025-10-08','Pétros Filmes','VIDEOS: CAMPANHA + COUNTRY  - Opera - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',1650.0),
('PR',142,'PR 142',date '2025-08-28',date '2025-10-10','Di Napoli','Projeto lançamento Di Napoli -','1. Receitas Operacionais','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',13500.0),
('PP',1813,'PP 1813',date '2025-09-12',date '2025-10-13','Escala Indústria Gráfica','CATALOGO - Opera - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',1049.36),
('MS',765,'MS 765',date '2025-10-10',date '2025-10-13','COMIL SILOS','COMIL | GOOGLE | SETEMBRO  - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',149.68),
('MS',766,'MS 766',date '2025-10-10',date '2025-10-13','COMIL SILOS','COMIL | META | SETEMBRO  - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',371.94),
('MS',762,'MS 762',date '2025-10-09',date '2025-10-13','Di Napoli','DI NAPOLI | GOOGLE | SETEMBRO  - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',874.49),
('MS',761,'MS 761',date '2025-10-09',date '2025-10-13','Di Napoli','DI NAPOLI | META | SETEMBRO  - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',296.6),
('MS',768,'MS 768',date '2025-10-15',date '2025-10-13','KSBIG','KSBIG | GOOGLE | SETEMBRO  - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',189.96),
('MS',767,'MS 767',date '2025-10-15',date '2025-10-13','KSBIG','KSBIG | META | SETEMBRO  - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',894.46),
('MS',764,'MS 764',date '2025-10-10',date '2025-10-13','MASCOR','MASCOR | GOOGLE | SETEMBRO  - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',1333.25),
('MS',763,'MS 763',date '2025-10-10',date '2025-10-13','MASCOR','MASCOR | META | SETEMBRO  - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',1257.93),
('PP',1818,'PP 1818',date '2025-09-22',date '2025-10-13','IMPRESSÃO 3D FÁCIL','PROTÓTIPO COFRINHO  - COMIL SILOS - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',18.0),
('PP',1775,'PP 1775',date '2025-09-10',date '2025-10-15','FineArt','FILME - CAMPANHA FRUTA FELIZ  - KSBIG - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',4233.33),
('MD',138,'MD 138',date '2025-09-09',date '2025-10-15','CGN','SF Empreendimentos | CGN | Setembro  - Construtora SF - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',600.0),
('PP',1826,'PP 1826',date '2025-10-14',date '2025-10-16','Mb Digital Comunicação Visual','TROFÉU DE ACRILICO - AÇÃO DE CORRETORES  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',38.68),
('PP',1816,'PP 1816',date '2025-09-12',date '2025-10-20','Site Stickers','FAIXA CENTRAL DE VENDAS - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',180.0),
('PP',1815,'PP 1815',date '2025-09-12',date '2025-10-20','ADI Soluções Gráficas','FLYERS DI NAPOLI VOLTOU  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',153.0),
('PP',1814,'PP 1814',date '2025-09-12',date '2025-10-20','ADI Soluções Gráficas','FOLDERS PIAZZA - Opera - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',435.76),
('ME',1538,'ME 1538',date '2025-09-02',date '2025-10-22','RÁDIO CAPITAL FM.','Mascor | Turim | Rádio Capital FM | Setembro - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',780.0),
('MX',1502,'MX 1502',date '2025-09-07',date '2025-10-22','Outmar propagandas','Mascor Empreendimentos | Turim | Outmar | BI 38 Produção - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',22.5),
('MX',1507,'MX 1507',date '2025-09-22',date '2025-10-22','Outmar propagandas','Mascor Empreendimentos | Turim | Outmar | BI 40 Produção - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',22.5),
('MX',1501,'MX 1501',date '2025-09-07',date '2025-10-22','Rede Outdoor','Mascor Empreendimentos | Turim | Rede Outdoor | BI 38 - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',186.0),
('MX',1506,'MX 1506',date '2025-09-22',date '2025-10-22','Rede Outdoor','Mascor Empreendimentos | Turim | Rede Outdoor | BI 40 - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',186.0),
('MX',1503,'MX 1503',date '2025-09-07',date '2025-10-22','Vision Outdoor','Mascor Empreendimentos | Turim | Vision Outdoor | BI 38 - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',559.5),
('MX',1504,'MX 1504',date '2025-09-07',date '2025-10-22','Vision Outdoor','Mascor Empreendimentos | Turim | Vision Outdoor | BI 40 - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',373.0),
('MS',754,'MS 754',date '2025-09-07',date '2025-10-22','Rádio Jovem Pan','Residencial Di Napoli | O Campeão Voltou | Rádio Jovem Pan | Peruinha da Pan - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',280.0),
('ME',1552,'ME 1552',date '2025-09-02',date '2025-10-22','Rádio Massa Cascavel','Residencial Dinapoli | Campanha O Campeão Voltou | Rádio Massa FM | Setembro - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',358.0),
('ME',1553,'ME 1553',date '2025-09-02',date '2025-10-22','Di Napoli','Residencial Dinapoli | Campanha O Campeão Voltou | RPC | Setembro | DINAPSETEM - RPC Cascavel - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',1045.44),
('ME',1549,'ME 1549',date '2025-09-02',date '2025-10-22','TV Tarobá','Residencial Dinapoli | Campanha O Campeão Voltou | TV Tarobá | Setembro - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',331.05),
('MX',1499,'MX 1499',date '2025-09-02',date '2025-10-22','Outmar propagandas','Residencial Dinapoli | O Campeão Voltou | Outmar | Bi 38 - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',67.5),
('MX',1499,'MX 1499',date '2025-09-12',date '2025-10-22','Outmar propagandas','Residencial Dinapoli | O Campeão Voltou | Outmar | Bi 38 - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',67.5),
('MX',1500,'MX 1500',date '2025-09-02',date '2025-10-22','Vision Outdoor','Vision Outdoor | O Campeão Voltou | Di Napoli | BI 38 - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',559.5),
('PP',1827,'PP 1827',date '2025-10-10',date '2025-10-23','Danieli Terluk','COBERTURA EVENTO DE LANÇAMENTO - D E G - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',75.0),
('PP',1802,'PP 1802',date '2025-08-21',date '2025-10-26','Di Napoli','CAMISETAS CAMPANHA - SEGUNDA PRODUÇÃO  - Meinerz Esportes - Honorários','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',150.0),
('PP',1819,'PP 1819',date '2025-09-22',date '2025-10-31','ADI Soluções Gráficas','BACKDROP EVENTO DE LANÇAMENTO  - Opera - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',67.5),
('PP',1811,'PP 1811',date '2025-09-07',date '2025-10-31','Valdir Pqd','COBERTURA - EVENTO DE LANÇAMENTO - Opera - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',315.0),
('PP',1821,'PP 1821',date '2025-09-29',date '2025-11-03','ADI Soluções Gráficas','FOLDER DI NAPOLI VOLTOU  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',504.0),
('PP',1822,'PP 1822',date '2025-09-29',date '2025-11-07','Mb Digital Comunicação Visual','PREMIAÇÃO CORRETORES  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',36.63),
('PP',1779,'PP 1779',date '2025-08-08',date '2025-11-08','Di Napoli','CAMISETAS CAMPANHA  - Meinerz Esportes - Honorários','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',360.0),
('FEE',58,'FEE 58',date '2025-08-01',date '2025-11-08','Opera','Fee | Agenciamento publicitário -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',10000.0),
('PP',1823,'PP 1823',date '2025-10-14',date '2025-11-10','Jardins Cemitério-Parque','COBERTURA DA CELEBRAÇÃO - FILMAKER  - Lucas LLexs - Honorários','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Jardins Cemitério-Parque','One a One Comunicação e Estratégia',150.0),
('PR',142,'PR 142',date '2025-08-28',date '2025-11-10','Di Napoli','Projeto lançamento Di Napoli -','1. Receitas Operacionais','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',13500.0),
('PP',1833,'PP 1833',date '2025-11-05',date '2025-11-10','FB BONÉS','VISEIRAS PERSONALIZADAS  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',123.52),
('PP',1831,'PP 1831',date '2025-11-05',date '2025-11-11','Top Terere Premium','COPOS PERSONALIZADOS  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',298.5),
('PP',1832,'PP 1832',date '2025-11-05',date '2025-11-11','D PROMOCIONAL BRINDES','SACOCHILA - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',111.23),
('MS',778,'MS 778',date '2025-11-07',date '2025-11-12','COMIL SILOS','Comil Silos e Secadores | Depois da Colheita, é Comil | Google | Outubro - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',234.1),
('MS',772,'MS 772',date '2025-11-07',date '2025-11-12','COMIL SILOS','Comil Silos e Secadores | Depois da Colheita, é Comil | Meta Ads | Outubro - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',991.51),
('MS',775,'MS 775',date '2025-11-11',date '2025-11-12','Jardins Cemitério-Parque','Jardins Cemitério Parque | Finados | Meta Ads | Outubro - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Jardins Cemitério-Parque','One a One Comunicação e Estratégia',574.17),
('MS',776,'MS 776',date '2025-11-07',date '2025-11-12','KSBIG','KSBIG | Fruta Feliz | Google | Outubro - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',366.74),
('MS',773,'MS 773',date '2025-11-07',date '2025-11-12','KSBIG','KSBIG | Fruta Feliz | Meta Ads | Outubro - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',1663.26),
('MS',774,'MS 774',date '2025-11-07',date '2025-11-12','MASCOR','Mascor | Turim + Teaser Maranello | Meta Ads | Outubro - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',1154.18),
('MS',777,'MS 777',date '2025-11-07',date '2025-11-12','MASCOR','Mascor Empreendimentos | Turim | Google | Outubro - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',1338.68),
('MS',780,'MS 780',date '2025-11-11',date '2025-11-12','Di Napoli','Residencial Di Napoli | O Campeão Voltou | Google | Outubro - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',936.11),
('PP',1775,'PP 1775',date '2025-09-10',date '2025-11-15','FineArt','FILME - CAMPANHA FRUTA FELIZ  - KSBIG - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',4233.33),
('MD',139,'MD 139',date '2025-09-09',date '2025-11-15','CGN','SF Empreendimentos | CGN | Outubro - Construtora SF - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',600.0),
('PP',1824,'PP 1824',date '2025-10-14',date '2025-11-20','Meinerz Esportes','CAMISETAS FRUTA FELIZ - KSBIG - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',111.9),
('MX',1525,'MX 1525',date '2025-10-21',date '2025-11-22','Outmar propagandas','Jardins Cemitério-Parque | Campanha Finados | Outmar | Bi 44 - Jardins Cemitério-Parque  - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Jardins Cemitério-Parque','One a One Comunicação e Estratégia',22.5),
('MX',1524,'MX 1524',date '2025-10-21',date '2025-11-22','Rede Outdoor','Jardins Cemitério-Parque | Campanha Finados | Rede Outdoor | Bi 44 - Jardins Cemitério-Parque  - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Jardins Cemitério-Parque','One a One Comunicação e Estratégia',186.0),
('MX',1523,'MX 1523',date '2025-10-21',date '2025-11-22','Vision Outdoor','Jardins Cemitério-Parque | Campanha Finados | Vision Outdoor | Bi 44 - Jardins Cemitério-Parque  - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Jardins Cemitério-Parque','One a One Comunicação e Estratégia',559.5),
('MX',1505,'MX 1505',date '2025-09-07',date '2025-11-22','Vision Outdoor','Mascor Empreendimentos | Turim | Vision Outdoor | BI 42 - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',186.5),
('ME',1560,'ME 1560',date '2025-10-21',date '2025-11-22','RICTV OESTE - TOLEDO','Residencial Dinapoli | Campanha O Campeão Voltou | RIC TV OESTE | Outubro - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',1014.34),
('ME',1561,'ME 1561',date '2025-10-27',date '2025-11-22','Di Napoli','Residencial Dinapoli | Campanha O Campeão Voltou | RPC | Outubro - RPC Cascavel - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',4364.63),
('MX',1509,'MX 1509',date '2025-10-21',date '2025-11-22','Outmar propagandas','Residencial Dinapoli | O Campeão Voltou | Outmar | Bi 42 - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',67.5),
('MX',1511,'MX 1511',date '2025-10-21',date '2025-11-22','Outmar propagandas','Residencial Dinapoli | O Campeão Voltou | Outmar | Bi 44 - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',67.5),
('MX',1512,'MX 1512',date '2025-10-21',date '2025-11-22','Vision Outdoor','Vision Outdoor | O Campeão Voltou | Di Napoli | BI 42 - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',559.5),
('MX',1513,'MX 1513',date '2025-10-21',date '2025-11-22','Vision Outdoor','Vision Outdoor | O Campeão Voltou | Di Napoli | BI 44 - Di Napoli - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',932.5),
('PP',1813,'PP 1813',date '2025-09-12',date '2025-11-24','Escala Indústria Gráfica','CATALOGO - Opera - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',1049.37),
('PP',1833,'PP 1833',date '2025-11-05',date '2025-11-24','FB BONÉS','VISEIRAS PERSONALIZADAS  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',123.53),
('PP',1802,'PP 1802',date '2025-08-21',date '2025-11-26','Di Napoli','CAMISETAS CAMPANHA - SEGUNDA PRODUÇÃO  - Meinerz Esportes - Honorários','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',150.0),
('PP',1831,'PP 1831',date '2025-11-05',date '2025-11-26','Top Terere Premium','COPOS PERSONALIZADOS  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',298.5),
('PP',1832,'PP 1832',date '2025-11-05',date '2025-11-26','D PROMOCIONAL BRINDES','SACOCHILA - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',111.22),
('PP',1828,'PP 1828',date '2025-10-21',date '2025-11-27','Adi Gráfica Rápida','BANNER ROLL UP JANTAR APRAS - KSBIG - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',56.02),
('PP',1673,'PP 1673',date '2025-12-04',date '2025-11-28','Web Thomaz','CRIAÇÃO DE WEBSITE - KSBIG - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',269.25),
('PP',1841,'PP 1841',date '2025-11-12',date '2025-11-28','FineArt','FILME E FOTO - CAMPANHA  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',1950.0),
('PP',1830,'PP 1830',date '2025-10-21',date '2025-12-05','Positiva','CALENDÁRIO 2026 - Jardins Cemitério-Parque  - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Jardins Cemitério-Parque','One a One Comunicação e Estratégia',1087.5),
('PP',1842,'PP 1842',date '2025-11-12',date '2025-12-05','Valdir Pqd','FILME E FOTO - CAMPANHA  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',1317.0),
('FEE',58,'FEE 58',date '2025-08-01',date '2025-12-08','Opera','Fee | Agenciamento publicitário -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',10000.0),
('PR',142,'PR 142',date '2025-08-28',date '2025-12-10','Di Napoli','Projeto lançamento Di Napoli -','1. Receitas Operacionais','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',13500.0),
('PP',1834,'PP 1834',date '2025-11-05',date '2025-12-11','Positiva','FLYERS EXPOVEL  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',287.55),
('PP',1835,'PP 1835',date '2025-11-12',date '2025-12-11','Mb Digital Comunicação Visual','PLOTAGEM STAND EXPOVEL  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',234.05),
('MS',791,'MS 791',date '2025-12-04',date '2025-12-12','COMIL SILOS','Comil Silos | Depois da colheita, é Comil | Google Ads | Novembro - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',116.23),
('MS',785,'MS 785',date '2025-12-04',date '2025-12-12','COMIL SILOS','Comil Silos | Institucional | Meta Ads | Novembro - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',1008.5),
('MS',783,'MS 783',date '2025-12-04',date '2025-12-12','Jardins Cemitério-Parque','Jardins Cemitério Parque | Institucional | Meta Ads | Novembro - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Jardins Cemitério-Parque','One a One Comunicação e Estratégia',365.32),
('MS',789,'MS 789',date '2025-12-04',date '2025-12-12','KSBIG','KSBIG | Faça uma fruta feliz | Google Ads | Novembro - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',464.94),
('MS',787,'MS 787',date '2025-12-04',date '2025-12-12','KSBIG','KSBIG | Faça uma fruta feliz | Meta Ads | Novembro - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',1408.72),
('MS',786,'MS 786',date '2025-12-04',date '2025-12-12','LM','Lojas LM | Institucional | Meta Ads | Novembro - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','LM','One a One Comunicação e Estratégia',1244.42),
('MS',792,'MS 792',date '2025-12-04',date '2025-12-12','LM','Lojas LM | Prazão + Black Friday | Google Ads | Novembro - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','LM','One a One Comunicação e Estratégia',634.8),
('MS',781,'MS 781',date '2025-12-04',date '2025-12-12','MASCOR','Mascor Empreendimentos | Turim CCO | Google | Novembro - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',1814.65),
('MS',782,'MS 782',date '2025-12-04',date '2025-12-12','MASCOR','Mascor Empreendimentos | Turim CCO | Meta Ads | Novembro - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',1114.21),
('MS',784,'MS 784',date '2025-12-04',date '2025-12-12','Di Napoli','Residencial Di Napoli | Institucional | Meta Ads | Novembro - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',1431.71),
('MS',790,'MS 790',date '2025-12-04',date '2025-12-12','Di Napoli','Residencial Di Napoli | O Campeão Voltou | Google Ads | Novembro - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',63.89),
('PP',1813,'PP 1813',date '2025-09-12',date '2025-12-13','Escala Indústria Gráfica','CATALOGO - Opera - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',1049.37),
('PP',1849,'PP 1849',date '2025-11-28',date '2025-12-15','JB CREATIVE','COBERTURA - JANTAR APRAS  - KSBIG - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',48.75),
('PP',1836,'PP 1836',date '2025-11-12',date '2025-12-15','DN Plus Filmes','FILME PRINCIPAL - CLIENTE LM TEM MAIS  - LM - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','LM','One a One Comunicação e Estratégia',450.0),
('PP',1837,'PP 1837',date '2025-11-12',date '2025-12-15','DN Plus Filmes','FILMES DEPRODUTO - CLIENTE LM TEM MAIS  - LM - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','LM','One a One Comunicação e Estratégia',450.0),
('MD',140,'MD 140',date '2025-09-09',date '2025-12-15','CGN','SF Empreendimentos | CGN | Novembro  - Construtora SF - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',600.0),
('PP',1844,'PP 1844',date '2025-11-12',date '2025-12-17','MORFEUS STUDIO','VIDEOS DE CONTEÚDO  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',390.0),
('PP',1843,'PP 1843',date '2025-11-12',date '2025-12-17','Valdir Pqd','VIDEOS DE CONTEUDO - QUELI  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',375.0),
('PP',1846,'PP 1846',date '2025-11-12',date '2025-12-18','Positiva','FLYER INSTITUCIONAL  - Jardins Cemitério-Parque  - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Jardins Cemitério-Parque','One a One Comunicação e Estratégia',77.03),
('MD',145,'MD 145',date '2025-12-11',date '2025-12-19','MASCOR','Mascor Empreendimentos | Inauguração Central de Vendas | Valore (Cadu Bedin)  - Valore Desenvolvimento Humano - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',318.0),
('PR',143,'PR 143',date '2025-12-04',date '2025-12-19','Kyoto (VIP)','Projeto lançamento - KYOTO  -','1. Receitas Operacionais','Amexcom','BTG Pactual','Kyoto (VIP)','One a One Comunicação e Estratégia',13750.0),
('PP',1845,'PP 1845',date '2025-11-12',date '2025-12-22','Adi Gráfica Rápida','CARTÃO BONUS CORRETOR - QUARTOTRIMESTRE  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',27.0),
('ME',1558,'ME 1558',date '2025-10-14',date '2025-12-22','RICTV OESTE - TOLEDO','KSBIG Hortifruti | Compre uma fruta feliz | TV RIC | Novembro - KSBIG - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',741.66),
('ME',1556,'ME 1556',date '2025-10-14',date '2025-12-22','TV Tarobá','KSBIG Hortifruti | Compre uma fruta feliz | TV Tarobá | Novembro - KSBIG - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',612.45),
('MX',1528,'MX 1528',date '2025-11-12',date '2025-12-22','Outmar propagandas','Lojas LM | Cliente LM tem mais | Outmar| Bi 46 Produção - LM - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','LM','One a One Comunicação e Estratégia',45.0),
('MX',1526,'MX 1526',date '2025-11-12',date '2025-12-22','Rede Outdoor','Lojas LM | Cliente LM tem mais | Rede Outdoor | Bi 46 Exibição - LM - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','LM','One a One Comunicação e Estratégia',372.0),
('ME',1566,'ME 1566',date '2025-11-12',date '2025-12-22','RICTV OESTE - TOLEDO','Lojas LM | Cliente LM tem mais | RIC TV | Novembro - LM - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','LM','One a One Comunicação e Estratégia',800.0),
('PP',1840,'PP 1840',date '2025-11-12',date '2025-12-22','Mb Digital Comunicação Visual','LONA - OUTDOOR NO LOTEAMENTO  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',293.51),
('MX',1527,'MX 1527',date '2025-11-05',date '2025-12-22','ALVARO BIZINELA PRODUÇÕES OUTDOOR','Mascor Empreendimentos | Maranello | Alvaro Bizinela Outdoor | BI 46 - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',187.5),
('MX',1520,'MX 1520',date '2025-11-05',date '2025-12-22','Outmar propagandas','Mascor Empreendimentos | Maranello | Outmar | BI 46 - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',45.0),
('MX',1521,'MX 1521',date '2025-11-12',date '2025-12-22','Outmar propagandas','Mascor Empreendimentos | Maranello | Outmar | BI 48 - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',112.5),
('MX',1517,'MX 1517',date '2025-11-12',date '2025-12-22','Fronteira Outdoor Cascavel (Rede Outdoor)','Mascor Empreendimentos | Maranello | Rede Outdoor | BI 46 - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',372.0),
('MX',1518,'MX 1518',date '2025-11-12',date '2025-12-22','Fronteira Outdoor Cascavel (Rede Outdoor)','Mascor Empreendimentos | Maranello | Rede Outdoor | BI 48 - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',930.0),
('MX',1514,'MX 1514',date '2025-11-05',date '2025-12-22','Vision Outdoor','Mascor Empreendimentos | Maranello | Vision Outdoor | BI 46 - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',932.5),
('MX',1514,'MX 1514',date '2025-11-18',date '2025-12-22','Vision Outdoor','Mascor Empreendimentos | Maranello | Vision Outdoor | BI 46 - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',1492.0),
('MX',1515,'MX 1515',date '2025-11-12',date '2025-12-22','Vision Outdoor','Mascor Empreendimentos | Maranello | Vision Outdoor | BI 48 - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',373.0),
('ME',1565,'ME 1565',date '2025-11-05',date '2025-12-22','RÁDIO CAPITAL FM.','Mascor Empreendimentos | Turim CCO + Maranello | Rádio Capital FM | Novembro - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',780.0),
('ME',1564,'ME 1564',date '2025-11-05',date '2025-12-22','MASCOR','Mascor Empreendimentos | Turim CCO + Maranello | Rádio Jovem Pan | Novembro - Rádio Jovem Pan - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',600.0),
('ME',1567,'ME 1567',date '2025-11-12',date '2025-12-22','Rádio Colméia','Mascor Empreendimentos | Turim CCO | Rádio Colmeia FM | Novembro - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',600.0),
('PP',1852,'PP 1852',date '2025-12-04',date '2025-12-23','Midia Fix','CARTAZ - INSCRIÇÃO  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',10.84),
('PP',1854,'PP 1854',date '2025-12-10',date '2025-12-23','MW Produções','SPOT - AÇÃO NOVO PLANTÃO  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',15.0),
('PP',1838,'PP 1838',date '2025-11-12',date '2025-12-24','ADI Soluções Gráficas','FLYER APRAS  - KSBIG - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',75.0),
('PP',1851,'PP 1851',date '2025-12-04',date '2025-12-25','Valdir Pqd','VÍDEOS DE CONTEÚDO - FORMATO JORNALISTICO  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',1035.0),
('PP',1857,'PP 1857',date '2025-12-10',date '2025-12-26','JB CREATIVE','COBERTURA - EVENTO NOVO PLANTÃO  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',39.0),
('PP',1856,'PP 1856',date '2025-12-10',date '2025-12-26','ADI Soluções Gráficas','FLYER - INALGURAÇÃO PLANTÃO  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',139.2),
('PP',1841,'PP 1841',date '2025-11-12',date '2025-12-28','FineArt','FILME E FOTO - CAMPANHA  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',1950.0),
('PP',1847,'PP 1847',date '2025-11-24',date '2025-12-29','IMPRESSÃO 3D FÁCIL','COFRINHO SILO - COMIL SILOS - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',810.0),
('PP',1853,'PP 1853',date '2025-12-10',date '2026-01-01','JB CREATIVE','COBERTURA - PREMIAÇÃO CORRETORES  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',52.5),
('PP',1861,'PP 1861',date '2026-01-07',date '2026-01-02','JB CREATIVE','FECHAMENTO DE ANO - COLABORADORES  - KSBIG - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',45.0),
('PP',1848,'PP 1848',date '2025-11-28',date '2026-01-02','Positiva','FOLDER MARANELLO  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',450.0),
('FEE',58,'FEE 58',date '2025-08-01',date '2026-01-08','Opera','Fee | Agenciamento publicitário -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',10000.0),
('PR',142,'PR 142',date '2025-08-28',date '2026-01-10','Di Napoli','Projeto lançamento Di Napoli -','1. Receitas Operacionais','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',13500.0),
('MS',804,'MS 804',date '2026-01-07',date '2026-01-12','COMIL SILOS','Comil Silos| Institucional | Google Ads | Dezembro - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',235.99),
('MS',799,'MS 799',date '2026-01-07',date '2026-01-12','Jardins Cemitério-Parque','Jardins Cemitério Parque | Institucional | Meta Ads | Dezembro - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Jardins Cemitério-Parque','One a One Comunicação e Estratégia',250.0),
('MS',802,'MS 802',date '2026-01-07',date '2026-01-12','KSBIG','KSBIG | Fim de ano | Google Ads | Dezembro - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',578.36),
('MS',801,'MS 801',date '2026-01-07',date '2026-01-12','KSBIG','KSBIG | Fim de ano | Meta Ads | Dezembro - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',1638.39),
('MS',803,'MS 803',date '2026-01-07',date '2026-01-12','KSBIG','KSBIG | Fim de ano | TikTok Ads | Dezembro - TikTok Ads - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',400.0),
('MS',800,'MS 800',date '2026-01-07',date '2026-01-12','LM','Lojas LM | Fim de ano | Meta Ads | Dezembro - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','LM','One a One Comunicação e Estratégia',2149.26),
('MS',798,'MS 798',date '2026-01-07',date '2026-01-12','MASCOR','Mascor Empreendimentos | Turim CCO + Institucional | Google Ads | Dezembro - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',5053.88),
('MS',797,'MS 797',date '2026-01-07',date '2026-01-12','MASCOR','Mascor Empreendimentos | Turim CCO + Institucional | Meta Ads | Dezembro - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',4816.7),
('MD',141,'MD 141',date '2025-09-09',date '2026-01-15','CGN','SF Empreendimentos | CGN | Dezembro  - Construtora SF - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Construtora SF','One a One Comunicação e Estratégia',600.0),
('PP',1855,'PP 1855',date '2025-12-10',date '2026-01-19','Magu Filmes','FILME - NATAL  - LM - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','LM','One a One Comunicação e Estratégia',315.0),
('PR',143,'PR 143',date '2025-12-04',date '2026-01-19','Kyoto (VIP)','Projeto lançamento - KYOTO  -','1. Receitas Operacionais','Amexcom','BTG Pactual','Kyoto (VIP)','One a One Comunicação e Estratégia',13750.0),
('PP',1859,'PP 1859',date '2025-12-15',date '2026-01-19','MW Produções','SPOT - AÇÃO NOVO PLANTÃO + VAGAS MASCARELLO  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',30.0),
('MS',796,'MS 796',date '2026-01-07',date '2026-01-20','Rádio Massa Cascavel','Mascor Empreendimentos | Maranello | Rádio Massa | Dezembro - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',250.0),
('MX',1542,'MX 1542',date '2025-12-04',date '2026-01-22','Outmar propagandas','KSBIG | Faça uma fruta Feliz | Outmar Propagandas (Produção Rede Outdoor) TopSight | Dezembro - KSBIG - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',105.0),
('MX',1541,'MX 1541',date '2025-12-04',date '2026-01-22','Vision Outdoor','KSBIG | Faça uma fruta feliz | Vision Outdoor - TopSight | Dezembro | Produção - KSBIG - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',195.0),
('MX',1491,'MX 1491',date '2025-12-11',date '2026-01-22','Fronteira Outdoor Cascavel (Rede Outdoor)','KSBIG | Natal Feliz | Fronteira (Rede Outdoor) | BI 52 Exibição - KSBIG - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',558.0),
('MX',1545,'MX 1545',date '2025-12-10',date '2026-01-22','Outmar propagandas','KSBIG | Natal Feliz | Outmar |  BI 52 Produção - KSBIG - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',67.5),
('MX',1475,'MX 1475',date '2025-12-11',date '2026-01-22','Vision Outdoor','KSBIG | Natal Feliz | Vision Outdoor | BI 52  - KSBIG - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',746.0),
('ME',1559,'ME 1559',date '2025-10-14',date '2026-01-22','RICTV OESTE - TOLEDO','KSBIG Hortifruti | Compre uma fruta feliz | TV RIC | Dezembro - KSBIG - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',719.76),
('ME',1557,'ME 1557',date '2025-10-14',date '2026-01-22','TV Tarobá','KSBIG Hortifruti | Compre uma fruta feliz | TV Tarobá | Dezembro - KSBIG - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',588.1),
('MX',1540,'MX 1540',date '2025-12-04',date '2026-01-22','Fronteira Outdoor Cascavel (Rede Outdoor)','Lojas LM | Cliente LM tem mais | Fronteira Outdoor (Rede Outdoor) | Bi 52 Exibição - LM - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','LM','One a One Comunicação e Estratégia',372.0),
('MX',1539,'MX 1539',date '2025-12-04',date '2026-01-22','Outmar propagandas','Lojas LM | Cliente LM tem mais | Outmar| Bi 52 Produção - LM - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','LM','One a One Comunicação e Estratégia',45.0),
('MX',1538,'MX 1538',date '2025-12-10',date '2026-01-22','Placa Mídia','Lojas LM | Natal LM | Placa Mídia | Bi 50 Mupi - LM - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','LM','One a One Comunicação e Estratégia',147.0),
('MX',1537,'MX 1537',date '2025-12-10',date '2026-01-22','Placa Mídia','Lojas LM | Natal LM | Placa Mídia | Bi 52 Outdoor - LM - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','LM','One a One Comunicação e Estratégia',295.0),
('ME',1571,'ME 1571',date '2025-12-10',date '2026-01-22','RICTV OESTE - TOLEDO','Lojas LM | Natal LM | RIC TV | Dezembro - LM - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','LM','One a One Comunicação e Estratégia',130.0),
('ME',1573,'ME 1573',date '2026-01-07',date '2026-01-22','Tarobá FM','Mascor Empreendimentos | Institucional | Rádio Tarobá FM | Dezembro - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',597.8),
('MS',795,'MS 795',date '2025-12-16',date '2026-01-22','Certapublicidade','Mascor Empreendimentos | Maranello | Carro de som Certapublicidade | Dezembro - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',225.0),
('MX',1536,'MX 1536',date '2025-12-04',date '2026-01-22','Outmar propagandas','Mascor Empreendimentos | Maranello | Otumar | BI 50 Produção - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',90.0),
('MX',1519,'MX 1519',date '2025-12-04',date '2026-01-22','Fronteira Outdoor Cascavel (Rede Outdoor)','Mascor Empreendimentos | Maranello | Rede Outdoor | BI 50 - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',744.0),
('MX',1546,'MX 1546',date '2025-12-11',date '2026-01-22','Vision Outdoor','Mascor Empreendimentos | Maranello | Vision Outdoor - Produção  - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',22.5),
('MX',1516,'MX 1516',date '2025-12-04',date '2026-01-22','Vision Outdoor','Mascor Empreendimentos | Maranello | Vision Outdoor | BI 50 - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',746.0),
('ME',1569,'ME 1569',date '2025-12-04',date '2026-01-22','RÁDIO CAPITAL FM.','Mascor Empreendimentos | Turim CCO + Maranello | Rádio Capital FM | Dezembro - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',780.0),
('ME',1570,'ME 1570',date '2025-12-04',date '2026-01-22','MASCOR','Mascor Empreendimentos | Turim CCO + Maranello | Rádio Jovem Pan | Dezembro - Rádio Jovem Pan - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',600.0),
('ME',1568,'ME 1568',date '2025-12-04',date '2026-01-22','Rádio Colméia','Mascor Empreendimentos | Turim CCO | Rádio Colmeia FM | Dezembro - MASCOR - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',600.0),
('PP',1860,'PP 1860',date '2025-12-16',date '2026-01-23','Go Print Comunicação Visual','BACKDROP - ENCERRAMENTO VALE A PENA VENDER DE NOVO  - MASCOR - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','MASCOR','One a One Comunicação e Estratégia',157.5),
('PP',1870,'PP 1870',date '2026-01-23',date '2026-02-06','Eventos Aqui','PULCEIRAS DE IDENTIFICAÇÃO  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',13.8),
('FEE',58,'FEE 58',date '2025-08-01',date '2026-02-08','Opera','Fee | Agenciamento publicitário -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',10000.0),
('PP',1871,'PP 1871',date '2026-01-28',date '2026-02-09','JB CREATIVE','COBERTURA - COPA DI NAPOLI - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',52.5),
('PP',1872,'PP 1872',date '2026-01-23',date '2026-02-09','Pedro Krasniak','FOTOS - COPA DI NAPOLI  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',123.75),
('FEE',60,'FEE 60',date '2026-01-23',date '2026-02-10','Café Jesuítas','Fee -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Café Jesuítas','One a One Comunicação e Estratégia',8500.0),
('FEE',59,'FEE 59',date '2025-12-16',date '2026-02-10','COMIL SILOS','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',12500.0),
('MS',805,'MS 805',date '2026-02-11',date '2026-02-12','COMIL SILOS','Comil Silos | Institucional | Google Ads | Janeiro - Google - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',246.37),
('PP',1864,'PP 1864',date '2026-01-28',date '2026-02-13','Mérito Gráfica','BACKDROP - COPA DI NAPOLI  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',82.5),
('PP',1866,'PP 1866',date '2026-01-21',date '2026-02-13','Meinerz do brasil','CAMISETAS - COPA DI NAPOLI  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',630.75),
('PP',1867,'PP 1867',date '2026-01-28',date '2026-02-13','Mérito Gráfica','LONAS DE COMUNICAÇÃO  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',90.0),
('PP',1869,'PP 1869',date '2026-01-28',date '2026-02-13','Mb Digital Comunicação Visual','TROFÉUS - COPA DI NAPOLI  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',146.81),
('PP',1862,'PP 1862',date '2026-01-13',date '2026-02-16','Positiva','Folder A3 Dinapoli - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',454.5),
('PP',1865,'PP 1865',date '2026-01-21',date '2026-02-17','Midia Fix','ADESIVOS - STAND CATUAÍ  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',89.59),
('PR',143,'PR 143',date '2025-12-04',date '2026-02-19','Kyoto (VIP)','Projeto lançamento - KYOTO  -','1. Receitas Operacionais','Amexcom','BTG Pactual','Kyoto (VIP)','One a One Comunicação e Estratégia',13750.0),
('PP',1863,'PP 1863',date '2026-01-28',date '2026-02-20','Mb Digital Comunicação Visual','PLACAS DE ACRILICO - MISSÃO, VISÃO E VALORES  - KSBIG - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',81.14),
('PP',1858,'PP 1858',date '2025-12-16',date '2026-02-27','Gráfica Alpha','CADERNETA 2026 - COMIL SILOS - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',4965.0),
('FEE',58,'FEE 58',date '2025-08-01',date '2026-03-08','Opera','Fee | Agenciamento publicitário -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',10000.0),
('FEE',60,'FEE 60',date '2026-01-23',date '2026-03-10','Café Jesuítas','Fee -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Café Jesuítas','One a One Comunicação e Estratégia',8500.0),
('FEE',59,'FEE 59',date '2025-12-16',date '2026-03-10','COMIL SILOS','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',12500.0),
('PR',143,'PR 143',date '2025-12-04',date '2026-03-19','Kyoto (VIP)','Projeto lançamento - KYOTO  -','1. Receitas Operacionais','Amexcom','BTG Pactual','Kyoto (VIP)','One a One Comunicação e Estratégia',13750.0),
('MS',810,'MS 810',date '2026-03-19',date '2026-03-23','Facebook','GO ON TESTE 06 MO - GO ON - Desconto Padrão Agência','1. Receitas Operacionais','Amexcom','BTG Pactual','GO ON','One a One Comunicação e Estratégia',569.52),
('PP',1877,'PP 1877',date '2026-03-19',date '2026-03-23','Gráfica Alpha','TESTE - GO ON - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','GO ON','One a One Comunicação e Estratégia',0.15),
('PP',1875,'PP 1875',date '2026-03-11',date '2026-03-26','Mb Digital Comunicação Visual','PLAQUINHA DE ACRILICO - SETOR ADMINISTRATIVO  - KSBIG - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',10.56),
('FEE',62,'FEE 62',date '2026-03-19',date '2026-03-30','GO ON','Fee - Go on -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','GO ON','One a One Comunicação e Estratégia',20000.0),
('FEE',61,'FEE 61',date '2026-02-10',date '2026-03-30','É o Amor','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',15000.0),
('MX',1566,'MX 1566',date '2026-03-19',date '2026-03-30','Fronteira Outdoor Cascavel (Rede Outdoor)','Go On - Teste - GO ON - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','GO ON','One a One Comunicação e Estratégia',3.0),
('PP',1876,'PP 1876',date '2026-03-23',date '2026-04-07','Adi Gráfica Rápida','BLOCOS DE ANOTAÇÃO  - Opera - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',56.0),
('FEE',58,'FEE 58',date '2025-08-01',date '2026-04-08','Opera','Fee | Agenciamento publicitário -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',10000.0),
('FEE',60,'FEE 60',date '2026-01-23',date '2026-04-10','Café Jesuítas','Fee -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Café Jesuítas','One a One Comunicação e Estratégia',8500.0),
('FEE',59,'FEE 59',date '2025-12-16',date '2026-04-10','COMIL SILOS','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',12500.0),
('MD',146,'MD 146',date '2026-03-19',date '2026-04-15','CGN','GO ON | TESTE 03 MD - GO ON - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','GO ON','One a One Comunicação e Estratégia',600.0),
('MI',402,'MI 402',date '2026-03-19',date '2026-04-15','Revista Friends Night and Day','GO ON | TESTE 04 MI-R - GO ON - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','GO ON','One a One Comunicação e Estratégia',262.5),
('PP',1882,'PP 1882',date '2026-05-12',date '2026-04-17','Phoenix','CANETAS PERSONALIZADAS  - KSBIG - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',35.25),
('PR',143,'PR 143',date '2025-12-04',date '2026-04-19','Kyoto (VIP)','Projeto lançamento - KYOTO  -','1. Receitas Operacionais','Amexcom','BTG Pactual','Kyoto (VIP)','One a One Comunicação e Estratégia',13750.0),
('FEE',62,'FEE 62',date '2026-03-19',date '2026-04-30','GO ON','Fee - Go on -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','GO ON','One a One Comunicação e Estratégia',20000.0),
('FEE',61,'FEE 61',date '2026-02-10',date '2026-04-30','É o Amor','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',15000.0),
('FEE',58,'FEE 58',date '2025-08-01',date '2026-05-08','Opera','Fee | Agenciamento publicitário -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',10000.0),
('FEE',60,'FEE 60',date '2026-01-23',date '2026-05-10','Café Jesuítas','Fee -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Café Jesuítas','One a One Comunicação e Estratégia',8500.0),
('FEE',59,'FEE 59',date '2025-12-16',date '2026-05-10','COMIL SILOS','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',12500.0),
('MS',814,'MS 814',date '2026-05-05',date '2026-05-12','Facebook','É o Amor Condomínio Fazenda | Bons Tempos | Meta Ads | Abril - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',364.75),
('PP',1886,'PP 1886',date '2026-05-05',date '2026-05-14','Valdir Pqd','360 ALTURA DO PRÉDIO - MAPS  - Opera - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',75.0),
('PP',1885,'PP 1885',date '2026-06-08',date '2026-05-15','TUICIAL','SELO - TERRENO VENDIDO  - É o Amor - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',119.72),
('PR',143,'PR 143',date '2025-12-04',date '2026-05-19','Kyoto (VIP)','Projeto lançamento - KYOTO  -','1. Receitas Operacionais','Amexcom','BTG Pactual','Kyoto (VIP)','One a One Comunicação e Estratégia',13750.0),
('PP',1882,'PP 1882',date '2026-05-12',date '2026-05-22','Phoenix','CANETAS PERSONALIZADAS  - KSBIG - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',35.25),
('MX',1574,'MX 1574',date '2026-04-30',date '2026-05-22','MSG','É o Amor Condomínio Fazenda | Lançamento | MSG | Abril - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',787.0),
('MX',1567,'MX 1567',date '2026-04-18',date '2026-05-22','Outmar propagandas','É o Amor Condomínio Fazenda | Lançamento | Outmar| Bi-semana 18 Produção - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',1134.0),
('MX',1568,'MX 1568',date '2026-04-18',date '2026-05-22','Rede Outdoor','É o Amor Condomínio Fazenda | Lançamento | Rede Outdoor | Bi-semana 18 Exibição - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',1302.0),
('MX',1569,'MX 1569',date '2026-04-18',date '2026-05-22','Vision Outdoor','É o Amor Condomínio Fazenda | Lançamento | Vision Outdoor | Bi-semana 18 Exibição - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',656.0),
('MX',1570,'MX 1570',date '2026-04-18',date '2026-05-22','Vision Outdoor','É o Amor Condomínio Fazenda | Lançamento | Vision Outdoor | Bi-semana 18 Produção - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',588.0),
('ME',1577,'ME 1577',date '2026-03-19',date '2026-05-22','RPC Cascavel','Go on | Teste 02 - GO ON - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','GO ON','One a One Comunicação e Estratégia',0.8),
('FEE',62,'FEE 62',date '2026-03-19',date '2026-05-30','GO ON','Fee - Go on -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','GO ON','One a One Comunicação e Estratégia',20000.0),
('FEE',61,'FEE 61',date '2026-02-10',date '2026-05-30','É o Amor','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',15000.0),
('PR',144,'PR 144',date '2026-06-01',date '2026-06-05','FEAPR','Criação selo 80 anos','1. Receitas Operacionais','Amexcom','BTG Pactual','FEAPR','One a One Comunicação e Estratégia',3000.0),
('FEE',58,'FEE 58',date '2025-08-01',date '2026-06-08','Opera','Fee | Agenciamento publicitário -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',10000.0),
('FEE',60,'FEE 60',date '2026-01-23',date '2026-06-10','Café Jesuítas','Fee -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Café Jesuítas','One a One Comunicação e Estratégia',8500.0),
('FEE',59,'FEE 59',date '2025-12-16',date '2026-06-10','COMIL SILOS','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',12500.0),
('MS',823,'MS 823',date '2026-06-08',date '2026-06-15','Google','É o Amor Condomínio Fazenda | Bons Tempos | Google Ads | Maio - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',700.0),
('MS',819,'MS 819',date '2026-06-08',date '2026-06-15','É o Amor','É o Amor Condomínio Fazenda | Bons Tempos | Meta Ads | Maio - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',1510.26),
('MS',820,'MS 820',date '2026-06-08',date '2026-06-15','Facebook','Go On | Campanha | Meta Ads | Maio - GO ON - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','GO ON','One a One Comunicação e Estratégia',0.0),
('MS',818,'MS 818',date '2026-06-08',date '2026-06-15','Di Napoli','Residencial Di Napoli | O Campeão Voltou | Meta Ads | Maio - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',375.56),
('PP',1885,'PP 1885',date '2026-06-08',date '2026-06-15','TUICIAL','SELO - TERRENO VENDIDO  - É o Amor - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',119.72),
('PP',1887,'PP 1887',date '2026-06-01',date '2026-06-18','Mérito Gráfica','LONA DECORADO  - Opera - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',967.5),
('PR',143,'PR 143',date '2025-12-04',date '2026-06-19','Kyoto (VIP)','Projeto lançamento - KYOTO  -','1. Receitas Operacionais','Amexcom','BTG Pactual','Kyoto (VIP)','One a One Comunicação e Estratégia',13750.0),
('PP',1889,'PP 1889',date '2026-06-08',date '2026-06-22','Phoenix','BONÉS - TROCA DE FIGURINHAS  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',412.5),
('PP',1890,'PP 1890',date '2026-06-08',date '2026-06-22','IMPERIUM','COPO PERSONALIZADO  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',118.5),
('MX',1581,'MX 1581',date '2026-05-18',date '2026-06-22','MSG','É o Amor Condomínio Fazenda | Lançamento | MSG | Maio - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',640.0),
('MX',1576,'MX 1576',date '2026-04-30',date '2026-06-22','Rede Outdoor','É o Amor Condomínio Fazenda | Lançamento | Rede Outdoor | Bi-semana 20 Exibição - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',1302.0),
('MX',1577,'MX 1577',date '2026-04-30',date '2026-06-22','Rede Outdoor','É o Amor Condomínio Fazenda | Lançamento | Rede Outdoor | Bi-semana 22 Exibição - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',1302.0),
('MX',1582,'MX 1582',date '2026-04-30',date '2026-06-22','Vision Outdoor','É o Amor Condomínio Fazenda | Lançamento | Vision Outdoor | Bi-semana 20 Exibição - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',656.0),
('MX',1583,'MX 1583',date '2026-04-30',date '2026-06-22','Vision Outdoor','É o Amor Condomínio Fazenda | Lançamento | Vision Outdoor | Bi-semana 22 Exibição - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',656.0),
('FEE',62,'FEE 62',date '2026-03-19',date '2026-06-30','GO ON','Fee - Go on -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','GO ON','One a One Comunicação e Estratégia',20000.0),
('FEE',61,'FEE 61',date '2026-02-10',date '2026-06-30','É o Amor','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',15000.0),
('FEE',58,'FEE 58',date '2025-08-01',date '2026-07-08','Opera','Fee | Agenciamento publicitário -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Opera','One a One Comunicação e Estratégia',10000.0),
('FEE',60,'FEE 60',date '2026-01-23',date '2026-07-10','Café Jesuítas','Fee -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Café Jesuítas','One a One Comunicação e Estratégia',8500.0),
('FEE',59,'FEE 59',date '2025-12-16',date '2026-07-10','COMIL SILOS','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',12500.0),
('FEE',63,'FEE 63',date '2026-06-30',date '2026-07-10','Industria Mel Do Malte (IMDM)','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Industria Mel Do Malte (IMDM)','One a One Comunicação e Estratégia',8500.0),
('MS',830,'MS 830',date '2026-07-06',date '2026-07-13','Facebook','É o Amor Condomínio Fazenda | Bons Tempos | Meta Ads | Junho - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',1347.33),
('MS',827,'MS 827',date '2026-07-06',date '2026-07-13','Di Napoli','Residencial Di Napoli | O Campeão Voltou | Meta Ads | Junho - Facebook - Comissão','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',374.45),
('PP',1889,'PP 1889',date '2026-06-08',date '2026-07-15','Phoenix','BONÉS - TROCA DE FIGURINHAS  - Di Napoli - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','Di Napoli','One a One Comunicação e Estratégia',412.5),
('PR',143,'PR 143',date '2025-12-04',date '2026-07-19','Kyoto (VIP)','Projeto lançamento - KYOTO  -','1. Receitas Operacionais','Amexcom','BTG Pactual','Kyoto (VIP)','One a One Comunicação e Estratégia',13750.0),
('MX',1587,'MX 1587',date '2026-05-20',date '2026-07-22','MSG','É o Amor Condomínio Fazenda | Lançamento | MSG | Junho - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',640.0),
('MX',1578,'MX 1578',date '2026-04-30',date '2026-07-22','Rede Outdoor','É o Amor Condomínio Fazenda | Lançamento | Rede Outdoor | Bi-semana 24 Exibição - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',1302.0),
('MX',1579,'MX 1579',date '2026-04-30',date '2026-07-22','Rede Outdoor','É o Amor Condomínio Fazenda | Lançamento | Rede Outdoor | Bi-semana 26 Exibição - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',1302.0),
('MX',1580,'MX 1580',date '2026-04-30',date '2026-07-22','Rede Outdoor','É o Amor Condomínio Fazenda | Lançamento | Rede Outdoor | Bi-semana 28 Exibição - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',1302.0),
('MX',1584,'MX 1584',date '2026-04-30',date '2026-07-22','Vision Outdoor','É o Amor Condomínio Fazenda | Lançamento | Vision Outdoor | Bi-semana 24 Exibição - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',656.0),
('MX',1585,'MX 1585',date '2026-04-30',date '2026-07-22','Vision Outdoor','É o Amor Condomínio Fazenda | Lançamento | Vision Outdoor | Bi-semana 26 Exibição - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',656.0),
('MX',1586,'MX 1586',date '2026-04-30',date '2026-07-22','Vision Outdoor','É o Amor Condomínio Fazenda | Lançamento | Vision Outdoor | Bi-semana 28 Exibição - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',656.0),
('FEE',62,'FEE 62',date '2026-03-19',date '2026-07-30','GO ON','Fee - Go on -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','GO ON','One a One Comunicação e Estratégia',20000.0),
('FEE',61,'FEE 61',date '2026-02-10',date '2026-07-30','É o Amor','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',15000.0),
('PP',1893,'PP 1893',date '2026-07-02',date '2026-08-04','Adi Gráfica Rápida','CARTÃO AGRADECIMENTO  - É o Amor - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',73.5),
('FEE',60,'FEE 60',date '2026-01-23',date '2026-08-10','Café Jesuítas','Fee -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Café Jesuítas','One a One Comunicação e Estratégia',8500.0),
('FEE',59,'FEE 59',date '2025-12-16',date '2026-08-10','COMIL SILOS','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',12500.0),
('FEE',63,'FEE 63',date '2026-06-30',date '2026-08-10','Industria Mel Do Malte (IMDM)','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Industria Mel Do Malte (IMDM)','One a One Comunicação e Estratégia',8500.0),
('MX',1618,'MX 1618',date '2026-07-09',date '2026-08-22','MSG','É o Amor Condomínio Fazenda | Lançamento | MSG | Julho - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',640.0),
('MX',1619,'MX 1619',date '2026-07-09',date '2026-08-22','Rede Outdoor','É o Amor Condomínio Fazenda | Lançamento | Rede Outdoor | Bi-semana 30 Exibição - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',558.0),
('MX',1620,'MX 1620',date '2026-07-09',date '2026-08-22','Rede Outdoor','É o Amor Condomínio Fazenda | Lançamento | Rede Outdoor | Bi-semana 32 Exibição - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',1302.0),
('MX',1623,'MX 1623',date '2026-07-09',date '2026-08-22','Vision Outdoor','É o Amor Condomínio Fazenda | Lançamento | Vision Outdoor | Bi-semana 30 Exibição - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',656.0),
('MX',1624,'MX 1624',date '2026-07-09',date '2026-08-22','Vision Outdoor','É o Amor Condomínio Fazenda | Lançamento | Vision Outdoor | Bi-semana 32 Exibição - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',656.0),
('PP',1896,'PP 1896',date '2026-07-16',date '2026-08-24','IMPRESSÃO 3D FÁCIL','COFRINHO SILO - COMIL SILOS - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',183.0),
('FEE',62,'FEE 62',date '2026-03-19',date '2026-08-30','GO ON','Fee - Go on -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','GO ON','One a One Comunicação e Estratégia',20000.0),
('FEE',61,'FEE 61',date '2026-02-10',date '2026-08-30','É o Amor','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',15000.0),
('FEE',60,'FEE 60',date '2026-01-23',date '2026-09-10','Café Jesuítas','Fee -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Café Jesuítas','One a One Comunicação e Estratégia',8500.0),
('FEE',59,'FEE 59',date '2025-12-16',date '2026-09-10','COMIL SILOS','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',12500.0),
('FEE',63,'FEE 63',date '2026-06-30',date '2026-09-10','Industria Mel Do Malte (IMDM)','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Industria Mel Do Malte (IMDM)','One a One Comunicação e Estratégia',8500.0),
('MX',1621,'MX 1621',date '2026-07-09',date '2026-09-22','Rede Outdoor','É o Amor Condomínio Fazenda | Lançamento | Rede Outdoor | Bi-semana 34 Exibição - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',1302.0),
('MX',1622,'MX 1622',date '2026-07-09',date '2026-09-22','Rede Outdoor','É o Amor Condomínio Fazenda | Lançamento | Rede Outdoor | Bi-semana 36 Exibição - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',1302.0),
('MX',1625,'MX 1625',date '2026-07-09',date '2026-09-22','Vision Outdoor','É o Amor Condomínio Fazenda | Lançamento | Vision Outdoor | Bi-semana 34 Exibição - É o Amor - Desconto Padrão Agência','1. Receitas Operacionais > Comissão','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',656.0),
('FEE',62,'FEE 62',date '2026-03-19',date '2026-09-30','GO ON','Fee - Go on -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','GO ON','One a One Comunicação e Estratégia',20000.0),
('FEE',61,'FEE 61',date '2026-02-10',date '2026-09-30','É o Amor','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',15000.0),
('FEE',60,'FEE 60',date '2026-01-23',date '2026-10-10','Café Jesuítas','Fee -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Café Jesuítas','One a One Comunicação e Estratégia',8500.0),
('FEE',59,'FEE 59',date '2025-12-16',date '2026-10-10','COMIL SILOS','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',12500.0),
('FEE',63,'FEE 63',date '2026-06-30',date '2026-10-10','Industria Mel Do Malte (IMDM)','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Industria Mel Do Malte (IMDM)','One a One Comunicação e Estratégia',8500.0),
('FEE',62,'FEE 62',date '2026-03-19',date '2026-10-30','GO ON','Fee - Go on -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','GO ON','One a One Comunicação e Estratégia',20000.0),
('FEE',61,'FEE 61',date '2026-02-10',date '2026-10-30','É o Amor','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',15000.0),
('FEE',60,'FEE 60',date '2026-01-23',date '2026-11-10','Café Jesuítas','Fee -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Café Jesuítas','One a One Comunicação e Estratégia',8500.0),
('FEE',59,'FEE 59',date '2025-12-16',date '2026-11-10','COMIL SILOS','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',12500.0),
('FEE',63,'FEE 63',date '2026-06-30',date '2026-11-10','Industria Mel Do Malte (IMDM)','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Industria Mel Do Malte (IMDM)','One a One Comunicação e Estratégia',8500.0),
('FEE',62,'FEE 62',date '2026-03-19',date '2026-11-30','GO ON','Fee - Go on -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','GO ON','One a One Comunicação e Estratégia',20000.0),
('FEE',61,'FEE 61',date '2026-02-10',date '2026-11-30','É o Amor','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',15000.0),
('FEE',60,'FEE 60',date '2026-01-23',date '2026-12-10','Café Jesuítas','Fee -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Café Jesuítas','One a One Comunicação e Estratégia',8500.0),
('FEE',59,'FEE 59',date '2025-12-16',date '2026-12-10','COMIL SILOS','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','COMIL SILOS','One a One Comunicação e Estratégia',12500.0),
('FEE',63,'FEE 63',date '2026-06-30',date '2026-12-10','Industria Mel Do Malte (IMDM)','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Industria Mel Do Malte (IMDM)','One a One Comunicação e Estratégia',8500.0),
('PP',1673,'PP 1673',date '2025-12-04',date '2026-12-22','Web Thomaz','CRIAÇÃO DE WEBSITE - KSBIG - Comissão (BV)','1. Receitas Operacionais > Produção','Amexcom','BTG Pactual','KSBIG','One a One Comunicação e Estratégia',269.25),
('FEE',62,'FEE 62',date '2026-03-19',date '2026-12-30','GO ON','Fee - Go on -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','GO ON','One a One Comunicação e Estratégia',20000.0),
('FEE',61,'FEE 61',date '2026-02-10',date '2026-12-30','É o Amor','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','É o Amor','One a One Comunicação e Estratégia',15000.0),
('FEE',60,'FEE 60',date '2026-01-23',date '2027-01-10','Café Jesuítas','Fee -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Café Jesuítas','One a One Comunicação e Estratégia',8500.0),
('FEE',63,'FEE 63',date '2026-06-30',date '2027-01-10','Industria Mel Do Malte (IMDM)','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Industria Mel Do Malte (IMDM)','One a One Comunicação e Estratégia',8500.0),
('FEE',62,'FEE 62',date '2026-03-19',date '2027-01-30','GO ON','Fee - Go on -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','GO ON','One a One Comunicação e Estratégia',20000.0),
('FEE',63,'FEE 63',date '2026-06-30',date '2027-02-10','Industria Mel Do Malte (IMDM)','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Industria Mel Do Malte (IMDM)','One a One Comunicação e Estratégia',8500.0),
('FEE',62,'FEE 62',date '2026-03-19',date '2027-03-02','GO ON','Fee - Go on -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','GO ON','One a One Comunicação e Estratégia',20000.0),
('FEE',63,'FEE 63',date '2026-06-30',date '2027-03-10','Industria Mel Do Malte (IMDM)','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Industria Mel Do Malte (IMDM)','One a One Comunicação e Estratégia',8500.0),
('FEE',63,'FEE 63',date '2026-06-30',date '2027-04-10','Industria Mel Do Malte (IMDM)','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Industria Mel Do Malte (IMDM)','One a One Comunicação e Estratégia',8500.0),
('FEE',63,'FEE 63',date '2026-06-30',date '2027-05-10','Industria Mel Do Malte (IMDM)','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Industria Mel Do Malte (IMDM)','One a One Comunicação e Estratégia',8500.0),
('FEE',63,'FEE 63',date '2026-06-30',date '2027-06-10','Industria Mel Do Malte (IMDM)','Fee 2026 -','1. Receitas Operacionais > Fee','Amexcom','BTG Pactual','Industria Mel Do Malte (IMDM)','One a One Comunicação e Estratégia',8500.0)
) as v(serie, numero, documento, emissao, vencimento, contato, descricao, categoria, centro_custos, conta_corrente, cliente, empresa, valor)
where not exists (
  select 1 from doc_historico dh
  where dh.org_id = org.id and dh.documento = v.documento
    and dh.descricao is not distinct from v.descricao
    and dh.vencimento is not distinct from v.vencimento
    and dh.valor is not distinct from v.valor
);

notify pgrst, 'reload schema';
