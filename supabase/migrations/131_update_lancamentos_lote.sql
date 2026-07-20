-- 131_update_lancamentos_lote.sql
-- Edição em lote dos lançamentos (barra flutuante na tela de Lançamentos).
-- Só campos que fazem sentido em lote: conta, categoria, centro de custo, forma de
-- pagamento e os flags NF/boleto. Vencimento, valor, contato e descrição ficam de
-- fora — são únicos por linha.
--
-- REGRA DO RAFAEL: lançamento já conciliado NÃO se mexe; precisa desconciliar antes.
-- Aqui isso cobre dois casos:
--   1) situacao pago/recebido — baixa total;
--   2) valor_realizado > 0 com situacao em_aberto — baixa PARCIAL (ex.: um PIX que
--      quitou metade da nota). Tem dinheiro amarrado igual, e mexer na conta ou no
--      valor quebraria a conta da conciliação.
-- Os bloqueados são PULADOS (não é erro) e devolvidos na contagem, pra tela dizer
-- exatamente o que aconteceu em vez de falhar o lote inteiro. Idempotente.

create or replace function update_lancamentos_lote(
  p_user_id uuid, p_ids uuid[], p_data jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_atualizados int := 0; v_bloqueados int := 0; v_total int;
begin
  v_total := coalesce(array_length(p_ids, 1), 0);
  if v_total = 0 then
    return jsonb_build_object('atualizados', 0, 'bloqueados', 0, 'total', 0);
  end if;

  -- Todos têm que ser da MESMA org, e o usuário precisa ter acesso a ela.
  select distinct org_id into v_org from lancamentos where id = any(p_ids);
  if v_org is null then raise exception 'Lançamentos não encontrados'; end if;
  if (select count(distinct org_id) from lancamentos where id = any(p_ids)) > 1 then
    raise exception 'Seleção mistura organizações';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = v_org and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  select count(*) into v_bloqueados from lancamentos
  where id = any(p_ids)
    and (situacao in ('pago','recebido') or coalesce(valor_realizado, 0) > 0);

  update lancamentos set
    conta_id        = case when p_data ? 'conta_id' then nullif(p_data->>'conta_id','')::uuid else conta_id end,
    categoria       = case when p_data ? 'categoria' then nullif(p_data->>'categoria','') else categoria end,
    centro_custo    = case when p_data ? 'centro_custo' then nullif(p_data->>'centro_custo','') else centro_custo end,
    forma_pagamento = case when p_data ? 'forma_pagamento' then nullif(p_data->>'forma_pagamento','') else forma_pagamento end,
    nf_emitida      = coalesce((p_data->>'nf_emitida')::boolean, nf_emitida),
    boleto_gerado   = coalesce((p_data->>'boleto_gerado')::boolean, boleto_gerado),
    updated_at      = now()
  where id = any(p_ids)
    and situacao not in ('pago','recebido')
    and coalesce(valor_realizado, 0) = 0;
  get diagnostics v_atualizados = row_count;

  return jsonb_build_object(
    'atualizados', v_atualizados, 'bloqueados', v_bloqueados, 'total', v_total);
end $$;

grant execute on function update_lancamentos_lote(uuid, uuid[], jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
