-- 100_lancamento_anexos_no_create.sql
-- Permite anexar arquivos (NF/boleto/nota) já na CRIAÇÃO do lançamento e na
-- PROMOÇÃO de uma linha importada (Conta Azul → Flow). Antes os anexos só podiam
-- ser adicionados depois de salvo (set_lancamento_anexos). Agora create_lancamento
-- e promover_extrato leem p_data->'anexos' ([{url,nome,tipo}]). Idempotente.

create or replace function create_lancamento(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  insert into lancamentos (
    org_id, tipo, origem_tipo, contato_tipo, contato_nome, descricao, valor,
    vencimento, competencia, situacao, conta_id, categoria, centro_custo,
    forma_pagamento, observacao, recorrente, anexos, created_by
  ) values (
    p_org_id,
    coalesce(nullif(p_data->>'tipo',''), 'saida'),
    'manual',
    nullif(p_data->>'contato_tipo',''),
    nullif(p_data->>'contato_nome',''),
    nullif(p_data->>'descricao',''),
    coalesce(nullif(p_data->>'valor','')::numeric, 0),
    nullif(p_data->>'vencimento','')::date,
    coalesce(nullif(p_data->>'competencia','')::date, nullif(p_data->>'vencimento','')::date),
    coalesce(nullif(p_data->>'situacao',''), 'em_aberto'),
    nullif(p_data->>'conta_id','')::uuid,
    nullif(p_data->>'categoria',''),
    nullif(p_data->>'centro_custo',''),
    nullif(p_data->>'forma_pagamento',''),
    nullif(p_data->>'observacao',''),
    coalesce((p_data->>'recorrente')::boolean, false),
    coalesce(p_data->'anexos', '[]'::jsonb),
    p_user_id
  ) returning id into v_id;
  return v_id;
end; $$;

create or replace function promover_extrato(p_user_id uuid, p_org_id uuid, p_import_ref text, p_dados jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;
  if coalesce(p_import_ref, '') = '' then raise exception 'import_ref vazio'; end if;

  insert into lancamentos (
    org_id, origem_tipo, origem_ref, tipo, contato_nome, descricao, valor,
    vencimento, competencia, situacao, conta_id, categoria, centro_custo,
    forma_pagamento, observacao, data_liquidacao, valor_realizado,
    juros, multa, desconto, tarifa, anexos, created_by
  ) values (
    p_org_id, 'conta_azul', p_import_ref,
    coalesce(nullif(p_dados->>'tipo',''), 'entrada'),
    nullif(p_dados->>'contato_nome',''),
    nullif(p_dados->>'descricao',''),
    coalesce(nullif(p_dados->>'valor','')::numeric, 0),
    nullif(p_dados->>'vencimento','')::date,
    coalesce(nullif(p_dados->>'competencia','')::date, nullif(p_dados->>'vencimento','')::date),
    coalesce(nullif(p_dados->>'situacao',''), 'em_aberto'),
    nullif(p_dados->>'conta_id','')::uuid,
    nullif(p_dados->>'categoria',''),
    nullif(p_dados->>'centro_custo',''),
    nullif(p_dados->>'forma_pagamento',''),
    nullif(p_dados->>'observacao',''),
    nullif(p_dados->>'data_liquidacao','')::date,
    nullif(p_dados->>'valor_realizado','')::numeric,
    coalesce(nullif(p_dados->>'juros','')::numeric, 0),
    coalesce(nullif(p_dados->>'multa','')::numeric, 0),
    coalesce(nullif(p_dados->>'desconto','')::numeric, 0),
    coalesce(nullif(p_dados->>'tarifa','')::numeric, 0),
    coalesce(p_dados->'anexos', '[]'::jsonb),
    p_user_id
  ) returning id into v_id;
  return v_id;
end; $$;

grant execute on function create_lancamento(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function promover_extrato(uuid,uuid,text,jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
