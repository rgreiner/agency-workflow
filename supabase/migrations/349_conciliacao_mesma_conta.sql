-- Conciliação só casa lançamento e movimento da MESMA conta.
--
-- O formulário "Criar lançamento" da conciliação deixa escolher a conta à mão, e
-- nada conferia: um lançamento da Cresol conciliado com um movimento do BTG
-- some do saldo do BTG (que o banco confirmou) e aparece no da Cresol. Medido em
-- 14/10/2026: nenhum caso ainda — é trava antes do primeiro.
-- Lançamento sem conta herda a do movimento.
--
-- Corpo = o que estava no ar (mig. 345) + as duas checagens.

create or replace function public.conciliar_btg_multi(p_user_id uuid, p_movement_id uuid, p_itens jsonb, p_modo text DEFAULT 'manual'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m record; l record; v_sum numeric := 0; v_count int; v_saldo numeric; v_coberto numeric; r record;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into m from btg_movements where id = p_movement_id;
  if not found then raise exception 'Movimento não encontrado'; end if;
  if not exists (
    select 1 from organization_members
    where org_id = m.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  if m.status = 'conciliado' then raise exception 'Movimento já conciliado'; end if;

  v_count := coalesce(jsonb_array_length(p_itens), 0);
  if v_count = 0 then raise exception 'Selecione ao menos um lançamento'; end if;

  select coalesce(sum((x->>'valor')::numeric), 0) into v_sum from jsonb_array_elements(p_itens) x;
  if abs(v_sum - m.valor) > 0.01 then
    raise exception 'A soma dos lançamentos (R$ %) não confere com o movimento (R$ %)', v_sum, m.valor;
  end if;

  for r in
    select (x->>'lancamento_id')::uuid as lanc,
           (x->>'valor')::numeric      as valor,
           coalesce(nullif(x->>'juros',    '')::numeric, 0) as juros,
           coalesce(nullif(x->>'multa',    '')::numeric, 0) as multa,
           coalesce(nullif(x->>'desconto', '')::numeric, 0) as desconto,
           coalesce(nullif(x->>'tarifa',   '')::numeric, 0) as tarifa,
           (x ?| array['juros','multa','desconto','tarifa'])  as tem_encargo
      from jsonb_array_elements(p_itens) x
  loop
    select * into l from lancamentos where id = r.lanc and org_id = m.org_id;
    if not found then raise exception 'Lançamento não encontrado'; end if;
    if (m.tipo = 'credit' and l.tipo <> 'entrada') or (m.tipo = 'debit' and l.tipo <> 'saida') then
      raise exception 'Lançamento com natureza incompatível com o movimento';
    end if;
    -- Mesma conta do movimento: lançamento de outra conta conciliado aqui deixaria
    -- o dinheiro fora do saldo desta conta (e dentro do saldo da outra).
    if l.conta_id is not null and m.conta_id is not null and l.conta_id <> m.conta_id then
      raise exception 'O lançamento "%" é da conta %, e o movimento é da conta %. Corrija a conta do lançamento antes de conciliar.',
        coalesce(l.contato_nome, l.descricao, '—'),
        (select nome from contas_financeiras where id = l.conta_id),
        (select nome from contas_financeiras where id = m.conta_id);
    end if;
    if r.valor <= 0 then raise exception 'Valor aplicado inválido'; end if;
    if r.juros < 0 or r.multa < 0 or r.desconto < 0 or r.tarifa < 0 then
      raise exception 'Encargo negativo — use juros/multa para o que entrou a mais e desconto/tarifa para o que entrou a menos';
    end if;

    select l.valor - coalesce((
      select sum(i.valor) from btg_conciliacao_itens i
      where i.lancamento_id = r.lanc and i.movement_id <> p_movement_id
    ), 0) into v_saldo;

    v_coberto := r.valor + r.desconto + r.tarifa - r.juros - r.multa;
    if v_coberto > v_saldo + 0.01 then
      raise exception 'Valor aplicado (R$ %) maior que o saldo do lançamento (R$ %) — se a diferença for juros ou multa, declare o encargo',
        v_coberto, v_saldo;
    end if;

    if r.tem_encargo then
      update lancamentos
         set juros = r.juros, multa = r.multa, desconto = r.desconto, tarifa = r.tarifa, updated_at = now()
       where id = r.lanc;
    end if;

    -- Sem conta, herda a do movimento: é nela que o dinheiro passou.
    if l.conta_id is null and m.conta_id is not null then
      update lancamentos set conta_id = m.conta_id, updated_at = now() where id = r.lanc;
    end if;

    insert into btg_conciliacao_itens (org_id, movement_id, lancamento_id, valor, created_by)
      values (m.org_id, p_movement_id, r.lanc, r.valor, p_user_id)
      on conflict (movement_id, lancamento_id) do update set valor = excluded.valor;
    perform _recompute_lanc_conciliacao(r.lanc);
    -- Ficou meio-pago? Vira pago + saldo em aberto (mig. 345).
    perform _desmembrar_parcial(r.lanc);
  end loop;

  update btg_movements set
    status = 'conciliado',
    conciliado_modo = case when p_modo = 'auto' then 'auto' else 'manual' end,
    conciliado_em = now(),
    conciliado_por = p_user_id,
    lancamento_id = case when v_count = 1 then (p_itens->0->>'lancamento_id')::uuid else null end,
    updated_at = now()
  where id = p_movement_id;
end $function$;

revoke execute on function conciliar_btg_multi(uuid, uuid, jsonb, text) from public, anon;
grant execute on function conciliar_btg_multi(uuid, uuid, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
