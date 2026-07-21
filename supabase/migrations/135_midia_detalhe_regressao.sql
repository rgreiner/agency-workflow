-- 135_midia_detalhe_regressao.sql
-- REGRESSÃO: a mídia parou de gravar o `detalhe`.
--
-- As migrations 042/048 gravavam `midias.detalhe`. A 115 (doc_series) recriou
-- `create_midia` e `update_midia` para numerar por série e, no caminho, deixou o
-- detalhe de fora das duas — manteve no `create_producao` (por isso PP/FEE
-- funcionam e a MX não). Desde então TUDO que mora no jsonb da mídia externa era
-- descartado em silêncio: bisemana, período, mês/ano, espécie, negociação,
-- localizações e os campos de PRODUÇÃO.
--
-- Medido em produção antes do fix: a única MX gravada tinha todas as colunas
-- preenchidas e `detalhe = {}`. O usuário chegou a escrever "Bi semana 32" no
-- TÍTULO porque o campo não colava.
--
-- Efeito colateral importante: a comissão da produção (migration 132) lê
-- `detalhe->>'producao_valor'` — ela nunca teve o que ler. Só passa a funcionar
-- depois deste fix.
--
-- Base: as definições VIVAS em produção (pg_get_functiondef), não as do repo —
-- assim a numeração por série da 115 é preservada; só o detalhe volta.
-- Mesma assinatura, então `create or replace` basta (sem risco de overload).
-- Idempotente.

create or replace function create_midia(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_numero integer; v_tipo text; v_serie text;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  v_tipo  := nullif(p_data->>'tipo','');
  v_serie := serie_de_midia(v_tipo, p_data->>'serie');
  if v_serie is not null then
    v_numero := next_doc_numero(p_org_id, v_serie);
  else
    v_numero := null;
  end if;

  insert into midias (
    org_id, numero, serie, workspace_id, campaign_id, veiculo_id, tipo, titulo, emissao, job,
    aut_veiculo, codigo_identificador, nota_fiscal, pecas, praca, abrangencia,
    valor, desconto_pct, faturamento, prazo, data_base, dias_agencia,
    primeira_veiculacao, ultima_veiculacao, contato, responsavel_id, situacao,
    observacao, texto_legal, detalhe, created_by
  ) values (
    p_org_id, v_numero, v_serie,
    (p_data->>'workspace_id')::uuid,
    nullif(p_data->>'campaign_id','')::uuid,
    (p_data->>'veiculo_id')::uuid,
    v_tipo,
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
    coalesce(p_data->'detalhe', '{}'::jsonb),          -- <<< voltou
    p_user_id
  ) returning id into v_id;
  return v_id;
end; $$;

create or replace function update_midia(p_user_id uuid, p_midia_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_serie_atual text; v_num_atual integer; v_novo_tipo text; v_nova_serie text; v_num integer;
begin
  select org_id, serie, numero into v_org, v_serie_atual, v_num_atual
    from midias m where m.id = p_midia_id;
  if not exists (
    select 1 from organization_members om
    where om.org_id = v_org and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  v_novo_tipo  := nullif(p_data->>'tipo','');
  v_nova_serie := serie_de_midia(v_novo_tipo, coalesce(p_data->>'serie', v_serie_atual));
  -- Queima número novo quando ainda não tinha (rascunho classificado agora) OU
  -- quando a série mudou (reclassificação): o número tem que pertencer à sua série.
  if v_nova_serie is not null and (v_num_atual is null or v_nova_serie is distinct from v_serie_atual) then
    v_num := next_doc_numero(v_org, v_nova_serie);
  else
    v_num := v_num_atual;
  end if;

  update midias set
    numero               = v_num,
    serie                = coalesce(v_nova_serie, serie),
    workspace_id         = coalesce(nullif(p_data->>'workspace_id','')::uuid, workspace_id),
    campaign_id          = nullif(p_data->>'campaign_id','')::uuid,
    veiculo_id           = coalesce(nullif(p_data->>'veiculo_id','')::uuid, veiculo_id),
    tipo                 = v_novo_tipo,
    titulo               = coalesce(nullif(p_data->>'titulo',''), titulo),
    emissao              = nullif(p_data->>'emissao','')::date,
    job                  = nullif(p_data->>'job',''),
    aut_veiculo          = nullif(p_data->>'aut_veiculo',''),
    codigo_identificador = nullif(p_data->>'codigo_identificador',''),
    nota_fiscal          = nullif(p_data->>'nota_fiscal',''),
    pecas                = nullif(p_data->>'pecas',''),
    praca                = nullif(p_data->>'praca',''),
    abrangencia          = nullif(p_data->>'abrangencia',''),
    valor                = coalesce(nullif(p_data->>'valor','')::numeric, 0),
    desconto_pct         = coalesce(nullif(p_data->>'desconto_pct','')::numeric, 20),
    faturamento          = nullif(p_data->>'faturamento',''),
    prazo                = nullif(p_data->>'prazo',''),
    data_base            = nullif(p_data->>'data_base','')::date,
    dias_agencia         = coalesce(nullif(p_data->>'dias_agencia','')::int, 7),
    primeira_veiculacao  = nullif(p_data->>'primeira_veiculacao','')::date,
    ultima_veiculacao    = nullif(p_data->>'ultima_veiculacao','')::date,
    contato              = nullif(p_data->>'contato',''),
    responsavel_id       = nullif(p_data->>'responsavel_id','')::uuid,
    situacao             = coalesce(nullif(p_data->>'situacao',''), situacao),
    observacao           = nullif(p_data->>'observacao',''),
    texto_legal          = nullif(p_data->>'texto_legal',''),
    -- Sem `detalhe` no payload, mantém o que já estava (não zera).
    detalhe              = coalesce(p_data->'detalhe', detalhe),   -- <<< voltou
    updated_at           = now()
  where id = p_midia_id;
end; $$;

grant execute on function create_midia(uuid, uuid, jsonb) to anon, authenticated;
grant execute on function update_midia(uuid, uuid, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
