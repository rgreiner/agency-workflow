-- 104_btg_connection.sql
-- Conexão BTG Empresas por org (OAuth Authorization Code). Guarda o refresh token
-- (10 dias sliding) usado pelo sync do extrato. A tabela tem RLS SEM policy de
-- propósito: o PostgREST (anon/authenticated) NÃO lê; o acesso é só pela conexão
-- Postgres direta (lib/db, role dona → bypassa RLS), server-side. Idempotente.

create table if not exists btg_connections (
  org_id        uuid primary key references organizations(id) on delete cascade,
  company_id    text,               -- CNPJ (companyId nos paths da API)
  account_id    text,               -- conta escolhida (CNPJ-banco-agência-conta)
  refresh_token text,               -- credencial sensível — nunca vai pro cliente
  scopes        text,
  status        text not null default 'connected',  -- connected | error | revoked
  connected_at  timestamptz,
  last_sync_at  timestamptz,
  last_error    text,
  updated_at    timestamptz not null default now()
);

alter table btg_connections enable row level security;
-- Sem policy: bloqueia leitura via PostgREST. Acesso só pela conexão direta (server).

notify pgrst, 'reload schema';
