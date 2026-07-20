DB=j14j0o0lmmk20mbcya17dgnd
docker exec -i "$DB" psql -U postgres -d postgres <<'SQL'
\echo == total de docs (superuser, sem RLS) ==
select count(*) from documents;
\echo == docs visiveis via RLS para o 1o owner/admin ==
do $$
declare v_uid uuid; v_org uuid; v_all int; v_active int;
begin
  select user_id, org_id into v_uid, v_org from organization_members where role in ('owner','admin') limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_all    from documents where org_id = v_org;
  select count(*) into v_active from documents where org_id = v_org and archived = false;
  reset role;
  raise notice 'user=%  org=%  total_visiveis=%  ativos_visiveis=%', v_uid, v_org, v_all, v_active;
end $$;
SQL
