-- ── NFS-e: parâmetros fiscais da org + a nota emitida ───────────────────────
--
-- 30/09/2026. A primeira NFS-e saiu do Flow em produção restrita (chave
-- 41048082217531601000123000000000000126090884913152); a receita está na memória
-- do projeto. Agora o caminho vira produto: botão na linha do lançamento, bloco
-- no lançamento aberto e filtro "sem nota" na barra.
--
-- Duas tabelas e um motivo para cada:
--
-- `org_nfse_config` — os números fiscais que a Receita exige e que NINGUÉM deve
-- chutar no código: código do serviço, percentual do Simples, ISSQN. No teste eu
-- usei 170101 e 6,00 só para o validador passar. Nota oficial com tributação
-- errada só se conserta cancelando, então isso é CADASTRO, com a contabilidade
-- respondendo — nunca constante em arquivo.
--
-- `nota_fiscal` — a nota emitida, com a chave, o número e o XML autorizado. O
-- lançamento não muda: ele continua sendo o dinheiro, e a nota pendura nele.

create table if not exists org_nfse_config (
  org_id           uuid primary key references organizations(id) on delete cascade,
  -- Série e numeração são do EMITENTE: a Receita não numera por nós.
  serie            text   not null default '00001',
  proximo_numero   bigint not null default 1,
  -- Município de emissão (IBGE). Cascavel-PR = 4104808.
  cod_municipio    text,
  -- cTribNac: código do serviço na lista nacional. Publicidade é da família 17.
  codigo_servico   text,
  -- pTotTribSN: percentual total de tributos do Simples. ME/EPP usa este campo;
  -- indTotTrib é PROIBIDO para ME/EPP (erro E0712 da Receita).
  perc_simples     numeric(5,2),
  -- tribISSQN (1 = operação tributável) e tpRetISSQN (1 = não retido).
  trib_issqn       smallint not null default 1,
  tp_ret_issqn     smallint not null default 1,
  descricao_padrao text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references profiles(id) on delete set null
);

create table if not exists nota_fiscal (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  -- A nota nasce de um lançamento a receber; o lançamento segue intocado.
  lancamento_id uuid references lancamentos(id) on delete set null,
  ambiente      text not null check (ambiente in ('restrita', 'producao')),
  status        text not null default 'autorizada' check (status in ('autorizada', 'cancelada')),
  chave         text not null,
  numero        text,
  serie         text,
  n_dps         bigint,
  valor         numeric(14,2),
  competencia   date,
  tomador_nome  text,
  tomador_cnpj  text,
  -- XML autorizado devolvido pela Receita (gzip + base64, como ela entrega).
  xml_gz_b64    text,
  emitido_em    timestamptz not null default now(),
  emitido_por   uuid references profiles(id) on delete set null,
  cancelado_em  timestamptz
);
-- Chave é única POR AMBIENTE: a mesma numeração existe dos dois lados, e nota de
-- teste não pode colidir com nota real.
create unique index if not exists idx_nota_fiscal_chave on nota_fiscal (ambiente, chave);
create index if not exists idx_nota_fiscal_lanc on nota_fiscal (lancamento_id);
create index if not exists idx_nota_fiscal_org on nota_fiscal (org_id, emitido_em desc);

alter table org_nfse_config enable row level security;
alter table nota_fiscal     enable row level security;

drop policy if exists "Finance read nfse config" on org_nfse_config;
create policy "Finance read nfse config" on org_nfse_config for select using (fin_can(org_id));
drop policy if exists "Finance write nfse config" on org_nfse_config;
create policy "Finance write nfse config" on org_nfse_config for all using (fin_can(org_id)) with check (fin_can(org_id));

drop policy if exists "Finance read nota" on nota_fiscal;
create policy "Finance read nota" on nota_fiscal for select using (fin_can(org_id));
drop policy if exists "Finance write nota" on nota_fiscal;
create policy "Finance write nota" on nota_fiscal for all using (fin_can(org_id)) with check (fin_can(org_id));

grant select, insert, update, delete on org_nfse_config to authenticated;
grant select, insert, update, delete on nota_fiscal     to authenticated;

-- ── Número da próxima nota, sem corrida ─────────────────────────────────────
-- Duas emissões ao mesmo tempo pegariam o mesmo número se o app lesse e somasse.
-- O UPDATE ... RETURNING resolve no banco, com a linha travada.
drop function if exists proximo_numero_nfse(uuid, uuid);
create function proximo_numero_nfse(p_user_id uuid, p_org_id uuid)
 returns bigint language plpgsql security definer set search_path = public as $$
declare v_num bigint;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not fin_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  update org_nfse_config set proximo_numero = proximo_numero + 1, updated_at = now()
   where org_id = p_org_id
   returning proximo_numero - 1 into v_num;
  if v_num is null then raise exception 'Configure a nota fiscal antes de emitir.'; end if;
  return v_num;
end; $$;

revoke execute on function proximo_numero_nfse(uuid, uuid) from public, anon;
grant  execute on function proximo_numero_nfse(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
