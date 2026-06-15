-- ════════════════════════════════════════════════════════════════════
-- VPS GRANTS — run AFTER all migrations (tables/functions must exist)
-- ════════════════════════════════════════════════════════════════════
-- Supabase auto-grants new tables to anon/authenticated via default
-- privileges; plain Postgres does not. PostgREST runs each request as
-- anon or authenticated, so those roles need table/function privileges.
-- RLS still gates every row — these grants only open the door; the
-- policies decide what passes.
-- ════════════════════════════════════════════════════════════════════

grant usage on schema public to anon, authenticated;

-- Authenticated users: full DML, gated by RLS policies.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- All RPCs are already GRANTed in the migrations, but cover any that aren't.
grant execute on all functions in schema public to anon, authenticated;

-- Anon (pre-login) needs the public invite-by-token read path. The convite
-- page mostly uses the get_invite_info() SECURITY DEFINER RPC (covered above),
-- but the "Anyone can read invitation by token" RLS policy also allows a
-- direct select, so grant the table read to anon as well.
grant select on invitations to anon;

-- Future tables created in this DB inherit these grants automatically.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant execute on functions to anon, authenticated;
