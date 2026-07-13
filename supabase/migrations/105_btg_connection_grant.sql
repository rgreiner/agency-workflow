-- 105_btg_connection_grant.sql
-- Fix do 104: a tabela btg_connections é lida/escrita pela CONEXÃO DIRETA do app
-- (role `flow_auth`, a mesma do auth.users), não pelo PostgREST. O 104 ligou RLS sem
-- policy → a role flow_auth levava "permission denied". Aqui damos grant + policy só
-- pra flow_auth, mantendo o RLS ligado (anon/authenticated do PostgREST seguem
-- bloqueados = token protegido). Idempotente; no-op se a role não existir (ex.: local).

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'flow_auth') then
    grant usage on schema public to flow_auth;
    grant select, insert, update, delete on table btg_connections to flow_auth;
    drop policy if exists btg_conn_flow_auth on btg_connections;
    create policy btg_conn_flow_auth on btg_connections
      for all to flow_auth using (true) with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';
