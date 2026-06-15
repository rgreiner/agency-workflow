-- ════════════════════════════════════════════════════════════════════
-- VPS BOOTSTRAP — run BEFORE the 001..019 migrations
-- ════════════════════════════════════════════════════════════════════
-- Purpose: provide the Supabase-platform pieces the migrations assume
-- (auth schema, auth.users, auth.uid(), and the anon/authenticated roles)
-- so the existing migrations + RLS + RPCs run UNCHANGED against a plain
-- Postgres 17 fronted by PostgREST.
--
-- Order of apply (see README.md):
--   00_bootstrap.sql  → 001..016 → (skip 017) → 018b_update_profile.sql
--   → 019 → 99_grants.sql
-- ════════════════════════════════════════════════════════════════════

-- Extensions used by the app migrations
create extension if not exists "uuid-ossp";   -- uuid_generate_v4() (app tables)
create extension if not exists "pgcrypto";     -- gen_random_uuid(), gen_random_bytes()

-- ──────────────────────────────────────────────
-- ROLES (must exist before the migrations' GRANT ... TO anon, authenticated)
-- PostgREST connects as `authenticator` and SET ROLE to the JWT `role` claim.
-- ──────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    -- password is set at deploy time (see README); placeholder kept harmless
    create role authenticator login noinherit password 'CHANGE_ME_AUTHENTICATOR_PW';
  end if;
end
$$;

grant anon, authenticated to authenticator;

-- ──────────────────────────────────────────────
-- AUTH SCHEMA — our own replacement for Supabase's auth.* surface
-- ──────────────────────────────────────────────
create schema if not exists auth;

-- Minimal auth.users: enough for the handle_new_user() trigger (001) and the
-- profiles FK. Our own email/password auth writes here (Fase 2).
create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null unique,
  encrypted_password  text,                       -- scrypt hash (own auth)
  raw_user_meta_data  jsonb not null default '{}'::jsonb,  -- full_name, avatar_url
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- auth.uid(): read the `sub` claim PostgREST injects from the verified JWT.
-- Returns NULL when there is no JWT (anon) → RLS denies as expected.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub',
    ''
  )::uuid
$$;

-- auth.role(): the `role` claim, defaulting to 'anon'.
create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
    'anon'
  )
$$;

-- auth.jwt(): full claims object (some apps read auth.jwt() ->> 'email').
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  )
$$;

-- Let the runtime roles see the auth schema + helpers (RLS calls auth.uid()).
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated;
