-- 181_fix_views_security_invoker.sql
-- P0 DE SEGURANÇA — vazamento ATIVO do livro-caixa na internet pública.
--
-- Medido em 02/08/2026, sem nenhuma autenticação, de fora do VPS:
--   GET https://flow-api.oneaone.com.br/rest/v1/lancamentos_doc  → HTTP 200, 661 lançamentos
--   GET https://flow-api.oneaone.com.br/rest/v1/contas_saldo     → HTTP 200, 8 contas com saldo
-- (a tabela `lancamentos` direta responde 401 — a RLS dela está certa; o furo era
--  exclusivamente pelas VIEWS.)
--
-- CAUSA: as duas views nasceram com `with (security_invoker = true)` (127/134/135),
-- mas foram recriadas depois com `create or replace view ... as` SEM o WITH —
-- 140_conta_favorita.sql:13, 169_ordenacao_alfabetica.sql:62 e
-- 145_lancamentos_doc_transferencia.sql:7. No Postgres, CREATE OR REPLACE VIEW
-- REESCREVE as reloptions: omitir o WITH ZERA a opção. Sem security_invoker a view
-- roda com o privilégio do DONO (superuser, que aplicou a migration), então a RLS
-- das tabelas base NÃO é avaliada — e `anon` (o role de quem chega sem token no
-- PostgREST) tinha SELECT nas views por herança dos grants.
--
-- CORREÇÃO em duas camadas:
--   1. religar security_invoker → a RLS de lancamentos/contas_financeiras volta a valer;
--   2. revogar anon → defesa em profundidade (mesmo que alguém repita o erro da 140).
-- Usa ALTER VIEW SET, não CREATE OR REPLACE: liga a opção sem tocar na definição.
--
-- ⚠️ REGRA PERMANENTE: ao recriar QUALQUER view com create or replace, repetir
-- `with (security_invoker = true)`. Omitir não mantém o valor anterior — apaga.
-- Idempotente.

alter view contas_saldo    set (security_invoker = true);
alter view lancamentos_doc set (security_invoker = true);

revoke select on contas_saldo    from anon;
revoke select on lancamentos_doc from anon;

-- Nenhuma outra view existe hoje sem security_invoker (inventariado em 02/08/2026:
-- só estas duas). As tabelas com grant a anon têm RLS ligada e seguem protegidas.

notify pgrst, 'reload schema';
