-- 310_cotacoes.sql
-- Pedido de cotação: o orçamento sai para N fornecedores de uma vez, cada um recebe
-- um link próprio (e-mail ou WhatsApp) e preenche a proposta no Flow. A resposta
-- entra como OPÇÃO no item do orçamento — ninguém redigita valor de PDF.
--
-- Medido em 30/09/2026: ~12 orçamentos/mês com ~4 opções cada (≈50 pedidos de
-- cotação por mês feitos à mão); 158 de 404 fornecedores com e-mail, 216 com
-- telefone — por isso o WhatsApp entra desde o começo (link wa.me, sem API).
--
-- Quem vê: membro da org. Quem manda: manager+ — a mesma régua de quem edita o
-- orçamento (update_producao). O FORNECEDOR não é usuário do banco: a página
-- pública fala com o Postgres pelo servidor (conexão direta), sempre pelo token
-- do convite. Nenhuma função nova nasce aqui, então nada fica chamável por anon.
--
-- Idempotente.

create table if not exists cotacoes (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  producao_id     uuid not null references producao(id) on delete cascade,
  -- Retrato do que foi pedido: [{idx, nome, descricao, faixas:[500,1000,…]}].
  -- `idx` é a posição do item no orçamento no momento do envio.
  itens           jsonb not null default '[]'::jsonb,
  mensagem        text,
  prazo_resposta  date,
  -- Arquivos da agência para o fornecedor: [{chave, nome}] em cotacao-privado/.
  anexos          jsonb not null default '[]'::jsonb,
  encerrada       boolean not null default false,
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_cotacoes_producao on cotacoes (producao_id);
create index if not exists idx_cotacoes_org on cotacoes (org_id);

create table if not exists cotacao_convites (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  cotacao_id         uuid not null references cotacoes(id) on delete cascade,
  fornecedor_id      uuid not null references fornecedores(id) on delete cascade,
  -- 32 bytes aleatórios em hex, gerados no servidor. É a única credencial da
  -- página pública.
  token              text not null unique,
  email_para         text,
  email_enviado_em   timestamptz,
  whatsapp_em        timestamptz,
  aberto_em          timestamptz,
  respondido_em      timestamptz,
  recusado_em        timestamptz,
  -- {itens:[{idx, nao_fornece, precos:[{quant, unit, total}], obs}], prazo_producao,
  --  validade, pgto, n_orc, observacao}
  resposta           jsonb,
  -- Arquivos do fornecedor: [{chave, nome}] em cotacao-privado/.
  resposta_anexos    jsonb not null default '[]'::jsonb,
  -- O que o fornecedor informou de si (nome do contato, CNPJ, e-mail, WhatsApp).
  dados_fornecedor   jsonb,
  created_at         timestamptz not null default now(),
  unique (cotacao_id, fornecedor_id)
);
create index if not exists idx_cotacao_convites_cotacao on cotacao_convites (cotacao_id);
create index if not exists idx_cotacao_convites_fornecedor on cotacao_convites (fornecedor_id);

alter table cotacoes enable row level security;
alter table cotacao_convites enable row level security;

drop policy if exists "Org members read cotacoes" on cotacoes;
create policy "Org members read cotacoes" on cotacoes for select using (is_org_member(org_id));
drop policy if exists "Manager+ manage cotacoes" on cotacoes;
create policy "Manager+ manage cotacoes" on cotacoes for all
  using (org_member_role(org_id) = any (array['owner','admin','manager']::member_role[]))
  with check (org_member_role(org_id) = any (array['owner','admin','manager']::member_role[]));

drop policy if exists "Org members read cotacao_convites" on cotacao_convites;
create policy "Org members read cotacao_convites" on cotacao_convites for select using (is_org_member(org_id));
drop policy if exists "Manager+ manage cotacao_convites" on cotacao_convites;
create policy "Manager+ manage cotacao_convites" on cotacao_convites for all
  using (org_member_role(org_id) = any (array['owner','admin','manager']::member_role[]))
  with check (org_member_role(org_id) = any (array['owner','admin','manager']::member_role[]));

-- A tabela não pode ser lida sem login: o token mora nela.
revoke all on cotacoes, cotacao_convites from anon;
grant select, insert, update, delete on cotacoes, cotacao_convites to authenticated;

comment on table cotacoes is 'Pedido de cotação de um orçamento (producao tipo orcamento) para N fornecedores.';
comment on table cotacao_convites is 'Um fornecedor convidado numa cotação: link por token, status e a proposta que ele enviou.';

notify pgrst, 'reload schema';
