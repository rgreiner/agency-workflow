-- "Esqueci a senha" (auth próprio). Tokens de redefinição no schema auth — NÃO
-- exposto pelo PostgREST; acessado só pela conexão Postgres direta (lib/db).
-- O token é guardado HASHEADO (sha256); o link no e-mail leva o token cru.
create table if not exists auth.password_reset_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  token_hash  text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_prt_token_hash on auth.password_reset_tokens(token_hash);
create index if not exists idx_prt_user       on auth.password_reset_tokens(user_id);
