-- 099_fee_conferencia_faturamento.sql
-- Reverte o atalho do 083: o Fee NÃO fatura mais direto ao ser aprovado.
-- Novo fluxo (igual ao Pedido): Fee 'aprovado' aparece em Financeiro → Faturamento
-- pro Financeiro conferir e clicar "Gerar lançamentos" (que marca 'faturado' e é o
-- único ponto que gera os lançamentos). Além disso, trava aprovar um Fee sem
-- parcelas (senão ele chegaria no Faturamento sem nada pra lançar). Idempotente.

-- 1) Geração volta a ser uniforme: só gera em 'faturado' (p/ qualquer tipo).
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

  -- Todos os tipos (inclusive fee) só geram lançamentos ao chegar em 'faturado'.
  if p.situacao <> 'faturado' then return; end if;

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

-- 2) create/update_producao NÃO disparam mais geração pra fee (o 083 fazia isso).
--    Agora só o Faturamento → set_producao_situacao('faturado') gera. Idempotente.
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
end; $$;

grant execute on function create_producao(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function update_producao(uuid,uuid,jsonb) to anon, authenticated;

-- 3) set_producao_situacao: trava o Fee de avançar pra aprovado/faturado sem parcelas
--    (é o que vira o faturamento). Continua gerando lançamentos ao chegar em 'faturado'.
create or replace function set_producao_situacao(p_user_id uuid, p_producao_id uuid, p_situacao text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from producao p join organization_members om on om.org_id = p.org_id
    where p.id = p_producao_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  if p_situacao in ('aprovado','faturado') and exists (
    select 1 from producao where id = p_producao_id and tipo = 'fee'
      and jsonb_array_length(coalesce(detalhe->'parcelas','[]'::jsonb)) = 0
  ) then raise exception 'Gere as parcelas do Fee antes de aprovar (é o que vira o faturamento).'; end if;

  update producao set situacao = p_situacao, updated_at = now() where id = p_producao_id;
  perform gerar_lancamentos_producao(p_producao_id);
end; $$;

grant execute on function set_producao_situacao(uuid,uuid,text) to anon, authenticated;

notify pgrst, 'reload schema';
