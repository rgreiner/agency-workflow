-- Custo do fornecedor ligado ao pedido de produção.
--
-- Hoje a receita tem rastro até o documento (mig. 322/323: o lançamento sabe de
-- qual PP veio e de qual cadastro), mas o CUSTO não: a NF do fornecedor é
-- digitada como lançamento manual, com o centro de custo certo — então a margem
-- fecha — e nenhum elo com o pedido que a gerou. Medido em 03/10/2026: 30 dos
-- 76 pedidos têm fornecedor vinculado, e o item do PP guarda só o `valor` que o
-- cliente paga; não existe campo de custo em lugar nenhum.
--
-- RPC própria em vez de estender `create_lancamento`: aquela função crava
-- origem_tipo='manual' e é usada por todo lançamento digitado à mão. Mudá-la
-- para carregar origem seria arriscar o caminho mais usado do financeiro por
-- causa de um caso novo.
--
-- São N notas para 1 pedido (o fornecedor às vezes manda mais de uma), então
-- nada aqui impede repetir — o que se evita é a MESMA nota duas vezes.

create or replace function criar_despesa_de_pedido(
  p_user_id uuid, p_org_id uuid, p_producao_id uuid, p_data jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_prod record;
  v_centro text;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  select p.id, p.org_id, p.serie, p.numero, w.name as cliente
    into v_prod
    from producao p left join workspaces w on w.id = p.workspace_id
   where p.id = p_producao_id and p.org_id = p_org_id;
  if not found then raise exception 'Pedido não encontrado'; end if;

  -- O centro de custo é o CLIENTE do pedido: é o que faz o custo chegar na
  -- margem daquele cliente (fin_margem_cliente resolve por centro_custo quando
  -- não há workspace_id). Quem chama pode mandar outro, mas o padrão é este.
  v_centro := coalesce(nullif(btrim(p_data->>'centro_custo'), ''), v_prod.cliente);

  -- Mesma nota do mesmo fornecedor no mesmo pedido = relançamento. Barra aqui,
  -- porque despesa em duplicidade estraga margem e fluxo de caixa ao mesmo tempo.
  if nullif(p_data->>'numero_nf','') is not null and exists (
    select 1 from lancamentos l
     where l.org_id = p_org_id and l.origem_tipo = 'producao' and l.origem_id = p_producao_id
       and l.tipo = 'saida' and l.observacao = ('NF ' || (p_data->>'numero_nf'))
  ) then
    raise exception 'A NF % já foi lançada neste pedido.', p_data->>'numero_nf';
  end if;

  insert into lancamentos (
    org_id, tipo, origem_tipo, origem_id, origem_ref,
    contato_tipo, contato_id, contato_nome, descricao, valor,
    vencimento, competencia, situacao, conta_id, categoria, centro_custo,
    observacao, anexos, created_by
  ) values (
    p_org_id, 'saida', 'producao', p_producao_id,
    coalesce(v_prod.serie, 'PP') || ' ' || coalesce(v_prod.numero::text, ''),
    'fornecedor',
    nullif(p_data->>'contato_id','')::uuid,
    nullif(p_data->>'contato_nome',''),
    nullif(p_data->>'descricao',''),
    coalesce(nullif(p_data->>'valor','')::numeric, 0),
    nullif(p_data->>'vencimento','')::date,
    coalesce(nullif(p_data->>'competencia','')::date, nullif(p_data->>'vencimento','')::date),
    coalesce(nullif(p_data->>'situacao',''), 'em_aberto'),
    nullif(p_data->>'conta_id','')::uuid,
    coalesce(nullif(p_data->>'categoria',''), 'Produção'),
    v_centro,
    case when nullif(p_data->>'numero_nf','') is not null
         then 'NF ' || (p_data->>'numero_nf') else nullif(p_data->>'observacao','') end,
    coalesce(p_data->'anexos', '[]'::jsonb),
    p_user_id
  ) returning id into v_id;

  return v_id;
end $$;

-- DEFAULT PRIVILEGES deste banco dá EXECUTE a anon/authenticated em toda função
-- nova; revogar de PUBLIC não toca nesses dois.
revoke execute on function criar_despesa_de_pedido(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function criar_despesa_de_pedido(uuid, uuid, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
