-- ── Razão social passa pelas RPCs de fornecedor e veículo ───────────────────
--
-- A coluna nasceu na migration 320, mas quem escreve nestas tabelas são as RPCs
-- (SECURITY DEFINER, com o controle de acesso dentro) — e elas listam as colunas
-- uma a uma. Sem passar por aqui, o campo da tela não gravaria nada.
--
-- No UPDATE a razão social usa `p_data ? 'legal_name'`, e não `nullif(...)` como
-- os demais campos: chamada antiga, sem a chave, não pode APAGAR o que a emissão
-- da nota já preencheu automaticamente. É a mesma proteção que `tags` tem.

create or replace function create_fornecedor(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from organization_members where org_id=p_org_id and user_id=p_user_id
    and (role in ('owner','admin','manager') or can_vendas))
  then raise exception 'Acesso negado'; end if;
  insert into fornecedores (org_id, name, legal_name, tipo, tax_id, notes, enderecos, telefones, emails, contas_bancarias, tags, created_by)
  values (p_org_id, coalesce(nullif(p_data->>'name',''),'(sem nome)'), nullif(p_data->>'legal_name',''),
    nullif(p_data->>'tipo',''), nullif(p_data->>'tax_id',''), nullif(p_data->>'notes',''),
    coalesce(p_data->'enderecos','[]'::jsonb), coalesce(p_data->'telefones','[]'::jsonb), coalesce(p_data->'emails','[]'::jsonb), coalesce(p_data->'contas_bancarias','[]'::jsonb),
    fin_tags_do_jsonb(p_data->'tags'), p_user_id)
  returning id into v_id;
  return v_id;
end; $$;

create or replace function update_fornecedor(p_user_id uuid, p_fornecedor_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from fornecedores f join organization_members om on om.org_id=f.org_id
    where f.id=p_fornecedor_id and om.user_id=p_user_id and (om.role in ('owner','admin','manager') or om.can_vendas))
  then raise exception 'Acesso negado'; end if;
  update fornecedores set
    name=coalesce(nullif(p_data->>'name',''),name),
    legal_name = case when p_data ? 'legal_name' then nullif(p_data->>'legal_name','') else legal_name end,
    tipo=nullif(p_data->>'tipo',''), tax_id=nullif(p_data->>'tax_id',''), notes=nullif(p_data->>'notes',''),
    enderecos=coalesce(p_data->'enderecos', enderecos), telefones=coalesce(p_data->'telefones', telefones),
    emails=coalesce(p_data->'emails', emails), contas_bancarias=coalesce(p_data->'contas_bancarias', contas_bancarias),
    -- Só mexe nas tags se vieram no payload: chamada antiga (sem a chave) não apaga.
    tags = case when p_data ? 'tags' then fin_tags_do_jsonb(p_data->'tags') else tags end,
    updated_at=now()
  where id=p_fornecedor_id;
end; $$;

create or replace function create_veiculo(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from organization_members where org_id=p_org_id and user_id=p_user_id
    and (role in ('owner','admin','manager') or can_vendas))
  then raise exception 'Acesso negado'; end if;
  insert into veiculos (org_id, name, legal_name, type, tax_id, commission_pct, notes, enderecos, telefones, emails, contas_bancarias, midia_kit_url, midia_kit_name, created_by)
  values (p_org_id, coalesce(nullif(p_data->>'name',''),'(sem nome)'), nullif(p_data->>'legal_name',''),
    nullif(p_data->>'type',''), nullif(p_data->>'tax_id',''),
    coalesce(nullif(p_data->>'commission_pct','')::numeric,20), nullif(p_data->>'notes',''),
    coalesce(p_data->'enderecos','[]'::jsonb), coalesce(p_data->'telefones','[]'::jsonb), coalesce(p_data->'emails','[]'::jsonb), coalesce(p_data->'contas_bancarias','[]'::jsonb),
    nullif(p_data->>'midia_kit_url',''), nullif(p_data->>'midia_kit_name',''), p_user_id)
  returning id into v_id;
  return v_id;
end; $$;

create or replace function update_veiculo(p_user_id uuid, p_veiculo_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from veiculos v join organization_members om on om.org_id=v.org_id
    where v.id=p_veiculo_id and om.user_id=p_user_id and (om.role in ('owner','admin','manager') or om.can_vendas))
  then raise exception 'Acesso negado'; end if;
  update veiculos set
    name=coalesce(nullif(p_data->>'name',''),name),
    legal_name = case when p_data ? 'legal_name' then nullif(p_data->>'legal_name','') else legal_name end,
    type=nullif(p_data->>'type',''), tax_id=nullif(p_data->>'tax_id',''),
    commission_pct=coalesce(nullif(p_data->>'commission_pct','')::numeric, commission_pct), notes=nullif(p_data->>'notes',''),
    enderecos=coalesce(p_data->'enderecos', enderecos), telefones=coalesce(p_data->'telefones', telefones),
    emails=coalesce(p_data->'emails', emails), contas_bancarias=coalesce(p_data->'contas_bancarias', contas_bancarias),
    midia_kit_url=nullif(p_data->>'midia_kit_url',''), midia_kit_name=nullif(p_data->>'midia_kit_name',''),
    updated_at=now()
  where id=p_veiculo_id;
end; $$;

-- ⚠️ DEFAULT PRIVILEGES deste banco dá EXECUTE a anon e authenticated em TODA
-- função nova: o `create or replace` reaplica o padrão. Fechar o anônimo de novo.
revoke execute on function create_fornecedor(uuid, uuid, jsonb) from public, anon;
revoke execute on function update_fornecedor(uuid, uuid, jsonb) from public, anon;
revoke execute on function create_veiculo(uuid, uuid, jsonb)    from public, anon;
revoke execute on function update_veiculo(uuid, uuid, jsonb)    from public, anon;

notify pgrst, 'reload schema';
