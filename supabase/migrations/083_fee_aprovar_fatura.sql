-- 083_fee_aprovar_fatura.sql
-- Fee: aprovar já dispara o faturamento. Antes os lançamentos do fee só eram
-- gerados no estado 'faturado' (como pedido/proposta). Agora, para tipo='fee',
-- geram-se ao chegar em 'aprovado' (ou 'faturado', p/ compatibilidade). Os
-- demais tipos seguem exigindo 'faturado'. Idempotente.

create or replace function gerar_lancamentos_producao(p_producao_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p record; forn_nome text; parc jsonb;
  v_tipo text; v_ct text; v_cn text; v_desc text;
begin
  select pr.*, w.name as cliente_nome into p
    from producao pr join workspaces w on w.id = pr.workspace_id
    where pr.id = p_producao_id;
  if not found then return; end if;
  if p.tipo not in ('pedido', 'fee', 'proposta') then return; end if;

  -- Não mexe se já houver parcela recebida/paga (evita apagar histórico).
  if exists (
    select 1 from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id and situacao in ('recebido','pago')
  ) then return; end if;

  delete from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id;

  -- Fee fatura ao aprovar; os demais só em 'faturado'.
  if p.tipo = 'fee' then
    if p.situacao not in ('aprovado', 'faturado') then return; end if;
  else
    if p.situacao <> 'faturado' then return; end if;
  end if;

  select name into forn_nome from fornecedores where id = nullif(p.detalhe->>'fornecedor_id','')::uuid;

  for parc in select * from jsonb_array_elements(coalesce(p.detalhe->'parcelas', '[]'::jsonb)) loop
    v_tipo := parc->>'tipo';
    if v_tipo = 'receber_bv' then
      v_ct := 'fornecedor'; v_cn := coalesce(forn_nome, 'Fornecedor'); v_desc := 'Comissão BV';
    elsif v_tipo = 'receber_honorarios' then
      v_ct := 'cliente'; v_cn := p.cliente_nome; v_desc := 'Honorários';
    elsif v_tipo = 'receber_cliente' then
      v_ct := 'cliente'; v_cn := p.cliente_nome; v_desc := coalesce(nullif(p.titulo,''), case when p.tipo='fee' then 'Fee' else 'Proposta' end);
    else
      continue;
    end if;
    insert into lancamentos (
      org_id, tipo, origem_tipo, origem_id, contato_tipo, contato_nome,
      descricao, valor, vencimento, competencia, situacao, created_by
    ) values (
      p.org_id, 'entrada', 'producao', p_producao_id, v_ct, v_cn,
      v_desc, coalesce(nullif(parc->>'valor','')::numeric, 0), nullif(parc->>'vencimento','')::date,
      nullif(parc->>'vencimento','')::date, 'em_aberto', p.created_by
    );
  end loop;
end; $$;

grant execute on function gerar_lancamentos_producao(uuid) to anon, authenticated;

-- create/update_producao passam a disparar a geração de lançamentos SÓ para fee
-- (os demais tipos continuam faturando pelo dropdown/set_producao_situacao). Assim
-- "Aprovar e faturar" no form do fee já gera as parcelas, e editar um fee aprovado
-- ressincroniza (a função preserva parcelas já recebidas/pagas). Idempotente.
create or replace function create_producao(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_numero integer; v_tipo text;
begin
  if not exists (select 1 from organization_members where org_id=p_org_id and user_id=p_user_id and role in ('owner','admin','manager'))
  then raise exception 'Acesso negado'; end if;
  v_tipo := coalesce(nullif(p_data->>'tipo',''), 'orcamento');
  select coalesce(max(numero),0)+1 into v_numero from producao where org_id=p_org_id and tipo=v_tipo;
  insert into producao (org_id, numero, tipo, workspace_id, campaign_id, titulo, faturar, emissao, validade_dias,
    bv_pct, honorarios_pct, valor, codigo_identificador, nota_fiscal, situacao, observacao, texto_legal, contato, responsavel_id, detalhe, created_by)
  values (p_org_id, v_numero, v_tipo, (p_data->>'workspace_id')::uuid, nullif(p_data->>'campaign_id','')::uuid,
    coalesce(nullif(p_data->>'titulo',''),'(sem título)'), nullif(p_data->>'faturar',''), nullif(p_data->>'emissao','')::date,
    nullif(p_data->>'validade_dias','')::int, coalesce(nullif(p_data->>'bv_pct','')::numeric,15), coalesce(nullif(p_data->>'honorarios_pct','')::numeric,0),
    coalesce(nullif(p_data->>'valor','')::numeric,0), nullif(p_data->>'codigo_identificador',''), nullif(p_data->>'nota_fiscal',''),
    coalesce(nullif(p_data->>'situacao',''),'em_aberto'), nullif(p_data->>'observacao',''), nullif(p_data->>'texto_legal',''),
    nullif(p_data->>'contato',''), nullif(p_data->>'responsavel_id','')::uuid, coalesce(p_data->'detalhe','{}'::jsonb), p_user_id)
  returning id into v_id;
  if v_tipo = 'fee' then perform gerar_lancamentos_producao(v_id); end if;
  return v_id;
end; $$;

create or replace function update_producao(p_user_id uuid, p_producao_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from producao p join organization_members om on om.org_id=p.org_id where p.id=p_producao_id and om.user_id=p_user_id and om.role in ('owner','admin','manager'))
  then raise exception 'Acesso negado'; end if;
  update producao set
    workspace_id=coalesce(nullif(p_data->>'workspace_id','')::uuid, workspace_id),
    campaign_id=nullif(p_data->>'campaign_id','')::uuid,
    titulo=coalesce(nullif(p_data->>'titulo',''), titulo),
    faturar=nullif(p_data->>'faturar',''),
    emissao=nullif(p_data->>'emissao','')::date,
    validade_dias=nullif(p_data->>'validade_dias','')::int,
    bv_pct=coalesce(nullif(p_data->>'bv_pct','')::numeric,15),
    honorarios_pct=coalesce(nullif(p_data->>'honorarios_pct','')::numeric,0),
    valor=coalesce(nullif(p_data->>'valor','')::numeric,0),
    codigo_identificador=nullif(p_data->>'codigo_identificador',''),
    nota_fiscal=nullif(p_data->>'nota_fiscal',''),
    situacao=coalesce(nullif(p_data->>'situacao',''), situacao),
    observacao=nullif(p_data->>'observacao',''),
    texto_legal=nullif(p_data->>'texto_legal',''),
    contato=nullif(p_data->>'contato',''),
    responsavel_id=nullif(p_data->>'responsavel_id','')::uuid,
    detalhe=coalesce(p_data->'detalhe', detalhe),
    updated_at=now()
  where id=p_producao_id;
  if (select tipo from producao where id=p_producao_id) = 'fee' then
    perform gerar_lancamentos_producao(p_producao_id);
  end if;
end; $$;

grant execute on function create_producao(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function update_producao(uuid,uuid,jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
