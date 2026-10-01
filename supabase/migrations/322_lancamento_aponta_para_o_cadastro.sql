-- ── O contato do lançamento vira VÍNCULO, não texto ─────────────────────────
--
-- 01/10/2026, observação do Rafael: "uma vez que o pedido de produção gera um
-- faturamento que gera um lançamento, esse vínculo com o fornecedor não deveria
-- existir? Tudo pode e deveria ter rastreabilidade."
--
-- Ele está certo, e medido é pior do que parece: o vínculo JÁ EXISTE no
-- documento de origem e era descartado na geração, sobrando só o nome digitado.
--
--   mídia    → `midias.veiculo_id`      presente em 35/35, mas o nome do
--              lançamento só bate com o do cadastro em 27 — oito já derivaram.
--   fee      → `producao.workspace_id`  igual ao contato em 38/38.
--   proposta/venda → idem, 5 de 5.
--   pedido   → o contato é um FORNECEDOR (26 de 27 casam por nome), e `producao`
--              NÃO tem fornecedor_id. Aqui o vínculo não existe nem na origem:
--              é mudança no documento de produção, não backfill. Fica de fora.
--
-- `contato_tipo` já existia e estava vazio em 905 das 1.011 linhas. Agora ele
-- ganha par: `contato_id`, apontando para o cadastro de verdade.

alter table lancamentos
  add column if not exists contato_id uuid;

comment on column lancamentos.contato_id is
  'Cadastro apontado por contato_tipo: workspaces (cliente), veiculos ou fornecedores. Sem FK porque são três tabelas — a integridade é do par (tipo, id).';
comment on column lancamentos.contato_tipo is
  'cliente | fornecedor | veiculo — diz em qual tabela contato_id vive.';

create index if not exists idx_lancamentos_contato on lancamentos (contato_tipo, contato_id)
  where contato_id is not null;

-- ── Backfill: só o que é determinístico ─────────────────────────────────────
-- Mídia: o veículo vem do documento, não do nome. É por isso que corrige as
-- oito grafias divergentes em vez de perpetuá-las.
update lancamentos l
   set contato_tipo = 'veiculo', contato_id = m.veiculo_id
  from midias m
 where m.id = l.origem_id and l.origem_tipo = 'midia'
   and m.veiculo_id is not null and l.contato_id is null;

-- Fee, proposta e venda: quem recebe é o CLIENTE do documento.
update lancamentos l
   set contato_tipo = 'cliente', contato_id = p.workspace_id
  from producao p
 where p.id = l.origem_id and l.origem_tipo = 'producao'
   and p.tipo in ('fee', 'proposta', 'venda')
   and p.workspace_id is not null and l.contato_id is null;

-- O resto (import, manual, pedido de produção) fica sem vínculo de propósito:
-- preencher por semelhança de nome seria inventar rastreabilidade, que é o
-- oposto do que isto resolve.

notify pgrst, 'reload schema';
