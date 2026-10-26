-- 364 — Flávia lança despesa que o Rafael mandou (WhatsApp/e-mail), com o Sim dele
--
-- Mesmo insert do create_lancamento (tela "Lançar despesa"), mas para a usuária
-- do agente, que é do financeiro e não gestora. Mesmas réguas da tela: valor > 0,
-- vencimento, categoria e centro de custo obrigatórios; contato só se existir.
create or replace function public.fin_lancar_despesa_agente(p_org uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id uuid; v_contato_id uuid; v_tipo_contato text;
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if coalesce(nullif(p_data->>'valor', '')::numeric, 0) <= 0 then raise exception 'Informe o valor'; end if;
  if nullif(p_data->>'vencimento', '') is null then raise exception 'Informe o vencimento'; end if;
  if coalesce(btrim(p_data->>'categoria'), '') = '' then raise exception 'Informe a categoria'; end if;
  if coalesce(btrim(p_data->>'centro_custo'), '') = '' then raise exception 'Informe o centro de custo'; end if;

  v_tipo_contato := nullif(p_data->>'contato_tipo', '');
  v_contato_id := nullif(p_data->>'contato_id', '')::uuid;
  if v_contato_id is not null and not (v_tipo_contato = 'fornecedor' and exists (select 1 from fornecedores where id = v_contato_id and org_id = p_org)) then
    v_contato_id := null; v_tipo_contato := null;
  end if;
  if nullif(p_data->>'conta_id', '') is not null and not exists (select 1 from contas_financeiras where id = (p_data->>'conta_id')::uuid and org_id = p_org) then
    raise exception 'Conta inválida';
  end if;

  insert into lancamentos (
    org_id, tipo, origem_tipo, contato_tipo, contato_id, contato_nome, descricao, valor,
    vencimento, competencia, situacao, conta_id, categoria, centro_custo,
    forma_pagamento, observacao, anexos, created_by
  ) values (
    p_org, 'saida', 'manual', v_tipo_contato, v_contato_id, nullif(p_data->>'contato_nome', ''),
    nullif(p_data->>'descricao', ''), (p_data->>'valor')::numeric,
    (p_data->>'vencimento')::date,
    coalesce(nullif(p_data->>'competencia', '')::date, (p_data->>'vencimento')::date),
    'em_aberto', nullif(p_data->>'conta_id', '')::uuid, p_data->>'categoria', p_data->>'centro_custo',
    nullif(p_data->>'forma_pagamento', ''), nullif(p_data->>'observacao', ''),
    coalesce(p_data->'anexos', '[]'::jsonb), auth.uid()
  ) returning id into v_id;
  insert into lancamento_historico (org_id, lancamento_id, tipo, texto, por)
  values (p_org, v_id, 'nota', 'Lançado pela Flávia a pedido do Rafael (aprovado)', auth.uid());
  return v_id;
end $$;
revoke execute on function public.fin_lancar_despesa_agente(uuid, jsonb) from public, anon;
grant execute on function public.fin_lancar_despesa_agente(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
