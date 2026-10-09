-- Lançamento manual também guarda o vínculo com o cadastro (contato_id).
--
-- A mig. 322 deu a `lancamentos` o par (contato_tipo, contato_id) e os
-- geradores de faturamento passaram a gravá-lo. O lançamento DIGITADO, não:
-- create_lancamento ficou só com o nome em texto. Agora a despesa lançada a
-- partir da NF do fornecedor casa o fornecedor pelo CNPJ e precisa gravar QUAL
-- cadastro é — senão a rastreabilidade para no nome, que muda de grafia.
--
-- Mesma assinatura (p_data jsonb), então é CREATE OR REPLACE e nenhum chamador
-- muda. O id só entra se o cadastro for da própria org e do tipo informado: a
-- função é SECURITY DEFINER, e um uuid de outra org não pode virar vínculo.

create or replace function public.create_lancamento(p_user_id uuid, p_org_id uuid, p_data jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_id uuid; v_contato_id uuid; v_tipo_contato text;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  v_tipo_contato := nullif(p_data->>'contato_tipo','');
  v_contato_id := nullif(p_data->>'contato_id','')::uuid;
  if v_contato_id is not null and not (
       (v_tipo_contato = 'fornecedor' and exists (select 1 from fornecedores where id = v_contato_id and org_id = p_org_id))
    or (v_tipo_contato = 'veiculo'    and exists (select 1 from veiculos     where id = v_contato_id and org_id = p_org_id))
    or (v_tipo_contato = 'cliente'    and exists (select 1 from workspaces   where id = v_contato_id and org_id = p_org_id))
  ) then
    v_contato_id := null;
  end if;

  insert into lancamentos (
    org_id, tipo, origem_tipo, contato_tipo, contato_id, contato_nome, descricao, valor,
    vencimento, competencia, situacao, conta_id, categoria, centro_custo,
    forma_pagamento, observacao, recorrente, anexos, created_by
  ) values (
    p_org_id,
    coalesce(nullif(p_data->>'tipo',''), 'saida'),
    'manual',
    v_tipo_contato,
    v_contato_id,
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
end; $function$;

-- CREATE OR REPLACE mantém os grants, mas este banco dá EXECUTE a anon em toda
-- função por DEFAULT PRIVILEGES: reafirmar e conferir depois.
revoke execute on function public.create_lancamento(uuid, uuid, jsonb) from public, anon;
grant execute on function public.create_lancamento(uuid, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
