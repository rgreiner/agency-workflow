-- 157_portal_senha.sql
-- Portal do cliente: senha opcional pra acesso recorrente (além do magic link).
-- O cliente cria a própria senha no painel; o magic link segue como 1º acesso e
-- recuperação ("esqueci a senha"). NULL = contato que só usa magic link.
-- A senha é gravada/lida pela conexão direta (lib/db, role flow_auth), que já tem
-- update em portal_users (migration 153) — nenhum grant novo. Idempotente.

alter table portal_users add column if not exists senha_hash text;

notify pgrst, 'reload schema';
