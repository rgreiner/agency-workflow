-- Quem não está logado (role anon) não lê nem grava tabela nenhuma, e função
-- nova nasce FECHADA para ele. Auditoria de 17/10/2026.
--
-- 1. Doze tabelas tinham privilégio para anon — leitura e, em cinco, gravação
--    (documents, document_members, todos, notifications, user_prefs) — herança de
--    migrations antigas. A RLS barrava, mas era a ÚNICA camada; e `user_presence`
--    devolvia, sem login, o id de cada usuário e quando esteve online. Nenhuma
--    tela pública usa essas tabelas (convite, cotação e proposta vão por RPC com
--    token; o portal do cliente usa a role `portal`).
--
-- 2. A causa: ALTER DEFAULT PRIVILEGES dava EXECUTE a anon em TODA função nova.
--    Foi a armadilha que abriu 3 P0 (migs. 167, 183, 244–247) e obrigava cada
--    migration a lembrar do `revoke ... from anon`. Agora o padrão é fechado:
--    função pública (página sem login) precisa de `grant execute ... to anon`
--    EXPLÍCITO. As funções que já existem não mudam.

revoke all on table
  activity_comment_reactions, chat_messages, document_members, documents,
  extrato_descartado, fechamento_contabil, invitations, notifications,
  ofx_arquivos, todos, user_prefs, user_presence
from anon;

alter default privileges for role postgres in schema public revoke execute on functions from anon;
-- O Postgres também dá EXECUTE a PUBLIC (que inclui anon) em toda função nova.
-- Esse padrão embutido mora no nível GLOBAL do dono (sem "in schema") — revogar
-- só no schema não o tira. `authenticated` segue com o padrão explícito acima.
alter default privileges for role postgres revoke execute on functions from public;

notify pgrst, 'reload schema';
