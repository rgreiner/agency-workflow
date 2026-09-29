-- ── Item do cupom que NÃO é da empresa ──────────────────────────────────────
--
-- 29/09/2026, regra do Rafael: quem compra para o escritório às vezes leva as
-- próprias coisas na mesma nota, e a empresa reembolsa só a parte dela. Foi o
-- que a leitura do cupom de 21/09 mostrou: 29 itens somando R$ 201,01 num
-- lançamento de R$ 93,48 — a diferença é compra pessoal, não erro de leitura.
--
-- Sem esta coluna, o café e a fruta da pessoa entrariam na série de consumo da
-- agência e toda a análise de desperdício sairia inflada.
--
-- Default TRUE: o normal é ser da empresa; desmarcar é a exceção.
alter table lancamento_item add column if not exists empresa boolean not null default true;

-- A conferência passa a ser "soma dos itens DA EMPRESA × valor do lançamento".
comment on column lancamento_item.empresa is
  'false = item pessoal de quem comprou; fica listado para conferir contra o papel, mas fica FORA da soma e da análise de consumo.';

-- Mesma assinatura (PostgREST é estrito: 1 por RPC) — só passa a ler `empresa`.
create or replace function set_lancamento_itens(p_user_id uuid, p_lancamento_id uuid, p_itens jsonb)
 returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; it jsonb; v_prod uuid; i int := 0;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select org_id into v_org from lancamentos where id = p_lancamento_id;
  if v_org is null then raise exception 'Lançamento não encontrado'; end if;
  if not fin_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  delete from lancamento_item where lancamento_id = p_lancamento_id;

  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    v_prod := null;
    -- Item pessoal não vira produto do cadastro: o cadastro é o vocabulário de
    -- consumo DA AGÊNCIA, e sujá-lo com a compra de alguém não se desfaz.
    if coalesce(btrim(it->>'produto'), '') <> '' and coalesce(it->>'empresa', 'true') <> 'false' then
      insert into finance_produto (org_id, nome, unidade)
      values (v_org, btrim(it->>'produto'), nullif(btrim(coalesce(it->>'unidade','')), ''))
      on conflict (org_id, lower(nome)) do update set ativo = true
      returning id into v_prod;
    end if;

    insert into lancamento_item (org_id, lancamento_id, produto_id, descricao, quantidade,
                                 unidade, valor_unitario, valor_total, ordem, origem, empresa)
    values (
      v_org, p_lancamento_id, v_prod,
      coalesce(nullif(btrim(coalesce(it->>'descricao','')), ''), 'Item'),
      nullif(it->>'quantidade','')::numeric,
      nullif(btrim(coalesce(it->>'unidade','')), ''),
      nullif(it->>'valor_unitario','')::numeric,
      coalesce(nullif(it->>'valor_total','')::numeric, 0),
      i,
      case when coalesce(it->>'origem','ia') = 'manual' then 'manual' else 'ia' end,
      coalesce(it->>'empresa', 'true') <> 'false'
    );
    i := i + 1;
  end loop;
end; $$;

revoke execute on function set_lancamento_itens(uuid, uuid, jsonb) from public, anon;
grant  execute on function set_lancamento_itens(uuid, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
