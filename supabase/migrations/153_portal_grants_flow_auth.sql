-- 153_portal_grants_flow_auth.sql
-- Fix do portal (fase 1): a conexão direta do app (DATABASE_URL) roda como
-- `flow_auth` — role sem superuser e sem bypass de RLS, que até hoje só tocava
-- o schema auth. O fluxo de magic link lê/atualiza public.portal_users pela
-- conexão direta e caiu em "permission denied for table portal_users" (42501).
-- Aqui: grants + policy explícita pra flow_auth (é a camada server-side de
-- auth, confiável por definição — o browser nunca fala com ela).
-- Idempotente.

grant usage on schema public to flow_auth;

-- Fluxo do magic link: buscar contato por e-mail + carimbar last_login_at.
grant select, update on public.portal_users to flow_auth;

-- RLS está ligada em portal_users e as policies existentes dependem de
-- auth.uid() (null na conexão direta) — sem esta policy o grant não basta.
drop policy if exists portal_users_flow_auth on portal_users;
create policy portal_users_flow_auth on portal_users
  for all to flow_auth using (true) with check (true);

-- Tokens do magic link (schema auth, sem RLS): criar, validar e consumir.
grant select, insert, update on auth.portal_login_tokens to flow_auth;

notify pgrst, 'reload schema';
