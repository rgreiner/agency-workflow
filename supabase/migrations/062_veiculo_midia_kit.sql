-- 062_veiculo_midia_kit.sql
-- Mídia kit (PDF) no cadastro do veículo: URL do arquivo + nome original p/ exibir.
-- Idempotente. Mantém a permissão de 060 (manager+ OU can_vendas).
alter table veiculos add column if not exists midia_kit_url  text;
alter table veiculos add column if not exists midia_kit_name text;

create or replace function create_veiculo(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from organization_members where org_id=p_org_id and user_id=p_user_id
    and (role in ('owner','admin','manager') or can_vendas))
  then raise exception 'Acesso negado'; end if;
  insert into veiculos (org_id, name, type, tax_id, commission_pct, notes, enderecos, telefones, emails, contas_bancarias, midia_kit_url, midia_kit_name, created_by)
  values (p_org_id, coalesce(nullif(p_data->>'name',''),'(sem nome)'), nullif(p_data->>'type',''), nullif(p_data->>'tax_id',''),
    coalesce(nullif(p_data->>'commission_pct','')::numeric,20), nullif(p_data->>'notes',''),
    coalesce(p_data->'enderecos','[]'::jsonb), coalesce(p_data->'telefones','[]'::jsonb), coalesce(p_data->'emails','[]'::jsonb), coalesce(p_data->'contas_bancarias','[]'::jsonb),
    nullif(p_data->>'midia_kit_url',''), nullif(p_data->>'midia_kit_name',''), p_user_id)
  returning id into v_id;
  return v_id;
end; $$;

create or replace function update_veiculo(p_user_id uuid, p_veiculo_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from veiculos v join organization_members om on om.org_id=v.org_id
    where v.id=p_veiculo_id and om.user_id=p_user_id and (om.role in ('owner','admin','manager') or om.can_vendas))
  then raise exception 'Acesso negado'; end if;
  update veiculos set
    name=coalesce(nullif(p_data->>'name',''),name), type=nullif(p_data->>'type',''), tax_id=nullif(p_data->>'tax_id',''),
    commission_pct=coalesce(nullif(p_data->>'commission_pct','')::numeric, commission_pct), notes=nullif(p_data->>'notes',''),
    enderecos=coalesce(p_data->'enderecos', enderecos), telefones=coalesce(p_data->'telefones', telefones),
    emails=coalesce(p_data->'emails', emails), contas_bancarias=coalesce(p_data->'contas_bancarias', contas_bancarias),
    midia_kit_url=nullif(p_data->>'midia_kit_url',''), midia_kit_name=nullif(p_data->>'midia_kit_name',''),
    updated_at=now()
  where id=p_veiculo_id;
end; $$;

notify pgrst, 'reload schema';
