-- 247_fecha_evento_ponto.sql
-- O achado mais sério depois do digest: `rh_marcacao_evento_add` aceitava
-- chamada ANÔNIMA e GRAVAVA na cadeia de auditoria do ponto.
--
-- Provado em produção durante a revisão (15/08): um POST sem login inseriu a
-- linha 749 (`acao='teste'`, `origem='anon'`) e recebeu de volta o código do
-- evento. Ou seja, qualquer pessoa na internet podia injetar eventos numa
-- cadeia encadeada por hash e append-only — justamente a estrutura que dá
-- valor probatório ao espelho de ponto.
--
-- Correção: revogar. A função é helper do trigger `rh_marcacao_log` e não é
-- chamada pelo app em lugar nenhum; dentro do trigger, o privilégio avaliado é
-- o do dono, então fechar a API não afeta o registro real de ponto.
--
-- Sobre a linha 749: fica onde está, DE PROPÓSITO. A tabela é append-only por
-- trigger (`rh_append_only`), e desligar essa proteção para apagar um registro
-- seria abrir mão exatamente da garantia que ela existe para dar. Ela está
-- marcada como teste, não é uma marcação de ponto (as marcações vivem em
-- `rh_marcacao`, que segue intacta), não entra em cálculo de horas e não
-- pertence a nenhum espelho assinado.
--
-- Idempotente.

revoke execute on function rh_marcacao_evento_add(uuid, uuid, date, time, integer, text, text)
  from anon, authenticated, public;

notify pgrst, 'reload schema';
