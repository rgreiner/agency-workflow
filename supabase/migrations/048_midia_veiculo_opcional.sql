-- 048_midia_veiculo_opcional.sql
-- Permite mídia sem veículo (rascunhos gerados a partir da Proposta). Idempotente.

alter table midias alter column veiculo_id drop not null;

-- create_midia: veiculo_id agora opcional (nullif).
create or replace function create_midia(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_numero integer;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  select coalesce(max(numero), 0) + 1 into v_numero from midias where org_id = p_org_id;

  insert into midias (
    org_id, numero, workspace_id, campaign_id, veiculo_id, tipo, titulo, emissao, job,
    aut_veiculo, codigo_identificador, nota_fiscal, pecas, praca, abrangencia,
    valor, desconto_pct, faturamento, prazo, data_base, dias_agencia,
    primeira_veiculacao, ultima_veiculacao, contato, responsavel_id, situacao,
    observacao, texto_legal, detalhe, created_by
  ) values (
    p_org_id, v_numero,
    (p_data->>'workspace_id')::uuid,
    nullif(p_data->>'campaign_id','')::uuid,
    nullif(p_data->>'veiculo_id','')::uuid,
    nullif(p_data->>'tipo',''),
    coalesce(nullif(p_data->>'titulo',''), '(sem título)'),
    nullif(p_data->>'emissao','')::date,
    nullif(p_data->>'job',''),
    nullif(p_data->>'aut_veiculo',''),
    nullif(p_data->>'codigo_identificador',''),
    nullif(p_data->>'nota_fiscal',''),
    nullif(p_data->>'pecas',''),
    nullif(p_data->>'praca',''),
    nullif(p_data->>'abrangencia',''),
    coalesce(nullif(p_data->>'valor','')::numeric, 0),
    coalesce(nullif(p_data->>'desconto_pct','')::numeric, 20),
    nullif(p_data->>'faturamento',''),
    nullif(p_data->>'prazo',''),
    nullif(p_data->>'data_base','')::date,
    coalesce(nullif(p_data->>'dias_agencia','')::int, 7),
    nullif(p_data->>'primeira_veiculacao','')::date,
    nullif(p_data->>'ultima_veiculacao','')::date,
    nullif(p_data->>'contato',''),
    nullif(p_data->>'responsavel_id','')::uuid,
    coalesce(nullif(p_data->>'situacao',''), 'em_aberto'),
    nullif(p_data->>'observacao',''),
    nullif(p_data->>'texto_legal',''),
    coalesce(p_data->'detalhe', '{}'::jsonb),
    p_user_id
  ) returning id into v_id;
  return v_id;
end; $$;

grant execute on function create_midia(uuid,uuid,jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
