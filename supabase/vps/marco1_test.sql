-- ════════════════════════════════════════════════════════════════════
-- MARCO 1 — prove auth.uid() + RLS + grants + a SECURITY DEFINER RPC,
-- entirely in psql, WITHOUT PostgREST. Seeds a tiny graph, checks that a
-- member sees data and a non-member does not, then cleans up after itself.
-- ════════════════════════════════════════════════════════════════════
\set u1 '11111111-1111-1111-1111-111111111111'
\set u2 '22222222-2222-2222-2222-222222222222'
\set org 'aaaaaaaa-0000-0000-0000-000000000001'
\set ws  'bbbbbbbb-0000-0000-0000-000000000001'
\set cmp 'cccccccc-0000-0000-0000-000000000001'
\set act 'dddddddd-0000-0000-0000-000000000001'

-- 1) creating a user must auto-create its profile (handle_new_user trigger)
insert into auth.users (id, email, raw_user_meta_data)
values (:'u1', 'alice@flow.local', '{"full_name":"Alice"}'::jsonb)
on conflict (id) do nothing;
select '1. trigger criou profile (espera t)' as check,
       exists(select 1 from public.profiles where id = :'u1') as result;

-- seed the org graph as superuser (bypasses RLS)
insert into public.organizations (id, name, slug) values (:'org','Test Org','test-org') on conflict do nothing;
insert into public.organization_members (org_id, user_id, role) values (:'org', :'u1', 'owner') on conflict do nothing;
insert into public.workspaces (id, org_id, name) values (:'ws', :'org', 'Cliente X') on conflict do nothing;
insert into public.campaigns (id, workspace_id, name) values (:'cmp', :'ws', 'Campanha Y') on conflict do nothing;
insert into public.activities (id, campaign_id, title) values (:'act', :'cmp', 'Tarefa Z') on conflict do nothing;

-- 2) AS the member (uid1): RLS must ALLOW
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'u1', 'role', 'authenticated')::text, false);
select '2. auth.uid() == u1 (espera t)' as check, (auth.uid() = :'u1'::uuid) as result;
select '3. membro vê atividades (espera 1)' as check, count(*) as result from public.activities;
select '4. is_org_member p/ membro (espera t)' as check, public.is_org_member(:'org') as result;

-- 3) RPC SECURITY DEFINER as the member
select update_profile('Alice Editada', null);
reset role;
select '5. RPC update_profile aplicou (espera "Alice Editada")' as check, full_name as result
from public.profiles where id = :'u1';

-- 4) AS a non-member (uid2): RLS must DENY
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'u2', 'role', 'authenticated')::text, false);
select '6. nao-membro vê atividades (espera 0)' as check, count(*) as result from public.activities;
select '7. is_org_member p/ nao-membro (espera f)' as check, public.is_org_member(:'org') as result;
reset role;

-- cleanup so the DB is pristine for real first use
delete from public.activities where id = :'act';
delete from public.campaigns where id = :'cmp';
delete from public.workspaces where id = :'ws';
delete from public.organization_members where org_id = :'org';
delete from public.organizations where id = :'org';
delete from public.profiles where id = :'u1';
delete from auth.users where id = :'u1';
select '8. cleanup concluido' as check, 'ok' as result;
