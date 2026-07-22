-- 143_rls_auth_uid_guard.sql
-- SEGURANÇA (P0 da auditoria 22/07/2026): fecha o bypass de autorização.
-- As RPCs SECURITY DEFINER verificavam permissão contra o PARÂMETRO p_user_id,
-- nunca contra auth.uid() (o sub do JWT que o PostgREST valida). Como o browser
-- fala com o PostgREST autenticado e as funções tinham grant to authenticated,
-- qualquer membro trocava p_user_id no console e se passava por um admin
-- (controle do Financeiro, auto-promoção a owner, ataque cross-tenant).
--
-- Fix: guard no topo de cada função — p_user_id TEM que ser o próprio chamador.
-- Chamada legítima (server action manda o mesmo flow-jwt) passa; forjada quebra.
-- + revoke execute from anon (nenhuma destas é chamada em contexto anon; o cron
--   só toca funções sem p_user_id).
-- GERADO a partir das definições VIVAS do banco (pg_get_functiondef) — corpo
-- preservado byte-a-byte, só o guard injetado após o primeiro begin. Idempotente
-- (create or replace; rodar de novo não duplica o guard).
--
-- Funções cobertas: 119.

-- accept_invite_link
CREATE OR REPLACE FUNCTION public.accept_invite_link(p_user_id uuid, p_token uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_link org_invite_links%ROWTYPE; v_slug text; v_exists boolean;
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  SELECT * INTO v_link FROM org_invite_links WHERE token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link não encontrado'; END IF;
  IF NOT v_link.is_active THEN RAISE EXCEPTION 'Link inativo'; END IF;
  SELECT slug INTO v_slug FROM organizations WHERE id = v_link.org_id;
  SELECT EXISTS (SELECT 1 FROM organization_members WHERE org_id = v_link.org_id AND user_id = p_user_id) INTO v_exists;
  IF v_exists THEN RETURN v_slug; END IF;
  INSERT INTO organization_members (org_id, user_id, role, invited_by) VALUES (v_link.org_id, p_user_id, v_link.role, v_link.created_by);
  UPDATE org_invite_links SET use_count = use_count + 1 WHERE id = v_link.id;
  RETURN v_slug;
END;
$function$;

-- add_activity_comment
CREATE OR REPLACE FUNCTION public.add_activity_comment(p_user_id uuid, p_activity_id uuid, p_content text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where a.id = p_activity_id and m.user_id = p_user_id
  ) then
    raise exception 'Acesso negado';
  end if;

  insert into activity_comments (activity_id, user_id, content)
  values (p_activity_id, p_user_id, p_content)
  returning id into v_id;

  return v_id;
end;
$function$;

-- add_comment_with_mentions
CREATE OR REPLACE FUNCTION public.add_comment_with_mentions(p_user_id uuid, p_activity_id uuid, p_content text, p_mention_ids uuid[] DEFAULT '{}'::uuid[], p_mention_all boolean DEFAULT false, p_reply_to uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_org uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select w.org_id into v_org
  from activities a
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  join organization_members m on m.org_id = w.org_id
  where a.id = p_activity_id and m.user_id = p_user_id;
  if v_org is null then raise exception 'Acesso negado'; end if;

  insert into activity_comments (activity_id, user_id, content, reply_to)
  values (p_activity_id, p_user_id, p_content, p_reply_to)
  returning id into v_id;

  if p_mention_all then
    insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
    select om.user_id, v_org, 'mention', p_activity_id, p_user_id,
           jsonb_build_object('preview', left(p_content, 120), 'all', true)
    from organization_members om
    where om.org_id = v_org and om.user_id is distinct from p_user_id;
  elsif p_mention_ids is not null and array_length(p_mention_ids, 1) > 0 then
    insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
    select distinct uid, v_org, 'mention', p_activity_id, p_user_id,
           jsonb_build_object('preview', left(p_content, 120))
    from unnest(p_mention_ids) uid
    where uid is distinct from p_user_id
      and exists (select 1 from organization_members om where om.org_id = v_org and om.user_id = uid);
  end if;

  return v_id;
end; $function$;

-- clear_extrato
CREATE OR REPLACE FUNCTION public.clear_extrato(p_user_id uuid, p_org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;
  delete from extrato_importado where org_id = p_org_id;
end; $function$;

-- conciliar_btg_movimento
CREATE OR REPLACE FUNCTION public.conciliar_btg_movimento(p_user_id uuid, p_movement_id uuid, p_lancamento_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m record;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into m from btg_movements where id = p_movement_id;
  if not found then raise exception 'Movimento não encontrado'; end if;
  perform conciliar_btg_multi(
    p_user_id, p_movement_id,
    jsonb_build_array(jsonb_build_object('lancamento_id', p_lancamento_id, 'valor', m.valor)),
    'manual'
  );
end; $function$;

-- conciliar_btg_multi
CREATE OR REPLACE FUNCTION public.conciliar_btg_multi(p_user_id uuid, p_movement_id uuid, p_itens jsonb, p_modo text DEFAULT 'manual'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m record; l record; v_sum numeric := 0; v_count int; v_saldo numeric; r record;
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

  for r in select (x->>'lancamento_id')::uuid as lanc, (x->>'valor')::numeric as valor
           from jsonb_array_elements(p_itens) x loop
    select * into l from lancamentos where id = r.lanc and org_id = m.org_id;
    if not found then raise exception 'Lançamento não encontrado'; end if;
    if (m.tipo = 'credit' and l.tipo <> 'entrada') or (m.tipo = 'debit' and l.tipo <> 'saida') then
      raise exception 'Lançamento com natureza incompatível com o movimento';
    end if;
    if r.valor <= 0 then raise exception 'Valor aplicado inválido'; end if;
    -- saldo do lançamento desconsiderando este movimento (permite reconciliar/atualizar)
    select l.valor - coalesce((
      select sum(i.valor) from btg_conciliacao_itens i
      where i.lancamento_id = r.lanc and i.movement_id <> p_movement_id
    ), 0) into v_saldo;
    if r.valor > v_saldo + 0.01 then raise exception 'Valor aplicado maior que o saldo do lançamento'; end if;

    insert into btg_conciliacao_itens (org_id, movement_id, lancamento_id, valor, created_by)
      values (m.org_id, p_movement_id, r.lanc, r.valor, p_user_id)
      on conflict (movement_id, lancamento_id) do update set valor = excluded.valor;
    perform _recompute_lanc_conciliacao(r.lanc);
  end loop;

  update btg_movements set
    status = 'conciliado',
    conciliado_modo = case when p_modo = 'auto' then 'auto' else 'manual' end,
    conciliado_em = now(),
    conciliado_por = p_user_id,
    lancamento_id = case when v_count = 1 then (p_itens->0->>'lancamento_id')::uuid else null end,
    updated_at = now()
  where id = p_movement_id;
end; $function$;

-- concluir_orcamento
CREATE OR REPLACE FUNCTION public.concluir_orcamento(p_user_id uuid, p_orcamento_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o record;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into o from producao where id = p_orcamento_id;
  if not found then raise exception 'Orçamento não encontrado'; end if;
  if o.tipo <> 'orcamento' then raise exception 'Este documento não é um orçamento'; end if;
  if not exists (
    select 1 from organization_members
    where org_id = o.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  update producao set situacao = 'concluido', updated_at = now() where id = p_orcamento_id;
end; $function$;

-- create_activity
CREATE OR REPLACE FUNCTION public.create_activity(p_user_id uuid, p_campaign_id uuid, p_title text, p_description text DEFAULT ''::text, p_status text DEFAULT 'briefing'::text, p_priority text DEFAULT 'medium'::text, p_complexity text DEFAULT 'medium'::text, p_due_date date DEFAULT NULL::date, p_estimated_hours numeric DEFAULT NULL::numeric, p_start_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  -- Verifica se o usuário tem acesso à campanha
  IF NOT EXISTS (
    SELECT 1 FROM campaigns c
    JOIN workspaces w ON w.id = c.workspace_id
    JOIN organization_members m ON m.org_id = w.org_id
    WHERE c.id = p_campaign_id AND m.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  INSERT INTO activities (
    campaign_id, title, description, status,
    priority, complexity, due_date, estimated_hours,
    start_date, created_by
  ) VALUES (
    p_campaign_id, p_title, p_description, p_status::activity_status,
    p_priority::activity_priority, p_complexity::activity_complexity,
    p_due_date, p_estimated_hours, p_start_date, p_user_id
  )
  RETURNING id INTO v_id;

  -- Registra no histórico
  INSERT INTO activity_history (activity_id, changed_by, to_status)
  VALUES (v_id, p_user_id, p_status::activity_status);

  RETURN v_id;
END;
$function$;

-- create_campaign
CREATE OR REPLACE FUNCTION public.create_campaign(p_user_id uuid, p_workspace_id uuid, p_name text, p_description text, p_start_date date, p_end_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from workspaces w
    join organization_members m on m.org_id = w.org_id
    where w.id = p_workspace_id and m.user_id = p_user_id
  ) then
    raise exception 'Acesso negado';
  end if;
  insert into campaigns (workspace_id, name, description, start_date, end_date, created_by)
  values (p_workspace_id, p_name, nullif(p_description,''), p_start_date, p_end_date, p_user_id)
  returning id into v_id;
  return v_id;
end;
$function$;

-- create_conta_financeira
CREATE OR REPLACE FUNCTION public.create_conta_financeira(p_user_id uuid, p_org_id uuid, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  insert into contas_financeiras (org_id, nome, tipo, saldo_inicial, cor, ativo, ordem, created_by)
  values (
    p_org_id,
    coalesce(nullif(p_data->>'nome',''), 'Conta'),
    coalesce(nullif(p_data->>'tipo',''), 'banco'),
    coalesce(nullif(p_data->>'saldo_inicial','')::numeric, 0),
    nullif(p_data->>'cor',''),
    coalesce((p_data->>'ativo')::boolean, true),
    coalesce(nullif(p_data->>'ordem','')::int, 0),
    p_user_id
  ) returning id into v_id;
  return v_id;
end; $function$;

-- create_document
CREATE OR REPLACE FUNCTION public.create_document(p_user_id uuid, p_org_id uuid, p_workspace_id uuid, p_parent_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_user_id)
  then raise exception 'Acesso negado'; end if;
  insert into documents (org_id, workspace_id, parent_id, title, content, visibility, created_by)
  values (p_org_id, p_workspace_id, p_parent_id, 'Sem título', '{"type":"doc","content":[]}'::jsonb, 'org', p_user_id)
  returning id into v_id;
  return v_id;
end; $function$;

-- create_folder
CREATE OR REPLACE FUNCTION public.create_folder(p_user_id uuid, p_org_id uuid, p_workspace_id uuid, p_name text, p_parent_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_user_id)
  then raise exception 'Acesso negado'; end if;
  insert into documents (org_id, workspace_id, parent_id, title, content, visibility, created_by, is_folder)
  values (p_org_id, p_workspace_id, p_parent_id,
          coalesce(nullif(trim(p_name), ''), 'Nova pasta'),
          '{"type":"doc","content":[]}'::jsonb, 'org', p_user_id, true)
  returning id into v_id;
  return v_id;
end; $function$;

-- create_fornecedor
CREATE OR REPLACE FUNCTION public.create_fornecedor(p_user_id uuid, p_org_id uuid, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from organization_members where org_id=p_org_id and user_id=p_user_id
    and (role in ('owner','admin','manager') or can_vendas))
  then raise exception 'Acesso negado'; end if;
  insert into fornecedores (org_id, name, tipo, tax_id, notes, enderecos, telefones, emails, contas_bancarias, created_by)
  values (p_org_id, coalesce(nullif(p_data->>'name',''),'(sem nome)'), nullif(p_data->>'tipo',''), nullif(p_data->>'tax_id',''), nullif(p_data->>'notes',''),
    coalesce(p_data->'enderecos','[]'::jsonb), coalesce(p_data->'telefones','[]'::jsonb), coalesce(p_data->'emails','[]'::jsonb), coalesce(p_data->'contas_bancarias','[]'::jsonb), p_user_id)
  returning id into v_id;
  return v_id;
end; $function$;

-- create_lancamento
CREATE OR REPLACE FUNCTION public.create_lancamento(p_user_id uuid, p_org_id uuid, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
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
end; $function$;

-- create_lancamentos_serie
CREATE OR REPLACE FUNCTION public.create_lancamentos_serie(p_user_id uuid, p_org_id uuid, p_data jsonb, p_modo text, p_n integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_grupo uuid := uuid_generate_v4();
  v_total numeric(14,2) := coalesce(nullif(p_data->>'valor','')::numeric, 0);
  v_venc date := nullif(p_data->>'vencimento','')::date;
  v_comp date := coalesce(nullif(p_data->>'competencia','')::date, nullif(p_data->>'vencimento','')::date);
  v_n int := greatest(coalesce(p_n, 1), 1);
  v_parc numeric(14,2) := 0;
  v_acc numeric(14,2) := 0;
  v_val numeric(14,2);
  v_desc text := nullif(p_data->>'descricao','');
  i int;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  if p_modo = 'parcelado' then v_parc := round(v_total / v_n, 2); end if;

  for i in 1..v_n loop
    if p_modo = 'parcelado' then
      if i < v_n then v_val := v_parc; v_acc := v_acc + v_parc;
      else v_val := round(v_total - v_acc, 2); end if;   -- última parcela leva o resto
    else
      v_val := v_total;                                  -- recorrente: valor cheio por mês
    end if;

    insert into lancamentos (
      org_id, tipo, origem_tipo, contato_tipo, contato_nome, descricao, valor,
      vencimento, competencia, situacao, conta_id, categoria, centro_custo,
      forma_pagamento, observacao, recorrente, parcela_num, parcela_total, grupo_id, created_by
    ) values (
      p_org_id,
      coalesce(nullif(p_data->>'tipo',''), 'saida'),
      'manual',
      nullif(p_data->>'contato_tipo',''),
      nullif(p_data->>'contato_nome',''),
      case when p_modo = 'parcelado' then trim(coalesce(v_desc, '')) || ' (' || i || '/' || v_n || ')' else v_desc end,
      v_val,
      case when v_venc is not null then (v_venc + ((i - 1) * interval '1 month'))::date else null end,
      case when v_comp is not null then (v_comp + ((i - 1) * interval '1 month'))::date else null end,
      'em_aberto',
      nullif(p_data->>'conta_id','')::uuid,
      nullif(p_data->>'categoria',''),
      nullif(p_data->>'centro_custo',''),
      nullif(p_data->>'forma_pagamento',''),
      nullif(p_data->>'observacao',''),
      (p_modo = 'recorrente'),
      case when p_modo = 'parcelado' then i else null end,
      case when p_modo = 'parcelado' then v_n else null end,
      v_grupo,
      p_user_id
    );
  end loop;
end; $function$;

-- create_midia
CREATE OR REPLACE FUNCTION public.create_midia(p_user_id uuid, p_org_id uuid, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_numero integer; v_tipo text; v_serie text;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
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
end; $function$;

-- create_org_for_user
CREATE OR REPLACE FUNCTION public.create_org_for_user(p_user_id uuid, p_name text, p_slug text, p_type text, p_size text, p_segment text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  insert into organizations (name, slug, plan, max_members, company_type, company_size, segment)
  values (p_name, p_slug, 'free', 5, p_type, p_size, p_segment)
  returning id into v_org_id;

  insert into organization_members (org_id, user_id, role)
  values (v_org_id, p_user_id, 'owner');

  return v_org_id;
end;
$function$;

-- create_org_position
CREATE OR REPLACE FUNCTION public.create_org_position(p_user_id uuid, p_org_id uuid, p_name text, p_color text, p_allowed_statuses activity_status[], p_op_ver_tudo boolean DEFAULT false, p_op_midias boolean DEFAULT false, p_op_producao boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin')
  ) then raise exception 'Acesso negado'; end if;

  insert into org_positions (org_id, name, color, allowed_statuses, op_ver_tudo, op_midias, op_producao)
  values (p_org_id, p_name, p_color, p_allowed_statuses,
          coalesce(p_op_ver_tudo,false), coalesce(p_op_midias,false), coalesce(p_op_producao,false))
  returning id into v_id;
  return v_id;
end; $function$;

-- create_producao
CREATE OR REPLACE FUNCTION public.create_producao(p_user_id uuid, p_org_id uuid, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_numero integer; v_tipo text; v_serie text;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from organization_members where org_id=p_org_id and user_id=p_user_id and role in ('owner','admin','manager'))
  then raise exception 'Acesso negado'; end if;
  v_tipo := coalesce(nullif(p_data->>'tipo',''), 'orcamento');
  v_serie := serie_de_producao(v_tipo);

  if v_serie is not null then
    v_numero := next_doc_numero(p_org_id, v_serie);         -- PP / FEE / PR: contador da série
  else
    select coalesce(max(numero),0)+1 into v_numero          -- orçamento: numeração interna
      from producao where org_id=p_org_id and tipo=v_tipo;
  end if;

  insert into producao (org_id, numero, serie, tipo, workspace_id, campaign_id, titulo, faturar, emissao, validade_dias,
    bv_pct, honorarios_pct, valor, codigo_identificador, nota_fiscal, situacao, observacao, texto_legal, contato, responsavel_id,
    detalhe, origem_orcamento_id, created_by)
  values (p_org_id, v_numero, v_serie, v_tipo, (p_data->>'workspace_id')::uuid, nullif(p_data->>'campaign_id','')::uuid,
    coalesce(nullif(p_data->>'titulo',''),'(sem título)'), nullif(p_data->>'faturar',''), nullif(p_data->>'emissao','')::date,
    nullif(p_data->>'validade_dias','')::int, coalesce(nullif(p_data->>'bv_pct','')::numeric,15), coalesce(nullif(p_data->>'honorarios_pct','')::numeric,0),
    coalesce(nullif(p_data->>'valor','')::numeric,0), nullif(p_data->>'codigo_identificador',''), nullif(p_data->>'nota_fiscal',''),
    coalesce(nullif(p_data->>'situacao',''),'em_aberto'), nullif(p_data->>'observacao',''), nullif(p_data->>'texto_legal',''),
    nullif(p_data->>'contato',''), nullif(p_data->>'responsavel_id','')::uuid, coalesce(p_data->'detalhe','{}'::jsonb),
    nullif(p_data->>'origem_orcamento_id','')::uuid, p_user_id)
  returning id into v_id;
  return v_id;
end; $function$;

-- create_veiculo
CREATE OR REPLACE FUNCTION public.create_veiculo(p_user_id uuid, p_org_id uuid, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from organization_members where org_id=p_org_id and user_id=p_user_id
    and (role in ('owner','admin','manager') or can_vendas))
  then raise exception 'Acesso negado'; end if;
  insert into veiculos (org_id, name, type, tax_id, commission_pct, notes, enderecos, telefones, emails, contas_bancarias, midia_kit_url, midia_kit_name, created_by)
  values (p_org_id, coalesce(nullif(p_data->>'name',''),'(sem nome)'), nullif(p_data->>'type',''), nullif(p_data->>'tax_id',''),
    coalesce(nullif(p_data->>'commission_pct','')::numeric,20), nullif(p_data->>'notes',''),
    coalesce(p_data->'enderecos','[]'::jsonb), coalesce(p_data->'telefones','[]'::jsonb), coalesce(p_data->'emails','[]'::jsonb), coalesce(p_data->'contas_bancarias','[]'::jsonb),
    nullif(p_data->>'midia_kit_url',''), nullif(p_data->>'midia_kit_name',''), p_user_id)
  returning id into v_id;
  return v_id;
end; $function$;

-- create_workspace
CREATE OR REPLACE FUNCTION public.create_workspace(p_user_id uuid, p_org_id uuid, p_name text, p_description text, p_color text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_user_id) then
    raise exception 'Acesso negado';
  end if;
  insert into workspaces (org_id, name, description, color, created_by)
  values (p_org_id, p_name, nullif(p_description,''), p_color, p_user_id)
  returning id into v_id;
  return v_id;
end;
$function$;

-- criar_transferencia
CREATE OR REPLACE FUNCTION public.criar_transferencia(p_user_id uuid, p_org_id uuid, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tid uuid := gen_random_uuid();
  v_origem uuid := nullif(p_data->>'conta_origem_id','')::uuid;
  v_destino uuid := nullif(p_data->>'conta_destino_id','')::uuid;
  v_val numeric := coalesce(nullif(p_data->>'valor','')::numeric, 0);
  v_data date := coalesce(nullif(p_data->>'data','')::date, current_date);
  v_desc text := nullif(p_data->>'descricao','');
  v_forma text := coalesce(nullif(p_data->>'forma_pagamento',''), 'transferencia');
  v_no text; v_nd text;  -- nomes das contas origem/destino
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  if v_origem is null or v_destino is null then raise exception 'Escolha a conta de origem e a de destino'; end if;
  if v_origem = v_destino then raise exception 'Origem e destino têm que ser contas diferentes'; end if;
  if v_val <= 0 then raise exception 'Informe um valor maior que zero'; end if;

  select nome into v_no from contas_financeiras where id = v_origem and org_id = p_org_id;
  select nome into v_nd from contas_financeiras where id = v_destino and org_id = p_org_id;
  if v_no is null or v_nd is null then raise exception 'Conta não encontrada nesta organização'; end if;

  -- Saída na conta de origem
  insert into lancamentos (
    org_id, tipo, origem_tipo, transferencia_id, contato_tipo, contato_nome,
    descricao, valor, valor_realizado, vencimento, competencia, data_liquidacao,
    situacao, conta_id, categoria, forma_pagamento, created_by
  ) values (
    p_org_id, 'saida', 'transferencia', v_tid, 'conta', v_nd,
    coalesce(v_desc, 'Transferência para ' || v_nd), v_val, v_val, v_data, v_data, v_data,
    'pago', v_origem, 'Transferência de Saída', v_forma, p_user_id
  );

  -- Entrada na conta de destino
  insert into lancamentos (
    org_id, tipo, origem_tipo, transferencia_id, contato_tipo, contato_nome,
    descricao, valor, valor_realizado, vencimento, competencia, data_liquidacao,
    situacao, conta_id, categoria, forma_pagamento, created_by
  ) values (
    p_org_id, 'entrada', 'transferencia', v_tid, 'conta', v_no,
    coalesce(v_desc, 'Transferência de ' || v_no), v_val, v_val, v_data, v_data, v_data,
    'recebido', v_destino, 'Transferência de Entrada', v_forma, p_user_id
  );

  return v_tid;
end; $function$;

-- dashboard_engajamento
CREATE OR REPLACE FUNCTION public.dashboard_engajamento(p_user_id uuid, p_org_id uuid, p_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb; v_role text; v_since timestamptz; v_days int;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select role into v_role from organization_members where org_id = p_org_id and user_id = p_user_id;
  if v_role is null or v_role <> 'owner' then raise exception 'Acesso negado'; end if;
  v_days := least(greatest(coalesce(p_days, 84), 7), 372);
  v_since := (current_date - (v_days - 1)) ::timestamptz;

  with ev as (
    select h.changed_by as uid, h.changed_at as ts, 'status' as kind
      from activity_history h
      join activities a on a.id = h.activity_id
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id
      where w.org_id = p_org_id and h.changed_at >= v_since and h.changed_by is not null
    union all
    select fh.changed_by, fh.changed_at, 'campo'
      from activity_field_history fh
      join activities a on a.id = fh.activity_id
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id
      where w.org_id = p_org_id and fh.changed_at >= v_since
    union all
    select cm.user_id, cm.created_at, 'comentario'
      from activity_comments cm
      join activities a on a.id = cm.activity_id
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id
      where w.org_id = p_org_id and cm.created_at >= v_since
    union all
    select r.user_id, r.created_at, 'reacao'
      from activity_comment_reactions r
      join activity_comments cm on cm.id = r.comment_id
      join activities a on a.id = cm.activity_id
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id
      where w.org_id = p_org_id and r.created_at >= v_since
  ),
  daily as (
    select uid, (ts at time zone 'America/Sao_Paulo')::date as day, count(*) as n
    from ev group by uid, (ts at time zone 'America/Sao_Paulo')::date
  ),
  tot as (select uid, kind, count(*) as n from ev group by uid, kind)
  select jsonb_build_object(
    'since', (current_date - (v_days - 1)),
    'until', current_date,
    'days',  v_days,
    -- Todo membro da org entra; quem não interagiu vem com total 0 (e vai pro fim).
    'users', coalesce((select jsonb_agg(row_to_json(t) order by t.total desc, t.full_name) from (
        select om.user_id, p.full_name, p.avatar_url,
               (select count(*) from ev e where e.uid = om.user_id)::int as total,
               coalesce((select jsonb_object_agg(kind, n) from tot tb where tb.uid = om.user_id), '{}'::jsonb) as por_tipo
        from organization_members om
        join profiles p on p.id = om.user_id
        where om.org_id = p_org_id
      ) t), '[]'),
    'daily', coalesce((select jsonb_agg(row_to_json(t)) from
      (select uid as user_id, day, n from daily) t), '[]')
  ) into v;
  return v;
end $function$;

-- dashboard_financeiro
CREATE OR REPLACE FUNCTION public.dashboard_financeiro(p_user_id uuid, p_org_id uuid, p_mes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb; v_role text; v_mes date; v_fim date; v_dre_ini date;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select role into v_role from organization_members where org_id = p_org_id and user_id = p_user_id;
  if v_role is null or v_role <> 'owner' then raise exception 'Acesso negado'; end if;
  v_mes := (coalesce(nullif(p_mes, ''), to_char(current_date, 'YYYY-MM')) || '-01')::date;
  v_fim := (v_mes + interval '1 month')::date;
  v_dre_ini := (v_mes - interval '5 months')::date;

  with ex as (
    select tipo, situacao, categoria, valor, data_mov, data_prevista, venc_original
    from extrato_importado
    where org_id = p_org_id
      and coalesce(origem, '') <> 'Transferência'
      and coalesce(situacao, '') not in ('Transferido', 'Perdido/Desconsiderado')
  ),
  prod as (select tipo, situacao, valor from producao where org_id = p_org_id and archived = false),
  mid  as (select tipo, situacao, valor from midias   where org_id = p_org_id and archived = false)
  select jsonb_build_object(
    'mes', to_char(v_mes, 'YYYY-MM'),
    'a_receber',          (select coalesce(sum(valor), 0)      from ex where tipo = 'receita' and situacao in ('Em aberto','Atrasado') and coalesce(data_prevista, venc_original) >= v_mes and coalesce(data_prevista, venc_original) < v_fim),
    'a_pagar',            (select coalesce(sum(abs(valor)), 0) from ex where tipo = 'despesa' and situacao in ('Em aberto','Atrasado') and coalesce(data_prevista, venc_original) >= v_mes and coalesce(data_prevista, venc_original) < v_fim),
    'recebido',           (select coalesce(sum(valor), 0)      from ex where tipo = 'receita' and situacao in ('Conciliado','Quitado') and data_mov >= v_mes and data_mov < v_fim),
    'pago',               (select coalesce(sum(abs(valor)), 0) from ex where tipo = 'despesa' and situacao in ('Conciliado','Quitado') and data_mov >= v_mes and data_mov < v_fim),
    'a_receber_atrasado', (select coalesce(sum(valor), 0)      from ex where tipo = 'receita' and situacao in ('Em aberto','Atrasado') and coalesce(data_prevista, venc_original) < current_date),
    'a_pagar_atrasado',   (select coalesce(sum(abs(valor)), 0) from ex where tipo = 'despesa' and situacao in ('Em aberto','Atrasado') and coalesce(data_prevista, venc_original) < current_date),
    'producao_pendente',  (select jsonb_build_object('n', count(*), 'total', coalesce(sum(valor), 0)) from prod where situacao = 'em_aberto'),
    'producao_faturar',   (select jsonb_build_object('n', count(*), 'total', coalesce(sum(valor), 0)) from prod where situacao = 'faturar'),
    'midia_pendente',     (select jsonb_build_object('n', count(*), 'total', coalesce(sum(valor), 0)) from mid where situacao = 'em_aberto'),
    'midia_por_tipo',     coalesce((select jsonb_agg(row_to_json(t)) from (select tipo, count(*) n, coalesce(sum(valor), 0) total from mid where situacao = 'em_aberto' group by tipo order by total desc) t), '[]'),
    'dre_meses', coalesce((select jsonb_agg(to_char(m, 'YYYY-MM')) from generate_series(v_dre_ini, v_mes, interval '1 month') m), '[]'),
    'dre_real', coalesce((select jsonb_agg(row_to_json(t)) from (
        select coalesce(nullif(categoria, ''), '(sem categoria)') categoria, to_char(date_trunc('month', data_mov), 'YYYY-MM') mes, sum(valor) v
        from ex where situacao in ('Conciliado','Quitado') and data_mov >= v_dre_ini and data_mov < v_fim
        group by 1, 2) t), '[]'),
    'dre_prev', coalesce((select jsonb_agg(row_to_json(t)) from (
        select coalesce(nullif(categoria, ''), '(sem categoria)') categoria, to_char(date_trunc('month', coalesce(data_prevista, venc_original)), 'YYYY-MM') mes, sum(valor) v
        from ex where situacao in ('Em aberto','Atrasado') and coalesce(data_prevista, venc_original) >= v_dre_ini and coalesce(data_prevista, venc_original) < v_fim
        group by 1, 2) t), '[]')
  ) into v;
  return v;
end $function$;

-- dashboard_gestao
CREATE OR REPLACE FUNCTION public.dashboard_gestao(p_user_id uuid, p_org_id uuid, p_ws uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb; v_role text;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select role into v_role from organization_members where org_id = p_org_id and user_id = p_user_id;
  if v_role is null or v_role <> 'owner' then raise exception 'Acesso negado'; end if;

  with base as (
    select a.id, a.title, a.status as status_e, a.status::text as status, a.due_date,
           a.estimated_hours, a.created_at, a.campaign_id,
           w.id as ws_id, w.name as ws_name, c.name as camp_name
    from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    where w.org_id = p_org_id and a.archived = false
      and (p_ws is null or cardinality(p_ws) = 0 or w.id = any(p_ws))
  ),
  ativa as (select * from base where status <> 'concluido'),
  resp_direto as (
    select b.id, aa.user_id
    from ativa b
    join activity_assignees aa on aa.activity_id = b.id
    join organization_members om on om.user_id = aa.user_id and om.org_id = p_org_id
    join org_positions pos on pos.id = om.position_id
    where b.status_e = any(pos.allowed_statuses)
  ),
  resp_cargo as (
    select b.id, om.user_id
    from ativa b
    join organization_members om on om.org_id = p_org_id
    join org_positions pos on pos.id = om.position_id
    where b.status_e = any(pos.allowed_statuses)
      and not exists (select 1 from resp_direto r where r.id = b.id)
  ),
  dono as (select id, user_id from resp_direto union select id, user_id from resp_cargo),
  asg as (select id as activity_id, array_agg(user_id) as uids from dono group by id),
  last_move as (
    select b.id, coalesce(max(h.changed_at), b.created_at) as last_at
    from ativa b left join activity_history h on h.activity_id = b.id
    group by b.id, b.created_at
  ),
  assign_qtd as (
    select b.id, count(aa.user_id) as n
    from ativa b left join activity_assignees aa on aa.activity_id = b.id
    group by b.id
  ),
  atrasadas as (
    select b.id, b.title, b.ws_id, b.campaign_id, b.ws_name, b.camp_name, b.status, b.due_date,
           coalesce(a.uids, '{}'::uuid[]) as assignees,
           (current_date - b.due_date::date) as dias
    from ativa b left join asg a on a.activity_id = b.id
    where b.due_date is not null and b.due_date::date < current_date
  ),
  sem_resp  as (select b.* from ativa b join assign_qtd s on s.id = b.id where s.n = 0),
  sem_prazo as (select b.* from ativa b where b.due_date is null),
  paradas as (
    select b.id, b.title, b.ws_id, b.campaign_id, b.ws_name, b.camp_name, b.status,
           coalesce(a.uids, '{}'::uuid[]) as assignees,
           extract(day from now() - lm.last_at)::int as dias
    from ativa b
    join last_move lm on lm.id = b.id
    left join asg a on a.activity_id = b.id
    where lm.last_at < now() - interval '7 days'
  ),
  carga as (
    select d.user_id, p.full_name, p.avatar_url,
           count(*) as ativas, coalesce(sum(b.estimated_hours), 0)::numeric as horas
    from dono d
    join ativa b on b.id = d.id
    join profiles p on p.id = d.user_id
    group by d.user_id, p.full_name, p.avatar_url
  ),
  funil as (select status, count(*) as n from ativa group by status)
  select jsonb_build_object(
    'total_ativas',     (select count(*) from ativa),
    'n_atrasadas',      (select count(*) from atrasadas),
    'n_sem_responsavel',(select count(*) from sem_resp),
    'n_sem_prazo',      (select count(*) from sem_prazo),
    'n_paradas',        (select count(*) from paradas),
    'atrasadas', coalesce((select jsonb_agg(row_to_json(t)) from
      (select id, title, ws_id, campaign_id, ws_name, camp_name, status, assignees, dias from atrasadas order by dias desc limit 60) t), '[]'),
    'sem_responsavel', coalesce((select jsonb_agg(row_to_json(t)) from
      (select id, title, ws_id, campaign_id, ws_name, camp_name, status from sem_resp order by ws_name, title limit 60) t), '[]'),
    'paradas', coalesce((select jsonb_agg(row_to_json(t)) from
      (select id, title, ws_id, campaign_id, ws_name, camp_name, status, assignees, dias from paradas order by dias desc limit 60) t), '[]'),
    'carga', coalesce((select jsonb_agg(row_to_json(t)) from
      (select user_id, full_name, avatar_url, ativas, horas from carga order by ativas desc, horas desc) t), '[]'),
    'funil', coalesce((select jsonb_agg(row_to_json(t)) from
      (select status, n from funil) t), '[]')
  ) into v;
  return v;
end $function$;

-- dashboard_home
CREATE OR REPLACE FUNCTION public.dashboard_home(p_user_id uuid, p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text; v_finance boolean;
  v_pode_time boolean; v_pode_fin boolean;
  v_ini date := date_trunc('month', current_date)::date;
  v_fim date := (date_trunc('month', current_date) + interval '1 month')::date;
  v_30d timestamptz := (current_date - 29)::timestamptz;
  v_pessoal jsonb; v_equipe jsonb := null; v_fin jsonb := null;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select role, coalesce(can_finance, false) into v_role, v_finance
    from organization_members where org_id = p_org_id and user_id = p_user_id;
  if v_role is null then raise exception 'Acesso negado'; end if;
  v_pode_time := v_role in ('owner', 'admin');
  v_pode_fin  := v_finance or v_role in ('owner', 'admin');

  with my_done as (
    select a.id, a.due_date, a.created_at, max(h.changed_at) as done_at
    from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id and w.org_id = p_org_id
    join activity_assignees aa on aa.activity_id = a.id and aa.user_id = p_user_id
    join activity_history h on h.activity_id = a.id and h.to_status = 'concluido'
      and h.changed_at >= v_ini and h.changed_at < v_fim
    group by a.id, a.due_date, a.created_at
  )
  select jsonb_build_object(
    'concluidas_mes', (select count(*) from my_done),
    'no_prazo_pct', (select case when count(*) = 0 then null else
        round(100.0 * count(*) filter (where due_date is null or done_at::date <= due_date) / count(*)) end from my_done),
    'tempo_medio_dias', (select round(avg(extract(epoch from (done_at - created_at)) / 86400)::numeric, 1) from my_done),
    'interacoes_30d', (
        (select count(*) from activity_history h join activities a on a.id = h.activity_id join campaigns c on c.id = a.campaign_id join workspaces w on w.id = c.workspace_id and w.org_id = p_org_id where h.changed_by = p_user_id and h.changed_at >= v_30d)
      + (select count(*) from activity_field_history fh join activities a on a.id = fh.activity_id join campaigns c on c.id = a.campaign_id join workspaces w on w.id = c.workspace_id and w.org_id = p_org_id where fh.changed_by = p_user_id and fh.changed_at >= v_30d)
      + (select count(*) from activity_comments cm join activities a on a.id = cm.activity_id join campaigns c on c.id = a.campaign_id join workspaces w on w.id = c.workspace_id and w.org_id = p_org_id where cm.user_id = p_user_id and cm.created_at >= v_30d)
      + (select count(*) from activity_comment_reactions r join activity_comments cm on cm.id = r.comment_id join activities a on a.id = cm.activity_id join campaigns c on c.id = a.campaign_id join workspaces w on w.id = c.workspace_id and w.org_id = p_org_id where r.user_id = p_user_id and r.created_at >= v_30d)
    )
  ) into v_pessoal;

  if v_pode_time then
    with base as (
      select a.id, a.status as status_e, a.status::text as status, a.due_date
      from activities a
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id and w.org_id = p_org_id
      where a.archived = false
    ),
    ativa as (select * from base where status <> 'concluido'),
    funil as (select status, count(*) as n from ativa group by status),
    done_mes as (
      select a.id, a.due_date, max(h.changed_at) as done_at
      from activities a
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id and w.org_id = p_org_id
      join activity_history h on h.activity_id = a.id and h.to_status = 'concluido'
        and h.changed_at >= v_ini and h.changed_at < v_fim
      group by a.id, a.due_date
    ),
    resp_direto as (
      select b.id, b.due_date, aa.user_id
      from ativa b
      join activity_assignees aa on aa.activity_id = b.id
      join organization_members om on om.user_id = aa.user_id and om.org_id = p_org_id
      join org_positions pos on pos.id = om.position_id
      where b.status_e = any(pos.allowed_statuses)
    ),
    resp_cargo as (
      select b.id, b.due_date, om.user_id
      from ativa b
      join organization_members om on om.org_id = p_org_id
      join org_positions pos on pos.id = om.position_id
      where b.status_e = any(pos.allowed_statuses)
        and not exists (select 1 from resp_direto r where r.id = b.id)
    ),
    dono as (select id, due_date, user_id from resp_direto union select id, due_date, user_id from resp_cargo),
    carga as (select user_id, count(*) as n from dono group by user_id),
    atrasadas_p as (
      select user_id, count(*) as n from dono
      where due_date is not null and due_date::date < current_date group by user_id
    ),
    -- Entregou = moveu adiante uma etapa pela qual ELA responde (pelo cargo).
    entregas as (
      select h.changed_by as user_id, count(*) as n
      from activity_history h
      join activities a on a.id = h.activity_id
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id and w.org_id = p_org_id
      join organization_members om on om.user_id = h.changed_by and om.org_id = p_org_id
      join org_positions pos on pos.id = om.position_id
      where h.changed_at >= v_ini and h.changed_at < v_fim
        and h.from_status is not null and h.from_status = any(pos.allowed_statuses)
      group by h.changed_by
    ),
    pessoas as (
      select p.id, p.full_name, p.avatar_url,
        coalesce(max(e.n), 0)  as entregas,
        coalesce(max(cg.n), 0) as carga,
        coalesce(max(ap.n), 0) as atrasadas
      from profiles p
      left join entregas e     on e.user_id = p.id
      left join carga cg       on cg.user_id = p.id
      left join atrasadas_p ap on ap.user_id = p.id
      where p.id in (select user_id from organization_members where org_id = p_org_id)
      group by p.id, p.full_name, p.avatar_url
      having coalesce(max(e.n), 0) > 0 or coalesce(max(cg.n), 0) > 0
    )
    select jsonb_build_object(
      'em_andamento', (select count(*) from ativa),
      'atrasadas', (select count(*) from ativa where due_date is not null and due_date::date < current_date),
      'concluidas_mes', (select count(*) from done_mes),
      'sla_prazo_pct', (select case when count(*) = 0 then null else
          round(100.0 * count(*) filter (where due_date is null or done_at::date <= due_date) / count(*)) end from done_mes),
      'funil', coalesce((select jsonb_agg(row_to_json(t)) from (select status, n from funil order by n desc) t), '[]'),
      'pessoas', coalesce((select jsonb_agg(row_to_json(t)) from
        (select id as user_id, full_name, avatar_url, entregas, carga, atrasadas
         from pessoas order by entregas desc, atrasadas desc, carga desc limit 12) t), '[]')
    ) into v_equipe;
  end if;

  if v_pode_fin then
    with lanc as (
      select tipo, situacao, vencimento, data_liquidacao, valor, valor_realizado
      from lancamentos where org_id = p_org_id
    )
    select jsonb_build_object(
      'a_receber', (select coalesce(sum(valor), 0) from lanc where tipo = 'entrada' and situacao = 'em_aberto' and vencimento >= v_ini and vencimento < v_fim),
      'a_pagar',   (select coalesce(sum(valor), 0) from lanc where tipo = 'saida'   and situacao = 'em_aberto' and vencimento >= v_ini and vencimento < v_fim),
      'recebido',  (select coalesce(sum(coalesce(valor_realizado, valor)), 0) from lanc where tipo = 'entrada' and situacao in ('recebido','pago') and data_liquidacao >= v_ini and data_liquidacao < v_fim),
      'pago',      (select coalesce(sum(coalesce(valor_realizado, valor)), 0) from lanc where tipo = 'saida'   and situacao in ('recebido','pago') and data_liquidacao >= v_ini and data_liquidacao < v_fim),
      'a_receber_atrasado', (select coalesce(sum(valor), 0) from lanc where tipo = 'entrada' and situacao = 'em_aberto' and vencimento < current_date),
      'a_pagar_atrasado',   (select coalesce(sum(valor), 0) from lanc where tipo = 'saida'   and situacao = 'em_aberto' and vencimento < current_date),
      'saldo', (
        coalesce((select sum(saldo_inicial) from contas_financeiras where org_id = p_org_id and ativo), 0)
        + coalesce((select sum(coalesce(valor_realizado, valor)) from lanc where tipo = 'entrada' and situacao in ('recebido','pago')), 0)
        - coalesce((select sum(coalesce(valor_realizado, valor)) from lanc where tipo = 'saida' and situacao in ('recebido','pago')), 0)
      )
    ) into v_fin;
  end if;

  return jsonb_build_object(
    'pessoal', v_pessoal, 'equipe', v_equipe, 'financeiro', v_fin,
    'flags', jsonb_build_object('pode_time', v_pode_time, 'pode_financeiro', v_pode_fin)
  );
end $function$;

-- deactivate_invite_link
CREATE OR REPLACE FUNCTION public.deactivate_invite_link(p_user_id uuid, p_org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_caller_role member_role;
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  SELECT role INTO v_caller_role FROM organization_members WHERE org_id = p_org_id AND user_id = p_user_id;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  UPDATE org_invite_links SET is_active = false WHERE org_id = p_org_id AND is_active = true;
END;
$function$;

-- delete_campaign
CREATE OR REPLACE FUNCTION public.delete_campaign(p_user_id uuid, p_campaign_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  IF NOT EXISTS (
    SELECT 1 FROM campaigns c
    JOIN workspaces w ON w.id = c.workspace_id
    JOIN organization_members om ON om.org_id = w.org_id
    WHERE c.id = p_campaign_id AND om.user_id = p_user_id
      AND om.role IN ('owner','admin','manager')
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  DELETE FROM campaigns WHERE id = p_campaign_id;
END;
$function$;

-- delete_comment
CREATE OR REPLACE FUNCTION public.delete_comment(p_user_id uuid, p_comment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record; v_org uuid; v_role text;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into c from activity_comments where id = p_comment_id;
  if not found then return; end if;

  select w.org_id into v_org
    from activities a
    join campaigns ca on ca.id = a.campaign_id
    join workspaces w on w.id = ca.workspace_id
    where a.id = c.activity_id;
  select role into v_role from organization_members where org_id = v_org and user_id = p_user_id;

  if c.user_id = p_user_id or v_role = 'owner' then
    delete from activity_comment_reactions where comment_id = p_comment_id;
    delete from activity_comments where id = p_comment_id;
  else
    raise exception 'Acesso negado';
  end if;
end; $function$;

-- delete_document
CREATE OR REPLACE FUNCTION public.delete_document(p_user_id uuid, p_doc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not can_user_manage_doc(p_user_id, p_doc_id) then raise exception 'Acesso negado'; end if;
  delete from documents where id = p_doc_id;
end; $function$;

-- delete_lancamento
CREATE OR REPLACE FUNCTION public.delete_lancamento(p_user_id uuid, p_lancamento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l record; v_bloqueio text; v_n int;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then return jsonb_build_object('ok', true, 'escopo', 'nada'); end if;
  if not exists (
    select 1 from organization_members
    where org_id = l.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  -- Transferência: apaga os dois lados (via a RPC dedicada, que trata o bloqueio certo).
  if l.transferencia_id is not null then
    return excluir_transferencia(p_user_id, l.transferencia_id);
  end if;

  v_bloqueio := _lancamento_bloqueio_exclusao(l.id);
  if v_bloqueio is not null then raise exception '%', v_bloqueio; end if;

  -- Documento (produção/mídia): estorna o faturamento inteiro.
  if l.origem_tipo in ('producao','midia') then
    select string_agg(distinct b, ' ') into v_bloqueio from (
      select _lancamento_bloqueio_exclusao(l2.id) b from lancamentos l2
      where l2.org_id = l.org_id and l2.origem_tipo = l.origem_tipo and l2.origem_id = l.origem_id
    ) t where b is not null;
    if v_bloqueio is not null then
      raise exception 'Outra parcela deste documento já foi movimentada: %', v_bloqueio;
    end if;

    delete from lancamentos
     where org_id = l.org_id and origem_tipo = l.origem_tipo and origem_id = l.origem_id;
    get diagnostics v_n = row_count;

    if l.origem_tipo = 'producao' then
      update producao set situacao = 'faturar', updated_at = now() where id = l.origem_id;
    else
      update midias   set situacao = 'faturar', updated_at = now() where id = l.origem_id;
    end if;

    return jsonb_build_object('ok', true, 'escopo', 'documento', 'excluidos', v_n);
  end if;

  delete from lancamentos where id = p_lancamento_id;
  return jsonb_build_object('ok', true, 'escopo', 'lancamento', 'excluidos', 1);
end; $function$;

-- delete_org_position
CREATE OR REPLACE FUNCTION public.delete_org_position(p_user_id uuid, p_position_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  IF NOT EXISTS (
    SELECT 1 FROM org_positions pos
    JOIN organization_members m ON m.org_id = pos.org_id
    WHERE pos.id = p_position_id AND m.user_id = p_user_id AND m.role IN ('owner','admin')
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  -- Desvincula membros antes de deletar
  UPDATE organization_members SET position_id = NULL WHERE position_id = p_position_id;
  DELETE FROM org_positions WHERE id = p_position_id;
END;
$function$;

-- delete_workspace
CREATE OR REPLACE FUNCTION public.delete_workspace(p_user_id uuid, p_workspace_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  IF NOT EXISTS (
    SELECT 1 FROM workspaces w
    JOIN organization_members om ON om.org_id = w.org_id
    WHERE w.id = p_workspace_id AND om.user_id = p_user_id
      AND om.role IN ('owner','admin')
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  DELETE FROM workspaces WHERE id = p_workspace_id;
END;
$function$;

-- descartar_extrato
CREATE OR REPLACE FUNCTION public.descartar_extrato(p_user_id uuid, p_org_id uuid, p_import_ref text, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;

  insert into extrato_descartado (org_id, import_ref, motivo, created_by)
  values (p_org_id, p_import_ref, nullif(p_motivo, ''), p_user_id)
  on conflict (org_id, import_ref) do update set motivo = excluded.motivo;
end $function$;

-- desfazer_conciliacao_btg
CREATE OR REPLACE FUNCTION public.desfazer_conciliacao_btg(p_user_id uuid, p_movement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m record; v_lancs uuid[]; v_lanc uuid;
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

  select array_agg(distinct lancamento_id) into v_lancs
    from btg_conciliacao_itens where movement_id = p_movement_id;
  delete from btg_conciliacao_itens where movement_id = p_movement_id;

  if v_lancs is not null then
    foreach v_lanc in array v_lancs loop
      perform _recompute_lanc_conciliacao(v_lanc);
    end loop;
  end if;

  -- Legado: conciliações antigas gravaram só o FK direto, sem itens de ligação.
  if m.lancamento_id is not null and (v_lancs is null or not (m.lancamento_id = any(v_lancs))) then
    perform _recompute_lanc_conciliacao(m.lancamento_id);
  end if;

  update btg_movements set
    status = 'pendente', lancamento_id = null,
    conciliado_modo = null, conciliado_em = null, conciliado_por = null,
    updated_at = now()
  where id = p_movement_id;
end; $function$;

-- excluir_transferencia
CREATE OR REPLACE FUNCTION public.excluir_transferencia(p_user_id uuid, p_transferencia_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid; v_n int;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select org_id into v_org from lancamentos where transferencia_id = p_transferencia_id limit 1;
  if v_org is null then return jsonb_build_object('ok', true, 'escopo', 'nada'); end if;
  if not exists (
    select 1 from organization_members
    where org_id = v_org and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  if exists (
    select 1 from btg_conciliacao_itens i
    join lancamentos l on l.id = i.lancamento_id
    where l.transferencia_id = p_transferencia_id
  ) then raise exception 'Um lado da transferência está conciliado com o extrato. Desfaça a conciliação antes de excluir.'; end if;

  delete from lancamentos where transferencia_id = p_transferencia_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'escopo', 'transferencia', 'excluidos', v_n);
end; $function$;

-- ignorar_btg_movimento
CREATE OR REPLACE FUNCTION public.ignorar_btg_movimento(p_user_id uuid, p_movement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select org_id into v_org from btg_movements where id = p_movement_id;
  if v_org is null then raise exception 'Movimento não encontrado'; end if;
  if not exists (
    select 1 from organization_members
    where org_id = v_org and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  update btg_movements set status = 'ignorado', lancamento_id = null, updated_at = now()
  where id = p_movement_id;
end; $function$;

-- impacto_excluir_lancamento
CREATE OR REPLACE FUNCTION public.impacto_excluir_lancamento(p_user_id uuid, p_lancamento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l record; v_bloqueio text; v_serie text; v_numero int; v_n int; v_total numeric;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then return jsonb_build_object('pode', false, 'motivo', 'Lançamento não encontrado'); end if;
  if not exists (
    select 1 from organization_members
    where org_id = l.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then return jsonb_build_object('pode', false, 'motivo', 'Acesso negado'); end if;

  v_bloqueio := _lancamento_bloqueio_exclusao(l.id);
  if v_bloqueio is not null then
    return jsonb_build_object('pode', false, 'motivo', v_bloqueio);
  end if;

  if l.origem_tipo in ('producao','midia') then
    if l.origem_tipo = 'producao' then
      select p.serie, p.numero into v_serie, v_numero from producao p where p.id = l.origem_id;
    else
      select m.serie, m.numero into v_serie, v_numero from midias m where m.id = l.origem_id;
    end if;
    select count(*), coalesce(sum(valor), 0) into v_n, v_total
      from lancamentos where org_id = l.org_id and origem_tipo = l.origem_tipo and origem_id = l.origem_id;
    -- Uma parcela travada trava o estorno inteiro: não dá pra devolver ao faturamento
    -- um documento que já tem dinheiro recebido no meio.
    select string_agg(distinct b, ' ') into v_bloqueio from (
      select _lancamento_bloqueio_exclusao(l2.id) b from lancamentos l2
      where l2.org_id = l.org_id and l2.origem_tipo = l.origem_tipo and l2.origem_id = l.origem_id
    ) t where b is not null;
    if v_bloqueio is not null then
      return jsonb_build_object('pode', false, 'motivo',
        'Outra parcela deste documento já foi movimentada: ' || v_bloqueio);
    end if;
    return jsonb_build_object(
      'pode', true, 'escopo', 'documento',
      'doc_serie', v_serie, 'doc_numero', v_numero,
      'parcelas', v_n, 'valor_total', v_total);
  end if;

  return jsonb_build_object('pode', true, 'escopo', 'lancamento',
    'origem', l.origem_tipo, 'valor_total', l.valor, 'parcelas', 1);
end; $function$;

-- import_extrato
CREATE OR REPLACE FUNCTION public.import_extrato(p_user_id uuid, p_org_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_before bigint;
  v_after  bigint;
  v_total  int;
  v_affected int;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;

  select count(*) into v_before from extrato_importado where org_id = p_org_id;

  with rows as (
    select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      import_ref text, data_mov date, contato text, descricao text, tipo text,
      origem text, conta text, forma_pgto text, valor numeric, saldo_conta numeric,
      situacao text, valor_original numeric, juros numeric, multa numeric,
      desconto numeric, taxas numeric, competencia date, venc_original date,
      data_prevista date, observacao text, nota_fiscal text, categoria text,
      centro_custo text, recorrencia text, qtd_recorrencia text
    )
  ), ins as (
    insert into extrato_importado (
      org_id, import_ref, data_mov, contato, descricao, tipo, origem, conta,
      forma_pgto, valor, saldo_conta, situacao, valor_original, juros, multa,
      desconto, taxas, competencia, venc_original, data_prevista, observacao,
      nota_fiscal, categoria, centro_custo, recorrencia, qtd_recorrencia, imported_by
    )
    select
      p_org_id, r.import_ref, r.data_mov, r.contato, r.descricao, r.tipo, r.origem,
      r.conta, r.forma_pgto, r.valor, r.saldo_conta, r.situacao, r.valor_original,
      coalesce(r.juros,0), coalesce(r.multa,0), coalesce(r.desconto,0), coalesce(r.taxas,0),
      r.competencia, r.venc_original, r.data_prevista, r.observacao, r.nota_fiscal,
      r.categoria, r.centro_custo, r.recorrencia, r.qtd_recorrencia, p_user_id
    from rows r
    where r.import_ref is not null and r.import_ref <> ''
    on conflict (org_id, import_ref) do update set
      data_mov = excluded.data_mov, contato = excluded.contato,
      descricao = excluded.descricao, tipo = excluded.tipo, origem = excluded.origem,
      conta = excluded.conta, forma_pgto = excluded.forma_pgto, valor = excluded.valor,
      saldo_conta = excluded.saldo_conta, situacao = excluded.situacao,
      valor_original = excluded.valor_original, juros = excluded.juros,
      multa = excluded.multa, desconto = excluded.desconto, taxas = excluded.taxas,
      competencia = excluded.competencia, venc_original = excluded.venc_original,
      data_prevista = excluded.data_prevista, observacao = excluded.observacao,
      nota_fiscal = excluded.nota_fiscal, categoria = excluded.categoria,
      centro_custo = excluded.centro_custo, recorrencia = excluded.recorrencia,
      qtd_recorrencia = excluded.qtd_recorrencia, imported_at = now(), imported_by = p_user_id
    returning 1
  )
  select count(*) into v_affected from ins;

  select count(*) into v_after from extrato_importado where org_id = p_org_id;
  v_total := v_affected;
  return jsonb_build_object(
    'inserted', v_after - v_before,
    'updated',  v_total - (v_after - v_before),
    'total',    v_total
  );
end; $function$;

-- lancar_midia
CREATE OR REPLACE FUNCTION public.lancar_midia(p_user_id uuid, p_midia_id uuid, p_conta_id uuid DEFAULT NULL::uuid, p_categoria text DEFAULT NULL::text, p_centro_custo text DEFAULT NULL::text, p_forma text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from midias m
    join organization_members om on om.org_id = m.org_id
    where m.id = p_midia_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update midias set situacao = 'faturado' where id = p_midia_id;
  perform gerar_lancamento_midia(p_midia_id, p_conta_id, p_categoria, p_centro_custo, p_forma);
end; $function$;

-- liquidar_lancamento
CREATE OR REPLACE FUNCTION public.liquidar_lancamento(p_user_id uuid, p_lancamento_id uuid, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  l record;
  v_juros numeric(14,2);
  v_multa numeric(14,2);
  v_desc  numeric(14,2);
  v_tar   numeric(14,2);
  v_real  numeric(14,2);
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then raise exception 'Lançamento não encontrado'; end if;
  if not exists (
    select 1 from organization_members
    where org_id = l.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  v_juros := coalesce(nullif(p_data->>'juros','')::numeric, 0);
  v_multa := coalesce(nullif(p_data->>'multa','')::numeric, 0);
  v_desc  := coalesce(nullif(p_data->>'desconto','')::numeric, 0);
  v_tar   := coalesce(nullif(p_data->>'tarifa','')::numeric, 0);
  v_real  := coalesce(nullif(p_data->>'valor_realizado','')::numeric,
                      coalesce(l.valor,0) + v_juros + v_multa - v_desc - v_tar);

  update lancamentos set
    situacao        = case when l.tipo = 'entrada' then 'recebido' else 'pago' end,
    data_liquidacao = coalesce(nullif(p_data->>'data_liquidacao','')::date, current_date),
    conta_id        = coalesce(nullif(p_data->>'conta_id','')::uuid, conta_id),
    forma_pagamento = coalesce(nullif(p_data->>'forma_pagamento',''), forma_pagamento),
    juros = v_juros, multa = v_multa, desconto = v_desc, tarifa = v_tar,
    valor_realizado = v_real,
    updated_at = now()
  where id = p_lancamento_id;
end; $function$;

-- log_system_error
CREATE OR REPLACE FUNCTION public.log_system_error(p_user_id uuid, p_context text, p_message text, p_detail text, p_activity_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid; v_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if p_activity_id is not null then
    select w.org_id into v_org
      from activities a
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id
      where a.id = p_activity_id;
  end if;
  -- evita insert arbitrário via PostgREST: exige ser membro da org (ou de alguma, se global)
  if v_org is not null then
    if not exists (select 1 from organization_members where org_id = v_org and user_id = p_user_id) then
      raise exception 'Acesso negado';
    end if;
  elsif not exists (select 1 from organization_members where user_id = p_user_id) then
    raise exception 'Acesso negado';
  end if;

  insert into system_errors (org_id, context, message, detail, activity_id)
  values (v_org, left(coalesce(p_context,'?'), 120), left(coalesce(p_message,''), 500), p_detail, p_activity_id)
  returning id into v_id;
  return v_id;
end; $function$;

-- marcar_fechamento_enviado
CREATE OR REPLACE FUNCTION public.marcar_fechamento_enviado(p_org_id uuid, p_competencia text, p_user_id uuid, p_destinatarios text[] DEFAULT NULL::text[], p_erro text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members om
    where om.org_id = p_org_id and om.user_id = p_user_id
      and (om.can_finance or om.role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;

  if p_erro is not null then
    update fechamento_contabil
       set status = 'erro', erro = p_erro
     where org_id = p_org_id and competencia = p_competencia;
  else
    update fechamento_contabil
       set status = 'enviado', erro = null,
           confirmado_por = p_user_id, confirmado_em = now(), enviado_em = now(),
           destinatarios = p_destinatarios
     where org_id = p_org_id and competencia = p_competencia;
  end if;
end $function$;

-- marcar_lancamento_revisado
CREATE OR REPLACE FUNCTION public.marcar_lancamento_revisado(p_user_id uuid, p_lancamento_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from lancamentos l join organization_members om on om.org_id = l.org_id
    where l.id = p_lancamento_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update lancamentos set revisar = false, updated_at = now() where id = p_lancamento_id;
end; $function$;

-- mark_chat_read
CREATE OR REPLACE FUNCTION public.mark_chat_read(p_user_id uuid, p_other_id uuid, p_org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  update chat_messages set read_at = now()
   where recipient_id = p_user_id and sender_id = p_other_id and org_id = p_org_id and read_at is null;
end; $function$;

-- move_activity
CREATE OR REPLACE FUNCTION public.move_activity(p_user_id uuid, p_activity_id uuid, p_new_campaign_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid; v_new_org uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  -- org da tarefa atual
  select w.org_id into v_org
  from activities a
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  where a.id = p_activity_id;
  if v_org is null then raise exception 'Tarefa não encontrada'; end if;

  -- org do projeto destino (precisa ser a mesma org)
  select w.org_id into v_new_org
  from campaigns c join workspaces w on w.id = c.workspace_id
  where c.id = p_new_campaign_id;
  if v_new_org is null then raise exception 'Projeto destino não encontrado'; end if;
  if v_new_org <> v_org then raise exception 'Projeto destino é de outra organização'; end if;

  -- permissão: membro da org (mesma regra de quem edita a tarefa)
  if not exists (select 1 from organization_members where org_id = v_org and user_id = p_user_id) then
    raise exception 'Acesso negado';
  end if;

  update activities set campaign_id = p_new_campaign_id, updated_at = now() where id = p_activity_id;
end; $function$;

-- move_document
CREATE OR REPLACE FUNCTION public.move_document(p_user_id uuid, p_doc_id uuid, p_parent_id uuid, p_workspace_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not can_user_manage_doc(p_user_id, p_doc_id) then raise exception 'Acesso negado'; end if;

  -- Anti-ciclo: o destino não pode ser o próprio item nem um descendente dele.
  if p_parent_id is not null then
    if p_parent_id = p_doc_id then raise exception 'Não é possível mover para dentro de si mesma'; end if;
    if exists (
      with recursive sub as (
        select id from documents where id = p_doc_id
        union all
        select d.id from documents d join sub on d.parent_id = sub.id
      ) select 1 from sub where id = p_parent_id
    ) then raise exception 'Não é possível mover uma pasta para dentro dela mesma'; end if;
  end if;

  update documents set parent_id = p_parent_id, workspace_id = p_workspace_id where id = p_doc_id;

  -- Cascata: todo o conteúdo da pasta acompanha o cliente.
  with recursive sub as (
    select id from documents where parent_id = p_doc_id
    union all
    select d.id from documents d join sub on d.parent_id = sub.id
  )
  update documents set workspace_id = p_workspace_id, updated_at = now()
  where id in (select id from sub) and workspace_id is distinct from p_workspace_id;
end; $function$;

-- notify_drive_sync
CREATE OR REPLACE FUNCTION public.notify_drive_sync(p_user_id uuid, p_campaign_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid; v_ws uuid; v_name text;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select w.org_id, c.workspace_id, c.name
    into v_org, v_ws, v_name
    from campaigns c join workspaces w on w.id = c.workspace_id
    where c.id = p_campaign_id;
  if v_org is null then return; end if;

  insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
  values (
    p_user_id, v_org, 'drive_sync', null, p_user_id,
    jsonb_build_object('campaignId', p_campaign_id::text, 'workspaceId', v_ws::text, 'campanha', v_name)
  );
end; $function$;

-- promover_extrato
CREATE OR REPLACE FUNCTION public.promover_extrato(p_user_id uuid, p_org_id uuid, p_import_ref text, p_dados jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;
  if coalesce(p_import_ref, '') = '' then raise exception 'import_ref vazio'; end if;

  select id into v_id from lancamentos
   where org_id = p_org_id and origem_ref = p_import_ref
   order by created_at desc limit 1;

  if v_id is not null then
    -- já promovido → atualiza (não duplica)
    update lancamentos set
      tipo            = coalesce(nullif(p_dados->>'tipo',''), tipo),
      contato_nome    = case when p_dados ? 'contato_nome' then nullif(p_dados->>'contato_nome','') else contato_nome end,
      descricao       = case when p_dados ? 'descricao' then nullif(p_dados->>'descricao','') else descricao end,
      valor           = coalesce(nullif(p_dados->>'valor','')::numeric, valor),
      vencimento      = case when p_dados ? 'vencimento' then nullif(p_dados->>'vencimento','')::date else vencimento end,
      competencia     = case when p_dados ? 'competencia' then nullif(p_dados->>'competencia','')::date else competencia end,
      situacao        = coalesce(nullif(p_dados->>'situacao',''), situacao),
      conta_id        = case when p_dados ? 'conta_id' then nullif(p_dados->>'conta_id','')::uuid else conta_id end,
      categoria       = case when p_dados ? 'categoria' then nullif(p_dados->>'categoria','') else categoria end,
      centro_custo    = case when p_dados ? 'centro_custo' then nullif(p_dados->>'centro_custo','') else centro_custo end,
      forma_pagamento = case when p_dados ? 'forma_pagamento' then nullif(p_dados->>'forma_pagamento','') else forma_pagamento end,
      observacao      = case when p_dados ? 'observacao' then nullif(p_dados->>'observacao','') else observacao end,
      -- ↓ o que faltava: merge dos anexos, sem perder o que já estava lá
      anexos          = case
                          when p_dados ? 'anexos' and jsonb_array_length(coalesce(p_dados->'anexos','[]'::jsonb)) > 0
                          then (select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
                                  from jsonb_array_elements(
                                         coalesce(lancamentos.anexos, '[]'::jsonb)
                                         || coalesce(p_dados->'anexos', '[]'::jsonb)) x)
                          else lancamentos.anexos
                        end,
      updated_at      = now()
    where id = v_id;
    return v_id;
  end if;

  insert into lancamentos (
    org_id, origem_tipo, origem_ref, tipo, contato_nome, descricao, valor,
    vencimento, competencia, situacao, conta_id, categoria, centro_custo,
    forma_pagamento, observacao, data_liquidacao, valor_realizado,
    juros, multa, desconto, tarifa, anexos, created_by
  ) values (
    p_org_id, 'conta_azul', p_import_ref,
    coalesce(nullif(p_dados->>'tipo',''), 'entrada'),
    nullif(p_dados->>'contato_nome',''), nullif(p_dados->>'descricao',''),
    coalesce(nullif(p_dados->>'valor','')::numeric, 0),
    nullif(p_dados->>'vencimento','')::date,
    coalesce(nullif(p_dados->>'competencia','')::date, nullif(p_dados->>'vencimento','')::date),
    coalesce(nullif(p_dados->>'situacao',''), 'em_aberto'),
    nullif(p_dados->>'conta_id','')::uuid,
    nullif(p_dados->>'categoria',''), nullif(p_dados->>'centro_custo',''),
    nullif(p_dados->>'forma_pagamento',''), nullif(p_dados->>'observacao',''),
    nullif(p_dados->>'data_liquidacao','')::date, nullif(p_dados->>'valor_realizado','')::numeric,
    coalesce(nullif(p_dados->>'juros','')::numeric, 0),
    coalesce(nullif(p_dados->>'multa','')::numeric, 0),
    coalesce(nullif(p_dados->>'desconto','')::numeric, 0),
    coalesce(nullif(p_dados->>'tarifa','')::numeric, 0),
    coalesce(p_dados->'anexos', '[]'::jsonb), p_user_id
  ) returning id into v_id;
  return v_id;
end; $function$;

-- promover_extrato_previstos
CREATE OR REPLACE FUNCTION public.promover_extrato_previstos(p_user_id uuid, p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_count int := 0;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  with novos as (
    insert into lancamentos (
      org_id, tipo, origem_tipo, origem_ref, contato_nome, descricao, valor,
      vencimento, competencia, situacao, conta_id, categoria, centro_custo, created_by
    )
    select
      e.org_id,
      case when e.tipo = 'despesa' then 'saida' else 'entrada' end,
      'conta_azul', e.import_ref,
      nullif(e.contato,''), nullif(e.descricao,''),
      abs(coalesce(e.valor, 0)),
      coalesce(e.venc_original, e.data_prevista, e.data_mov),
      coalesce(e.competencia, e.data_mov),
      'em_aberto',
      (select c.id from contas_financeiras c where c.org_id = e.org_id and c.nome = e.conta limit 1),
      nullif(e.categoria,''), nullif(e.centro_custo,''),
      p_user_id
    from extrato_importado e
    where e.org_id = p_org_id
      and e.situacao in ('Em aberto', 'Atrasado')
      and coalesce(e.valor, 0) <> 0
      and not exists (
        select 1 from lancamentos l where l.org_id = e.org_id and l.origem_ref = e.import_ref
      )
    returning 1
  )
  select count(*) into v_count from novos;
  return jsonb_build_object('inserted', v_count);
end; $function$;

-- reabrir_lancamento
CREATE OR REPLACE FUNCTION public.reabrir_lancamento(p_user_id uuid, p_lancamento_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l record;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then return; end if;
  if not exists (
    select 1 from organization_members
    where org_id = l.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update lancamentos set
    situacao = 'em_aberto', data_liquidacao = null, valor_realizado = null,
    juros = 0, multa = 0, desconto = 0, tarifa = 0, updated_at = now()
  where id = p_lancamento_id;
end; $function$;

-- recur_activity
CREATE OR REPLACE FUNCTION public.recur_activity(p_user_id uuid, p_activity_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rec   text;
  v_rem   integer;
  v_due   date;
  v_start date;
  v_reset activity_status;
  v_to    activity_status;
  v_int   interval;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where a.id = p_activity_id and m.user_id = p_user_id
  ) then
    raise exception 'Acesso negado';
  end if;

  select recurrence, recurrence_remaining, due_date, start_date, recurrence_reset_status
    into v_rec, v_rem, v_due, v_start, v_reset
    from activities where id = p_activity_id;

  if v_rec is null then return false; end if;
  if v_rem is not null and v_rem <= 0 then return false; end if;

  v_int := public.recurrence_interval(v_rec);
  if v_int is null then return false; end if;

  v_to := coalesce(v_reset, 'briefing');

  update activities
     set status = v_to,
         due_date = case when v_due is not null then (v_due + v_int)::date else null end,
         start_date = case when v_start is not null then (v_start + v_int)::date else null end,
         recurrence_remaining = case when v_rem is null then null else v_rem - 1 end,
         updated_at = now()
   where id = p_activity_id;

  insert into activity_history (activity_id, from_status, to_status, changed_by, comment)
  values (p_activity_id, 'concluido', v_to, p_user_id, 'Recorrência: reaberta para o próximo prazo');

  return true;
end;
$function$;

-- regerar_lancamentos_midias
CREATE OR REPLACE FUNCTION public.regerar_lancamentos_midias(p_user_id uuid, p_org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  for r in select id from midias where org_id = p_org_id and situacao = 'faturado' loop
    perform gerar_lancamento_midia(r.id);
  end loop;
end; $function$;

-- remove_member
CREATE OR REPLACE FUNCTION public.remove_member(p_user_id uuid, p_org_id uuid, p_member_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = p_org_id AND user_id = p_user_id AND role IN ('owner','admin')
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  DELETE FROM organization_members WHERE id = p_member_id AND org_id = p_org_id;
END;
$function$;

-- resolve_system_error
CREATE OR REPLACE FUNCTION public.resolve_system_error(p_user_id uuid, p_error_id uuid, p_resolved boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select org_id into v_org from system_errors where id = p_error_id;
  if not exists (
    select 1 from organization_members where org_id = v_org and user_id = p_user_id and role in ('owner','admin')
  ) then raise exception 'Acesso negado'; end if;
  update system_errors set resolved = p_resolved where id = p_error_id;
end; $function$;

-- ressincronizar_lancamento
CREATE OR REPLACE FUNCTION public.ressincronizar_lancamento(p_user_id uuid, p_lancamento_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  l record; m record;
  v_valor numeric(14,2); v_venc date;
  v_pagador text; v_ct text; v_cn text;
  v_prod_total numeric(14,2); v_forn_nome text;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then return; end if;
  if not exists (
    select 1 from organization_members where org_id = l.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  if l.origem_tipo <> 'midia' or l.origem_id is null then
    update lancamentos set revisar = false, updated_at = now() where id = p_lancamento_id; return;
  end if;

  select mi.*, w.name as cliente_nome, ve.name as veiculo_nome into m
    from midias mi join workspaces w on w.id = mi.workspace_id join veiculos ve on ve.id = mi.veiculo_id
    where mi.id = l.origem_id;
  if not found then
    update lancamentos set revisar = false, updated_at = now() where id = p_lancamento_id; return;
  end if;

  v_venc := _midia_vencimento(m.prazo, m.data_base, m.dias_agencia);

  if coalesce(l.origem_parte, 'veiculacao') = 'producao' then
    -- Parte da PRODUÇÃO: valor e pagador saem do bloco de produção do documento.
    v_prod_total := round(
      _br_num(m.detalhe->>'producao_valor')
      * greatest(coalesce(nullif(_br_num(m.detalhe->>'producao_quantidade'), 0), 1), 1), 2);
    v_valor := round(v_prod_total * _br_num(m.detalhe->>'producao_comissao_pct') / 100.0, 2);
    if coalesce(m.detalhe->>'producao_tipo', 'no_veiculo') = 'de_terceiros' then
      select f.name into v_forn_nome from fornecedores f
       where f.id = nullif(m.detalhe->>'producao_fornecedor_id','')::uuid;
      v_ct := case when v_forn_nome is null then 'veiculo' else 'fornecedor' end;
      v_cn := coalesce(v_forn_nome, m.veiculo_nome);
    else
      v_ct := 'veiculo'; v_cn := m.veiculo_nome;
    end if;
  else
    -- Parte da VEICULAÇÃO.
    v_valor := round(coalesce(m.valor,0) * coalesce(m.desconto_pct,0) / 100.0, 2);
    v_pagador := case
      when m.faturamento in ('valor_bruto','liquido_contra_agencia') then 'veiculo'
      when m.faturamento = 'valor_bruto_comissao_cliente' then 'cliente'
      else 'cliente'
    end;
    if v_pagador = 'veiculo' then v_ct := 'veiculo'; v_cn := m.veiculo_nome;
    else v_ct := 'cliente'; v_cn := m.cliente_nome; end if;
  end if;

  update lancamentos set
    valor = v_valor, vencimento = v_venc, competencia = m.data_base,
    contato_tipo = v_ct, contato_nome = v_cn, revisar = false, updated_at = now()
  where id = p_lancamento_id;
end; $function$;

-- restaurar_extrato
CREATE OR REPLACE FUNCTION public.restaurar_extrato(p_user_id uuid, p_org_id uuid, p_import_ref text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;

  delete from extrato_descartado where org_id = p_org_id and import_ref = p_import_ref;
end $function$;

-- salvar_config_contabil
CREATE OR REPLACE FUNCTION public.salvar_config_contabil(p_org_id uuid, p_user_id uuid, p_emails text[], p_dia integer, p_ativo boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  -- Security definer roda com privilégio: a permissão é conferida aqui, não só
  -- na server action.
  if not exists (
    select 1 from organization_members om
    where om.org_id = p_org_id and om.user_id = p_user_id
      and (om.can_finance or om.role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;

  if p_dia < 1 or p_dia > 28 then
    raise exception 'O dia precisa estar entre 1 e 28';
  end if;
  if p_ativo and coalesce(array_length(p_emails, 1), 0) = 0 then
    raise exception 'Defina ao menos um e-mail antes de ativar';
  end if;

  insert into org_settings (org_id, contabil_emails, contabil_dia, contabil_ativo, updated_at)
  values (p_org_id, coalesce(p_emails, '{}'), p_dia, p_ativo, now())
  on conflict (org_id) do update set
    contabil_emails = excluded.contabil_emails,
    contabil_dia    = excluded.contabil_dia,
    contabil_ativo  = excluded.contabil_ativo,
    updated_at      = now();
end $function$;

-- seed_finance_from_extrato
CREATE OR REPLACE FUNCTION public.seed_finance_from_extrato(p_user_id uuid, p_org_id uuid, p_contas jsonb, p_centros jsonb, p_categorias jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c jsonb;
  v_ord int;
  v_contas int := 0;
  v_centros int := 0;
  v_cats int := 0;
  v_centros_cfg jsonb;
  v_cats_cfg jsonb;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;

  -- ── Contas financeiras: cria as que faltam (saldo_inicial = saldo atual do arquivo) ──
  select coalesce(max(ordem), 0) into v_ord from contas_financeiras where org_id = p_org_id;
  for c in select value from jsonb_array_elements(coalesce(p_contas, '[]'::jsonb)) loop
    if nullif(c->>'nome','') is null then continue; end if;
    if not exists (
      select 1 from contas_financeiras
      where org_id = p_org_id and lower(nome) = lower(c->>'nome')
    ) then
      v_ord := v_ord + 1;
      insert into contas_financeiras (org_id, nome, tipo, saldo_inicial, cor, ativo, ordem, created_by)
      values (
        p_org_id, c->>'nome', coalesce(nullif(c->>'tipo',''), 'banco'),
        coalesce(nullif(c->>'saldo_inicial','')::numeric, 0), nullif(c->>'cor',''),
        true, v_ord, p_user_id
      );
      v_contas := v_contas + 1;
    end if;
  end loop;

  -- ── org_settings: merge de centros de custo e categorias (add ausentes) ──
  select coalesce(finance_centros_custo, '[]'::jsonb), coalesce(finance_categorias, '[]'::jsonb)
    into v_centros_cfg, v_cats_cfg
    from org_settings where org_id = p_org_id;
  v_centros_cfg := coalesce(v_centros_cfg, '[]'::jsonb);
  v_cats_cfg    := coalesce(v_cats_cfg, '[]'::jsonb);

  for c in select value from jsonb_array_elements(coalesce(p_centros, '[]'::jsonb)) loop
    if nullif(c->>'nome','') is null then continue; end if;
    if not exists (
      select 1 from jsonb_array_elements(v_centros_cfg) e where lower(e->>'nome') = lower(c->>'nome')
    ) then
      v_centros_cfg := v_centros_cfg || jsonb_build_array(
        jsonb_build_object('nome', c->>'nome', 'cor', nullif(c->>'cor',''))
      );
      v_centros := v_centros + 1;
    end if;
  end loop;

  for c in select value from jsonb_array_elements(coalesce(p_categorias, '[]'::jsonb)) loop
    if nullif(c->>'nome','') is null then continue; end if;
    if not exists (
      select 1 from jsonb_array_elements(v_cats_cfg) e where lower(e->>'nome') = lower(c->>'nome')
    ) then
      v_cats_cfg := v_cats_cfg || jsonb_build_array(jsonb_build_object(
        'nome', c->>'nome',
        'tipo', coalesce(nullif(c->>'tipo',''), 'ambos'),
        'cor',  nullif(c->>'cor',''),
        'filhos', '[]'::jsonb
      ));
      v_cats := v_cats + 1;
    end if;
  end loop;

  insert into org_settings (org_id, finance_centros_custo, finance_categorias)
  values (p_org_id, v_centros_cfg, v_cats_cfg)
  on conflict (org_id) do update set
    finance_centros_custo = v_centros_cfg,
    finance_categorias    = v_cats_cfg;

  return jsonb_build_object('contas', v_contas, 'centros', v_centros, 'categorias', v_cats);
end; $function$;

-- seed_finance_from_extrato_table
CREATE OR REPLACE FUNCTION public.seed_finance_from_extrato_table(p_user_id uuid, p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  paleta text[] := array['#f97316','#22c55e','#3b82f6','#8b5cf6','#ec4899','#eab308','#14b8a6','#ef4444','#6366f1','#06b6d4'];
  rec record;
  v_ord int;
  v_contas int := 0; v_contas_upd int := 0; v_centros int := 0; v_cats int := 0;
  v_centros_cfg jsonb; v_cats_cfg jsonb;
  i int;
  v_cor text; v_tipo text; v_saldo numeric;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;

  -- ── Contas (saldo atual por conta = soma assinada dos realizados) ──
  select coalesce(max(ordem), 0) into v_ord from contas_financeiras where org_id = p_org_id;
  i := 0;
  for rec in
    select conta as nome,
           sum(case when situacao in ('Conciliado','Quitado','Transferido')
                    then (case when tipo='receita' then abs(valor)
                               when tipo='despesa' then -abs(valor) else 0 end)
                    else 0 end) as saldo
    from extrato_importado
    where org_id = p_org_id and conta is not null and conta <> ''
    group by conta
    order by 2 desc
  loop
    v_cor := paleta[(i % 10) + 1];
    v_saldo := round(coalesce(rec.saldo,0),2);
    v_tipo := case
      when rec.nome ~* 'fundo|reserva|aplica|crédito|credito' then 'aplicacao'
      when rec.nome ~* 'caixa|ajuste' then 'caixa'
      else 'banco' end;
    if not exists (
      select 1 from contas_financeiras where org_id = p_org_id and lower(nome) = lower(rec.nome)
    ) then
      v_ord := v_ord + 1;
      insert into contas_financeiras (org_id, nome, tipo, saldo_inicial, cor, ativo, ordem, created_by)
      values (p_org_id, rec.nome, v_tipo, v_saldo, v_cor, true, v_ord, p_user_id);
      v_contas := v_contas + 1;
    else
      -- conta já existe: se está zerada (não configurada), preenche o saldo do arquivo
      update contas_financeiras
        set saldo_inicial = v_saldo, updated_at = now()
        where org_id = p_org_id and lower(nome) = lower(rec.nome)
          and saldo_inicial = 0 and v_saldo <> 0;
      if found then v_contas_upd := v_contas_upd + 1; end if;
    end if;
    i := i + 1;
  end loop;

  -- ── org_settings: centros de custo e categorias (merge, add ausentes) ──
  select coalesce(finance_centros_custo,'[]'::jsonb), coalesce(finance_categorias,'[]'::jsonb)
    into v_centros_cfg, v_cats_cfg
    from org_settings where org_id = p_org_id;
  v_centros_cfg := coalesce(v_centros_cfg,'[]'::jsonb);
  v_cats_cfg    := coalesce(v_cats_cfg,'[]'::jsonb);

  i := 0;
  for rec in
    select distinct centro_custo as nome from extrato_importado
    where org_id = p_org_id and centro_custo is not null and centro_custo <> ''
    order by 1
  loop
    v_cor := paleta[(i % 10) + 1];
    if not exists (select 1 from jsonb_array_elements(v_centros_cfg) e where lower(e->>'nome') = lower(rec.nome)) then
      v_centros_cfg := v_centros_cfg || jsonb_build_array(jsonb_build_object('nome', rec.nome, 'cor', v_cor));
      v_centros := v_centros + 1;
    end if;
    i := i + 1;
  end loop;

  i := 0;
  for rec in
    select categoria as nome, bool_or(tipo='receita') as e, bool_or(tipo='despesa') as s
    from extrato_importado
    where org_id = p_org_id and categoria is not null and categoria <> ''
      and categoria not in ('Saldo Inicial','Transferência de Entrada','Transferência de Saída')
    group by categoria
    order by 1
  loop
    v_cor := paleta[(i % 10) + 1];
    if not exists (select 1 from jsonb_array_elements(v_cats_cfg) e where lower(e->>'nome') = lower(rec.nome)) then
      v_cats_cfg := v_cats_cfg || jsonb_build_array(jsonb_build_object(
        'nome', rec.nome,
        'tipo', case when rec.e and rec.s then 'ambos' when rec.e then 'entrada' else 'saida' end,
        'cor', v_cor, 'filhos', '[]'::jsonb));
      v_cats := v_cats + 1;
    end if;
    i := i + 1;
  end loop;

  insert into org_settings (org_id, finance_centros_custo, finance_categorias)
  values (p_org_id, v_centros_cfg, v_cats_cfg)
  on conflict (org_id) do update set
    finance_centros_custo = v_centros_cfg,
    finance_categorias    = v_cats_cfg;

  return jsonb_build_object(
    'contas', v_contas, 'contas_atualizadas', v_contas_upd,
    'centros', v_centros, 'categorias', v_cats
  );
end; $function$;

-- send_chat_message
CREATE OR REPLACE FUNCTION public.send_chat_message(p_user_id uuid, p_recipient_id uuid, p_org_id uuid, p_content text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_text text := nullif(btrim(p_content), '');
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if v_text is null then raise exception 'Mensagem vazia'; end if;
  if p_recipient_id = p_user_id then raise exception 'Destinatário inválido'; end if;
  if not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_user_id)
     or not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_recipient_id)
  then raise exception 'Acesso negado'; end if;

  insert into chat_messages (org_id, sender_id, recipient_id, content)
  values (p_org_id, p_user_id, p_recipient_id, left(v_text, 4000))
  returning id into v_id;
  return v_id;
end; $function$;

-- set_activity_archived
CREATE OR REPLACE FUNCTION public.set_activity_archived(p_user_id uuid, p_activity_id uuid, p_archived boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where a.id = p_activity_id and m.user_id = p_user_id
  ) then
    raise exception 'Acesso negado';
  end if;

  update activities
     set archived    = p_archived,
         archived_at = case when p_archived then now() else null end
   where id = p_activity_id;
end;
$function$;

-- set_activity_checklist
CREATE OR REPLACE FUNCTION public.set_activity_checklist(p_user_id uuid, p_activity_id uuid, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select w.org_id into v_org
  from activities a
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  join organization_members m on m.org_id = w.org_id
  where a.id = p_activity_id and m.user_id = p_user_id;
  if v_org is null then raise exception 'Acesso negado'; end if;

  update activities
     set checklist = coalesce(p_items, '[]'::jsonb), updated_at = now()
   where id = p_activity_id;
end; $function$;

-- set_activity_drive
CREATE OR REPLACE FUNCTION public.set_activity_drive(p_user_id uuid, p_activity_id uuid, p_drive_folder_id text, p_drive_path text, p_drive_folder_url text, p_redacao_url text, p_finalizacao_url text, p_preview_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where a.id = p_activity_id and m.user_id = p_user_id
  ) then raise exception 'Acesso negado'; end if;
  update activities set
    drive_folder_id = coalesce(p_drive_folder_id, drive_folder_id),
    drive_path      = coalesce(p_drive_path, drive_path),
    drive_folder_url = coalesce(p_drive_folder_url, drive_folder_url),
    redacao_url     = coalesce(p_redacao_url, redacao_url),
    finalizacao_url = coalesce(p_finalizacao_url, finalizacao_url),
    preview_url     = coalesce(p_preview_url, preview_url)
  where id = p_activity_id;
end; $function$;

-- set_activity_extra_links
CREATE OR REPLACE FUNCTION public.set_activity_extra_links(p_user_id uuid, p_activity_id uuid, p_links jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select w.org_id into v_org
  from activities a
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  join organization_members m on m.org_id = w.org_id
  where a.id = p_activity_id and m.user_id = p_user_id;
  if v_org is null then raise exception 'Acesso negado'; end if;

  update activities
     set extra_links = coalesce(p_links, '[]'::jsonb), updated_at = now()
   where id = p_activity_id;
end; $function$;

-- set_activity_mute
CREATE OR REPLACE FUNCTION public.set_activity_mute(p_user_id uuid, p_activity_id uuid, p_muted boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  -- precisa ser membro da org da tarefa
  if not exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members om on om.org_id = w.org_id
    where a.id = p_activity_id and om.user_id = p_user_id
  ) then raise exception 'Acesso negado'; end if;

  if p_muted then
    insert into activity_mutes (user_id, activity_id) values (p_user_id, p_activity_id)
      on conflict do nothing;
  else
    delete from activity_mutes where user_id = p_user_id and activity_id = p_activity_id;
  end if;
end; $function$;

-- set_activity_recurrence
CREATE OR REPLACE FUNCTION public.set_activity_recurrence(p_user_id uuid, p_activity_id uuid, p_recurrence text, p_remaining integer, p_reset_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_rec text := nullif(p_recurrence, '');
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where a.id = p_activity_id and m.user_id = p_user_id
  ) then
    raise exception 'Acesso negado';
  end if;

  update activities
     set recurrence = v_rec,
         recurrence_remaining = case when v_rec is null then null else p_remaining end,
         recurrence_reset_status = case when v_rec is null then null else nullif(p_reset_status, '')::activity_status end,
         updated_at = now()
   where id = p_activity_id;
end;
$function$;

-- set_campaign_archived
CREATE OR REPLACE FUNCTION public.set_campaign_archived(p_user_id uuid, p_campaign_id uuid, p_archived boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from campaigns c
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where c.id = p_campaign_id and m.user_id = p_user_id and m.role in ('owner','admin','manager')
  ) then
    raise exception 'Acesso negado';
  end if;
  update campaigns set archived = p_archived where id = p_campaign_id;
end; $function$;

-- set_campaign_drive
CREATE OR REPLACE FUNCTION public.set_campaign_drive(p_user_id uuid, p_campaign_id uuid, p_drive_folder_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from campaigns c
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where c.id = p_campaign_id and m.user_id = p_user_id and m.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update campaigns set drive_folder_id = p_drive_folder_id where id = p_campaign_id;
end; $function$;

-- set_conta_favorita
CREATE OR REPLACE FUNCTION public.set_conta_favorita(p_user_id uuid, p_conta_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid; v_fav boolean;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select org_id, favorita into v_org, v_fav from contas_financeiras where id = p_conta_id;
  if v_org is null then raise exception 'Conta não encontrada'; end if;
  if not exists (
    select 1 from organization_members
    where org_id = v_org and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  if v_fav then
    update contas_financeiras set favorita = false where id = p_conta_id;
  else
    update contas_financeiras set favorita = false where org_id = v_org and favorita;
    update contas_financeiras set favorita = true  where id = p_conta_id;
  end if;
end; $function$;

-- set_digest_enabled
CREATE OR REPLACE FUNCTION public.set_digest_enabled(p_user_id uuid, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  insert into user_prefs (user_id, digest_enabled, updated_at) values (p_user_id, p_enabled, now())
  on conflict (user_id) do update set digest_enabled = excluded.digest_enabled, updated_at = now();
end; $function$;

-- set_document_archived
CREATE OR REPLACE FUNCTION public.set_document_archived(p_user_id uuid, p_doc_id uuid, p_archived boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not can_user_manage_doc(p_user_id, p_doc_id) then raise exception 'Acesso negado'; end if;
  with recursive sub as (
    select id from documents where id = p_doc_id
    union all
    select d.id from documents d join sub s on d.parent_id = s.id
  )
  update documents set archived = p_archived, updated_at = now() where id in (select id from sub);
end; $function$;

-- set_document_briefing
CREATE OR REPLACE FUNCTION public.set_document_briefing(p_user_id uuid, p_doc_id uuid, p_kind text, p_target_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid; v_ws uuid; v_conflict text;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not can_user_manage_doc(p_user_id, p_doc_id) then raise exception 'Acesso negado'; end if;
  select org_id into v_org from documents where id = p_doc_id;
  if v_org is null then raise exception 'Documento não encontrado'; end if;

  if p_kind = 'none' or p_target_id is null then
    update documents set briefing_workspace_id = null, briefing_campaign_id = null, updated_at = now() where id = p_doc_id;

  elsif p_kind = 'workspace' then
    if not exists (select 1 from workspaces where id = p_target_id and org_id = v_org) then raise exception 'Cliente inválido'; end if;
    select title into v_conflict from documents where briefing_workspace_id = p_target_id and id <> p_doc_id limit 1;
    if v_conflict is not null then raise exception 'Este cliente já tem um briefing: %', v_conflict; end if;
    update documents set briefing_workspace_id = p_target_id, briefing_campaign_id = null,
      workspace_id = p_target_id, visibility = 'org', updated_at = now() where id = p_doc_id;

  elsif p_kind = 'campaign' then
    select w.id into v_ws from campaigns c join workspaces w on w.id = c.workspace_id where c.id = p_target_id and w.org_id = v_org;
    if v_ws is null then raise exception 'Campanha inválida'; end if;
    select title into v_conflict from documents where briefing_campaign_id = p_target_id and id <> p_doc_id limit 1;
    if v_conflict is not null then raise exception 'Esta campanha já tem um briefing: %', v_conflict; end if;
    update documents set briefing_campaign_id = p_target_id, briefing_workspace_id = null,
      workspace_id = v_ws, visibility = 'org', updated_at = now() where id = p_doc_id;

  else
    raise exception 'Tipo de briefing inválido';
  end if;
end; $function$;

-- set_document_visibility
CREATE OR REPLACE FUNCTION public.set_document_visibility(p_user_id uuid, p_doc_id uuid, p_visibility text, p_member_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not can_user_manage_doc(p_user_id, p_doc_id) then raise exception 'Acesso negado'; end if;
  update documents set visibility = p_visibility where id = p_doc_id;
  delete from document_members where document_id = p_doc_id;
  if p_visibility = 'custom' and p_member_ids is not null and array_length(p_member_ids, 1) > 0 then
    insert into document_members (document_id, user_id)
    select p_doc_id, unnest(p_member_ids);
  end if;
end; $function$;

-- set_document_workspace
CREATE OR REPLACE FUNCTION public.set_document_workspace(p_user_id uuid, p_doc_id uuid, p_workspace_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not can_user_manage_doc(p_user_id, p_doc_id) then raise exception 'Acesso negado'; end if;
  if p_workspace_id is not null and not exists (
    select 1 from workspaces w join documents d on d.id = p_doc_id
    where w.id = p_workspace_id and w.org_id = d.org_id
  ) then raise exception 'Cliente inválido'; end if;
  update documents set workspace_id = p_workspace_id where id = p_doc_id;
end; $function$;

-- set_finance_config
CREATE OR REPLACE FUNCTION public.set_finance_config(p_user_id uuid, p_org_id uuid, p_categorias jsonb, p_centros jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  insert into org_settings (org_id, finance_categorias, finance_centros_custo)
  values (p_org_id, coalesce(p_categorias,'[]'::jsonb), coalesce(p_centros,'[]'::jsonb))
  on conflict (org_id) do update set
    finance_categorias    = coalesce(p_categorias, org_settings.finance_categorias),
    finance_centros_custo = coalesce(p_centros, org_settings.finance_centros_custo);
end; $function$;

-- set_fornecedor_archived
CREATE OR REPLACE FUNCTION public.set_fornecedor_archived(p_user_id uuid, p_fornecedor_id uuid, p_archived boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from fornecedores f join organization_members om on om.org_id=f.org_id where f.id=p_fornecedor_id and om.user_id=p_user_id and om.role in ('owner','admin','manager'))
  then raise exception 'Acesso negado'; end if;
  update fornecedores set archived=p_archived, updated_at=now() where id=p_fornecedor_id;
end; $function$;

-- set_lancamento_anexos
CREATE OR REPLACE FUNCTION public.set_lancamento_anexos(p_user_id uuid, p_lancamento_id uuid, p_anexos jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from lancamentos l
    join organization_members om on om.org_id = l.org_id
    where l.id = p_lancamento_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update lancamentos set anexos = coalesce(p_anexos, '[]'::jsonb), updated_at = now()
  where id = p_lancamento_id;
end; $function$;

-- set_lancamento_flags
CREATE OR REPLACE FUNCTION public.set_lancamento_flags(p_user_id uuid, p_lancamento_id uuid, p_nf boolean, p_boleto boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from lancamentos l
    join organization_members om on om.org_id = l.org_id
    where l.id = p_lancamento_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update lancamentos set nf_emitida = p_nf, boleto_gerado = p_boleto, updated_at = now()
  where id = p_lancamento_id;
end; $function$;

-- set_lancamento_situacao
CREATE OR REPLACE FUNCTION public.set_lancamento_situacao(p_user_id uuid, p_lancamento_id uuid, p_situacao text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from lancamentos l
    join organization_members om on om.org_id = l.org_id
    where l.id = p_lancamento_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update lancamentos set situacao = p_situacao, updated_at = now() where id = p_lancamento_id;
end; $function$;

-- set_member_avatar
CREATE OR REPLACE FUNCTION public.set_member_avatar(p_user_id uuid, p_org_id uuid, p_target uuid, p_avatar_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select role into v_role
  from organization_members
  where org_id = p_org_id and user_id = p_user_id;

  if v_role not in ('owner', 'admin') then
    raise exception 'Apenas administradores podem alterar o avatar de membros';
  end if;

  if not exists (
    select 1 from organization_members where org_id = p_org_id and user_id = p_target
  ) then
    raise exception 'Pessoa não é membro desta organização';
  end if;

  update profiles set avatar_url = p_avatar_url, updated_at = now() where id = p_target;
end;
$function$;

-- set_midia_anexos
CREATE OR REPLACE FUNCTION public.set_midia_anexos(p_user_id uuid, p_midia_id uuid, p_anexos jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from midias m join organization_members om on om.org_id = m.org_id
    where m.id = p_midia_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update midias set anexos = coalesce(p_anexos, '[]'::jsonb) where id = p_midia_id;
end; $function$;

-- set_midia_archived
CREATE OR REPLACE FUNCTION public.set_midia_archived(p_user_id uuid, p_midia_id uuid, p_archived boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from midias m
    join organization_members om on om.org_id = m.org_id
    where m.id = p_midia_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update midias set archived = p_archived, updated_at = now() where id = p_midia_id;
end; $function$;

-- set_midia_situacao
CREATE OR REPLACE FUNCTION public.set_midia_situacao(p_user_id uuid, p_midia_id uuid, p_situacao text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from midias m
    join organization_members om on om.org_id = m.org_id
    where m.id = p_midia_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update midias set situacao = p_situacao, updated_at = now() where id = p_midia_id;
end; $function$;

-- set_org_docs
CREATE OR REPLACE FUNCTION public.set_org_docs(p_user_id uuid, p_org_id uuid, p_agency jsonb, p_nf_notes jsonb, p_midia_notes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_role text;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select role into v_role from organization_members where org_id = p_org_id and user_id = p_user_id;
  if v_role not in ('owner','admin') then
    raise exception 'Apenas administradores podem alterar as configurações';
  end if;
  insert into org_settings (org_id, agency_info, doc_nf_notes, doc_midia_notes, updated_at)
  values (p_org_id, p_agency, p_nf_notes, p_midia_notes, now())
  on conflict (org_id) do update set
    agency_info     = excluded.agency_info,
    doc_nf_notes    = excluded.doc_nf_notes,
    doc_midia_notes = excluded.doc_midia_notes,
    updated_at      = now();
end; $function$;

-- set_org_payment_info
CREATE OR REPLACE FUNCTION public.set_org_payment_info(p_user_id uuid, p_org_id uuid, p_info text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))) then raise exception 'Acesso negado'; end if;
  update org_settings set payment_info = nullif(p_info, '') where org_id = p_org_id;
  if not found then insert into org_settings (org_id, payment_info) values (p_org_id, nullif(p_info, '')); end if;
end $function$;

-- set_org_review_gates
CREATE OR REPLACE FUNCTION public.set_org_review_gates(p_user_id uuid, p_org_id uuid, p_gates jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select role into v_role
  from organization_members
  where org_id = p_org_id and user_id = p_user_id;

  if v_role not in ('owner', 'admin') then
    raise exception 'Apenas administradores podem alterar as configurações';
  end if;

  insert into org_settings (org_id, review_gates, updated_at)
  values (p_org_id, coalesce(p_gates, '{"redacao": true, "design": true, "finalizacao": true}'), now())
  on conflict (org_id) do update set
    review_gates = excluded.review_gates,
    updated_at   = now();
end;
$function$;

-- set_producao_anexos
CREATE OR REPLACE FUNCTION public.set_producao_anexos(p_user_id uuid, p_producao_id uuid, p_anexos jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from producao p join organization_members om on om.org_id = p.org_id
    where p.id = p_producao_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update producao set anexos = coalesce(p_anexos, '[]'::jsonb), updated_at = now() where id = p_producao_id;
end; $function$;

-- set_producao_archived
CREATE OR REPLACE FUNCTION public.set_producao_archived(p_user_id uuid, p_producao_id uuid, p_archived boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from producao p join organization_members om on om.org_id=p.org_id where p.id=p_producao_id and om.user_id=p_user_id and om.role in ('owner','admin','manager'))
  then raise exception 'Acesso negado'; end if;
  update producao set archived=p_archived, updated_at=now() where id=p_producao_id;
end; $function$;

-- set_producao_situacao
CREATE OR REPLACE FUNCTION public.set_producao_situacao(p_user_id uuid, p_producao_id uuid, p_situacao text, p_conta_id uuid DEFAULT NULL::uuid, p_categoria text DEFAULT NULL::text, p_centro_custo text DEFAULT NULL::text, p_forma text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from producao p join organization_members om on om.org_id = p.org_id
    where p.id = p_producao_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  if p_situacao in ('faturar','faturado') and exists (
    select 1 from producao where id = p_producao_id and tipo = 'fee'
      and jsonb_array_length(coalesce(detalhe->'parcelas','[]'::jsonb)) = 0
  ) then raise exception 'Gere as parcelas do Fee antes de aprovar (é o que vira o faturamento).'; end if;

  update producao set situacao = p_situacao, updated_at = now() where id = p_producao_id;
  perform gerar_lancamentos_producao(p_producao_id, p_conta_id, p_categoria, p_centro_custo, p_forma);
end; $function$;

-- set_redacao_review
CREATE OR REPLACE FUNCTION public.set_redacao_review(p_user_id uuid, p_activity_id uuid, p_status text, p_errors jsonb, p_target text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  perform set_review(p_user_id, p_activity_id, 'redacao', p_status, p_errors, p_target);
end; $function$;

-- set_review
CREATE OR REPLACE FUNCTION public.set_review(p_user_id uuid, p_activity_id uuid, p_kind text, p_status text, p_errors jsonb, p_target text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where a.id = p_activity_id and m.user_id = p_user_id
  ) then raise exception 'Acesso negado'; end if;
  update activities set
    review_kind   = p_kind,
    review_status = p_status,
    review_errors = p_errors,
    review_target = p_target,
    review_at     = now()
  where id = p_activity_id;
end; $function$;

-- set_veiculo_archived
CREATE OR REPLACE FUNCTION public.set_veiculo_archived(p_user_id uuid, p_veiculo_id uuid, p_archived boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from veiculos v
    join organization_members om on om.org_id = v.org_id
    where v.id = p_veiculo_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  update veiculos set archived = p_archived, updated_at = now() where id = p_veiculo_id;
end; $function$;

-- set_workspace_archived
CREATE OR REPLACE FUNCTION public.set_workspace_archived(p_user_id uuid, p_workspace_id uuid, p_archived boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from workspaces w
    join organization_members m on m.org_id = w.org_id
    where w.id = p_workspace_id and m.user_id = p_user_id and m.role in ('owner','admin','manager')
  ) then
    raise exception 'Acesso negado';
  end if;
  update workspaces set archived = p_archived where id = p_workspace_id;
end; $function$;

-- toggle_activity_assignee
CREATE OR REPLACE FUNCTION public.toggle_activity_assignee(p_user_id uuid, p_activity_id uuid, p_assignee_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_exists boolean;
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  -- Descobre a org da atividade
  SELECT w.org_id INTO v_org_id
  FROM activities a
  JOIN campaigns  c ON c.id = a.campaign_id
  JOIN workspaces w ON w.id = c.workspace_id
  WHERE a.id = p_activity_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Atividade não encontrada';
  END IF;

  -- Valida que o autor da ação é membro da org
  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = v_org_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  -- Valida que o responsável também é membro da org
  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = v_org_id AND user_id = p_assignee_id
  ) THEN
    RAISE EXCEPTION 'Responsável não é membro da organização';
  END IF;

  -- Toggle
  SELECT EXISTS (
    SELECT 1 FROM activity_assignees
    WHERE activity_id = p_activity_id AND user_id = p_assignee_id
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM activity_assignees
    WHERE activity_id = p_activity_id AND user_id = p_assignee_id;
    RETURN false;  -- removido
  ELSE
    INSERT INTO activity_assignees (activity_id, user_id)
    VALUES (p_activity_id, p_assignee_id)
    ON CONFLICT DO NOTHING;
    RETURN true;   -- atribuído
  END IF;
END;
$function$;

-- toggle_comment_reaction
CREATE OR REPLACE FUNCTION public.toggle_comment_reaction(p_user_id uuid, p_comment_id uuid, p_emoji text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select w.org_id into v_org
  from activity_comments ac
  join activities a on a.id = ac.activity_id
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  join organization_members m on m.org_id = w.org_id
  where ac.id = p_comment_id and m.user_id = p_user_id;
  if v_org is null then raise exception 'Acesso negado'; end if;

  if exists (select 1 from activity_comment_reactions where comment_id = p_comment_id and user_id = p_user_id and emoji = p_emoji) then
    delete from activity_comment_reactions where comment_id = p_comment_id and user_id = p_user_id and emoji = p_emoji;
  else
    insert into activity_comment_reactions (comment_id, user_id, emoji) values (p_comment_id, p_user_id, p_emoji);
  end if;
end; $function$;

-- touch_presence
CREATE OR REPLACE FUNCTION public.touch_presence(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  insert into user_presence (user_id, last_seen_at) values (p_user_id, now())
  on conflict (user_id) do update set last_seen_at = now();
end; $function$;

-- update_activity_dates
CREATE OR REPLACE FUNCTION public.update_activity_dates(p_user_id uuid, p_activity_id uuid, p_start_date date, p_due_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  SELECT w.org_id INTO v_org_id
  FROM activities a
  JOIN campaigns  c ON c.id = a.campaign_id
  JOIN workspaces w ON w.id = c.workspace_id
  WHERE a.id = p_activity_id;

  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = v_org_id AND user_id = p_user_id
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  UPDATE activities
  SET start_date = p_start_date, due_date = p_due_date, updated_at = now()
  WHERE id = p_activity_id;
END;
$function$;

-- update_activity_field
CREATE OR REPLACE FUNCTION public.update_activity_field(p_user_id uuid, p_activity_id uuid, p_field text, p_value text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id    uuid;
  v_role      text;
  v_old_value text;
  v_allowed   text[] := ARRAY[
    'title','description','due_date','start_date','priority','complexity',
    'estimated_hours','drive_folder_url','drive_path','redacao_url','layout_url',
    'finalizacao_url','preview_url','orcamento'
  ];
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  IF NOT (p_field = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'Campo não permitido: %', p_field;
  END IF;

  SELECT w.org_id INTO v_org_id
  FROM   activities a
  JOIN   campaigns  c ON c.id = a.campaign_id
  JOIN   workspaces w ON w.id = c.workspace_id
  WHERE  a.id = p_activity_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Atividade não encontrada';
  END IF;

  SELECT role INTO v_role
  FROM   organization_members
  WHERE  org_id = v_org_id AND user_id = p_user_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  EXECUTE format('SELECT (%I)::text FROM activities WHERE id = $1', p_field)
    INTO v_old_value USING p_activity_id;

  IF p_field = 'estimated_hours' THEN
    IF p_value IS NULL OR trim(p_value) = '' THEN
      UPDATE activities SET estimated_hours = NULL WHERE id = p_activity_id;
    ELSE
      UPDATE activities SET estimated_hours = p_value::numeric WHERE id = p_activity_id;
    END IF;
  ELSIF p_field IN ('start_date', 'due_date') THEN
    IF p_value IS NULL OR trim(p_value) = '' THEN
      EXECUTE format('UPDATE activities SET %I = NULL WHERE id = $1', p_field)
        USING p_activity_id;
    ELSE
      EXECUTE format('UPDATE activities SET %I = $1::date WHERE id = $2', p_field)
        USING trim(p_value), p_activity_id;
    END IF;
  ELSE
    EXECUTE format('UPDATE activities SET %I = $1 WHERE id = $2', p_field)
      USING NULLIF(trim(p_value), ''), p_activity_id;
  END IF;

  IF v_old_value IS DISTINCT FROM p_value THEN
    INSERT INTO activity_field_history
      (activity_id, changed_by, field_name, old_value, new_value)
    VALUES
      (p_activity_id, p_user_id, p_field, v_old_value, p_value);
  END IF;
END;
$function$;

-- update_activity_links
CREATE OR REPLACE FUNCTION public.update_activity_links(p_user_id uuid, p_activity_id uuid, p_drive_folder_url text, p_redacao_url text, p_layout_url text, p_finalizacao_url text, p_orcamento text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  -- Valida que o usuário é membro da org desta atividade
  IF NOT EXISTS (
    SELECT 1
    FROM activities a
    JOIN campaigns  c ON c.id  = a.campaign_id
    JOIN workspaces w ON w.id  = c.workspace_id
    JOIN organization_members om ON om.org_id = w.org_id
    WHERE a.id = p_activity_id AND om.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  UPDATE activities SET
    drive_folder_url = p_drive_folder_url,
    redacao_url      = p_redacao_url,
    layout_url       = p_layout_url,
    finalizacao_url  = p_finalizacao_url,
    orcamento        = p_orcamento,
    updated_at       = now()
  WHERE id = p_activity_id;
END;
$function$;

-- update_activity_status
CREATE OR REPLACE FUNCTION public.update_activity_status(p_user_id uuid, p_activity_id uuid, p_new_status activity_status, p_comment text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_old_status activity_status; v_label text;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select status into v_old_status from activities where id = p_activity_id;

  if not exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where a.id = p_activity_id and m.user_id = p_user_id
  ) then
    raise exception 'Acesso negado';
  end if;

  -- Trava por cargo no status ATUAL. Mensagem diz o status pra pessoa saber a quem
  -- pedir, em vez de um "acesso negado" seco.
  if not pode_mover_status(p_user_id, p_activity_id) then
    v_label := replace(initcap(replace(v_old_status::text, '_', ' ')), ' Do ', ' do ');
    raise exception 'Seu cargo não permite mover tarefas em %. Peça a quem cuida dessa etapa.', v_label;
  end if;

  update activities set status = p_new_status, updated_at = now() where id = p_activity_id;

  insert into activity_history (activity_id, from_status, to_status, changed_by, comment)
  values (p_activity_id, v_old_status, p_new_status, p_user_id, nullif(p_comment,''));
end;
$function$;

-- update_campaign
CREATE OR REPLACE FUNCTION public.update_campaign(p_user_id uuid, p_campaign_id uuid, p_name text, p_description text, p_start_date date, p_end_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  IF NOT EXISTS (
    SELECT 1 FROM campaigns c
    JOIN workspaces w ON w.id = c.workspace_id
    JOIN organization_members om ON om.org_id = w.org_id
    WHERE c.id = p_campaign_id AND om.user_id = p_user_id
      AND om.role IN ('owner','admin','manager')
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  UPDATE campaigns SET
    name        = p_name,
    description = p_description,
    start_date  = p_start_date,
    end_date    = p_end_date,
    updated_at  = now()
  WHERE id = p_campaign_id;
END;
$function$;

-- update_comment
CREATE OR REPLACE FUNCTION public.update_comment(p_user_id uuid, p_comment_id uuid, p_content text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into c from activity_comments where id = p_comment_id;
  if not found then raise exception 'Comentário não encontrado'; end if;
  if c.user_id <> p_user_id then raise exception 'Acesso negado'; end if;
  if nullif(btrim(p_content), '') is null then raise exception 'Comentário vazio'; end if;
  update activity_comments set content = p_content, updated_at = now() where id = p_comment_id;
end; $function$;

-- update_conta_financeira
CREATE OR REPLACE FUNCTION public.update_conta_financeira(p_user_id uuid, p_conta_id uuid, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from contas_financeiras c
    join organization_members om on om.org_id = c.org_id
    where c.id = p_conta_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  update contas_financeiras set
    nome          = coalesce(nullif(p_data->>'nome',''), nome),
    tipo          = coalesce(nullif(p_data->>'tipo',''), tipo),
    saldo_inicial = coalesce(nullif(p_data->>'saldo_inicial','')::numeric, saldo_inicial),
    cor           = case when p_data ? 'cor' then nullif(p_data->>'cor','') else cor end,
    ativo         = coalesce((p_data->>'ativo')::boolean, ativo),
    ordem         = coalesce(nullif(p_data->>'ordem','')::int, ordem),
    updated_at    = now()
  where id = p_conta_id;
end; $function$;

-- update_document_content
CREATE OR REPLACE FUNCTION public.update_document_content(p_user_id uuid, p_doc_id uuid, p_content jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not can_user_manage_doc(p_user_id, p_doc_id) then raise exception 'Acesso negado'; end if;
  update documents set content = p_content where id = p_doc_id;
end; $function$;

-- update_document_title
CREATE OR REPLACE FUNCTION public.update_document_title(p_user_id uuid, p_doc_id uuid, p_title text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not can_user_manage_doc(p_user_id, p_doc_id) then raise exception 'Acesso negado'; end if;
  update documents set title = coalesce(nullif(trim(p_title), ''), 'Sem título') where id = p_doc_id;
end; $function$;

-- update_fornecedor
CREATE OR REPLACE FUNCTION public.update_fornecedor(p_user_id uuid, p_fornecedor_id uuid, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from fornecedores f join organization_members om on om.org_id=f.org_id
    where f.id=p_fornecedor_id and om.user_id=p_user_id and (om.role in ('owner','admin','manager') or om.can_vendas))
  then raise exception 'Acesso negado'; end if;
  update fornecedores set
    name=coalesce(nullif(p_data->>'name',''),name), tipo=nullif(p_data->>'tipo',''), tax_id=nullif(p_data->>'tax_id',''), notes=nullif(p_data->>'notes',''),
    enderecos=coalesce(p_data->'enderecos', enderecos), telefones=coalesce(p_data->'telefones', telefones),
    emails=coalesce(p_data->'emails', emails), contas_bancarias=coalesce(p_data->'contas_bancarias', contas_bancarias),
    updated_at=now()
  where id=p_fornecedor_id;
end; $function$;

-- update_lancamento
CREATE OR REPLACE FUNCTION public.update_lancamento(p_user_id uuid, p_lancamento_id uuid, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l record; v_livre boolean;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then raise exception 'Lançamento não encontrado'; end if;
  if not exists (
    select 1 from organization_members
    where org_id = l.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  -- Texto/valor são livres quando NÃO existe documento vivo por trás. Em produção/mídia
  -- o documento é a fonte — editar aqui seria desfeito na próxima regeração.
  v_livre := l.origem_tipo in ('manual', 'conta_azul', 'ofx');

  update lancamentos set
    tipo            = case when v_livre then coalesce(nullif(p_data->>'tipo',''), tipo) else tipo end,
    contato_tipo    = case when v_livre and p_data ? 'contato_tipo' then nullif(p_data->>'contato_tipo','') else contato_tipo end,
    contato_nome    = case when v_livre and p_data ? 'contato_nome' then nullif(p_data->>'contato_nome','') else contato_nome end,
    descricao       = case when v_livre and p_data ? 'descricao' then nullif(p_data->>'descricao','') else descricao end,
    valor           = case when v_livre then coalesce(nullif(p_data->>'valor','')::numeric, valor) else valor end,
    -- campos do financeiro: editáveis em qualquer origem (inclui renegociar vencimento)
    vencimento      = case when p_data ? 'vencimento' then nullif(p_data->>'vencimento','')::date else vencimento end,
    competencia     = case when p_data ? 'competencia' then nullif(p_data->>'competencia','')::date else competencia end,
    conta_id        = case when p_data ? 'conta_id' then nullif(p_data->>'conta_id','')::uuid else conta_id end,
    categoria       = case when p_data ? 'categoria' then nullif(p_data->>'categoria','') else categoria end,
    centro_custo    = case when p_data ? 'centro_custo' then nullif(p_data->>'centro_custo','') else centro_custo end,
    forma_pagamento = case when p_data ? 'forma_pagamento' then nullif(p_data->>'forma_pagamento','') else forma_pagamento end,
    observacao      = case when p_data ? 'observacao' then nullif(p_data->>'observacao','') else observacao end,
    recorrente      = coalesce((p_data->>'recorrente')::boolean, recorrente),
    updated_at      = now()
  where id = p_lancamento_id;
end; $function$;

-- update_lancamentos_lote
CREATE OR REPLACE FUNCTION public.update_lancamentos_lote(p_user_id uuid, p_ids uuid[], p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid; v_atualizados int := 0; v_bloqueados int := 0; v_total int;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
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
end $function$;

-- update_member
CREATE OR REPLACE FUNCTION public.update_member(p_user_id uuid, p_org_id uuid, p_member_id uuid, p_position_id uuid, p_role member_role, p_can_finance boolean DEFAULT NULL::boolean, p_can_vendas boolean DEFAULT NULL::boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin')
  ) then raise exception 'Acesso negado'; end if;

  if p_user_id = p_member_id and p_role != 'owner' then
    raise exception 'Não é possível alterar o próprio papel de owner';
  end if;

  update organization_members
  set position_id = p_position_id,
      role        = p_role,
      can_finance = coalesce(p_can_finance, can_finance),
      can_vendas  = coalesce(p_can_vendas, can_vendas)
  where id = p_member_id and org_id = p_org_id;
end;
$function$;

-- update_midia
CREATE OR REPLACE FUNCTION public.update_midia(p_user_id uuid, p_midia_id uuid, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid; v_serie_atual text; v_num_atual integer; v_novo_tipo text; v_nova_serie text; v_num integer;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
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
end; $function$;

-- update_org_position
CREATE OR REPLACE FUNCTION public.update_org_position(p_user_id uuid, p_position_id uuid, p_name text, p_color text, p_allowed_statuses activity_status[], p_op_ver_tudo boolean DEFAULT NULL::boolean, p_op_midias boolean DEFAULT NULL::boolean, p_op_producao boolean DEFAULT NULL::boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from org_positions pos
    join organization_members m on m.org_id = pos.org_id
    where pos.id = p_position_id and m.user_id = p_user_id and m.role in ('owner','admin')
  ) then raise exception 'Acesso negado'; end if;

  update org_positions set
    name = p_name, color = p_color, allowed_statuses = p_allowed_statuses,
    op_ver_tudo = coalesce(p_op_ver_tudo, op_ver_tudo),
    op_midias   = coalesce(p_op_midias, op_midias),
    op_producao = coalesce(p_op_producao, op_producao)
  where id = p_position_id;
end; $function$;

-- update_producao
CREATE OR REPLACE FUNCTION public.update_producao(p_user_id uuid, p_producao_id uuid, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
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
end; $function$;

-- update_veiculo
CREATE OR REPLACE FUNCTION public.update_veiculo(p_user_id uuid, p_veiculo_id uuid, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (select 1 from veiculos v join organization_members om on om.org_id=v.org_id
    where v.id=p_veiculo_id and om.user_id=p_user_id and (om.role in ('owner','admin','manager') or om.can_vendas))
  then raise exception 'Acesso negado'; end if;
  update veiculos set
    name=coalesce(nullif(p_data->>'name',''),name), type=nullif(p_data->>'type',''), tax_id=nullif(p_data->>'tax_id',''),
    commission_pct=coalesce(nullif(p_data->>'commission_pct','')::numeric, commission_pct), notes=nullif(p_data->>'notes',''),
    enderecos=coalesce(p_data->'enderecos', enderecos), telefones=coalesce(p_data->'telefones', telefones),
    emails=coalesce(p_data->'emails', emails), contas_bancarias=coalesce(p_data->'contas_bancarias', contas_bancarias),
    midia_kit_url=nullif(p_data->>'midia_kit_url',''), midia_kit_name=nullif(p_data->>'midia_kit_name',''),
    updated_at=now()
  where id=p_veiculo_id;
end; $function$;

-- update_workspace
CREATE OR REPLACE FUNCTION public.update_workspace(p_user_id uuid, p_workspace_id uuid, p_name text, p_description text, p_color text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  IF NOT EXISTS (
    SELECT 1 FROM workspaces w
    JOIN organization_members om ON om.org_id = w.org_id
    WHERE w.id = p_workspace_id AND om.user_id = p_user_id
      AND om.role IN ('owner','admin','manager')
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  UPDATE workspaces SET
    name        = p_name,
    description = p_description,
    color       = p_color,
    updated_at  = now()
  WHERE id = p_workspace_id;
END;
$function$;

-- update_workspace_cadastro
CREATE OR REPLACE FUNCTION public.update_workspace_cadastro(p_user_id uuid, p_workspace_id uuid, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from workspaces w join organization_members om on om.org_id = w.org_id
    where w.id = p_workspace_id and om.user_id = p_user_id
      and (om.role in ('owner','admin','manager') or om.can_finance or om.can_vendas)
  ) then raise exception 'Acesso negado'; end if;

  update workspaces set
    name               = coalesce(nullif(p_data->>'name',''), name),
    description        = nullif(p_data->>'description',''),
    color              = coalesce(nullif(p_data->>'color',''), color),
    legal_name         = nullif(p_data->>'legal_name',''),
    trade_name         = nullif(p_data->>'trade_name',''),
    tax_id             = nullif(p_data->>'tax_id',''),
    state_registration = nullif(p_data->>'state_registration',''),
    city_registration  = nullif(p_data->>'city_registration',''),
    finance_email      = nullif(p_data->>'finance_email',''),
    phone              = nullif(p_data->>'phone',''),
    contact_name       = nullif(p_data->>'contact_name',''),
    address_zip        = nullif(p_data->>'address_zip',''),
    address_street     = nullif(p_data->>'address_street',''),
    address_number     = nullif(p_data->>'address_number',''),
    address_complement = nullif(p_data->>'address_complement',''),
    address_district   = nullif(p_data->>'address_district',''),
    address_city       = nullif(p_data->>'address_city',''),
    address_state      = nullif(p_data->>'address_state',''),
    payment_terms      = nullif(p_data->>'payment_terms',''),
    atividade          = nullif(p_data->>'atividade',''),
    enderecos          = coalesce(p_data->'enderecos', enderecos),
    telefones          = coalesce(p_data->'telefones', telefones),
    emails             = coalesce(p_data->'emails', emails),
    contas_bancarias   = coalesce(p_data->'contas_bancarias', contas_bancarias),
    updated_at         = now()
  where id = p_workspace_id;
end; $function$;

-- upsert_inventario_pontos
CREATE OR REPLACE FUNCTION public.upsert_inventario_pontos(p_user_id uuid, p_org_id uuid, p_veiculo_id uuid, p_formato text, p_pontos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_p jsonb; v_n int := 0;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  if not exists (select 1 from veiculos where id = p_veiculo_id and org_id = p_org_id) then
    raise exception 'Veículo não encontrado nesta organização';
  end if;

  for v_p in select * from jsonb_array_elements(coalesce(p_pontos, '[]'::jsonb))
  loop
    if nullif(v_p->>'codigo','') is null then continue; end if;
    insert into veiculo_inventario (
      org_id, veiculo_id, codigo, tipo_midia, cidade, bairro, logradouro, numero,
      referencia, endereco_full, lat, lng, foto_url, face, maps_url, formato_origem, raw, created_by
    ) values (
      p_org_id, p_veiculo_id, v_p->>'codigo', nullif(v_p->>'tipo_midia',''),
      nullif(v_p->>'cidade',''), nullif(v_p->>'bairro',''), nullif(v_p->>'logradouro',''),
      nullif(v_p->>'numero',''), nullif(v_p->>'referencia',''), nullif(v_p->>'endereco_full',''),
      nullif(v_p->>'lat','')::double precision, nullif(v_p->>'lng','')::double precision,
      nullif(v_p->>'foto_url',''), nullif(v_p->>'face',''), nullif(v_p->>'maps_url',''),
      p_formato, coalesce(v_p->'raw','{}'::jsonb), p_user_id
    )
    on conflict (veiculo_id, codigo) do update set
      tipo_midia     = coalesce(excluded.tipo_midia, veiculo_inventario.tipo_midia),
      cidade         = coalesce(excluded.cidade, veiculo_inventario.cidade),
      bairro         = coalesce(excluded.bairro, veiculo_inventario.bairro),
      logradouro     = coalesce(excluded.logradouro, veiculo_inventario.logradouro),
      numero         = coalesce(excluded.numero, veiculo_inventario.numero),
      referencia     = coalesce(excluded.referencia, veiculo_inventario.referencia),
      endereco_full  = coalesce(excluded.endereco_full, veiculo_inventario.endereco_full),
      lat            = coalesce(excluded.lat, veiculo_inventario.lat),
      lng            = coalesce(excluded.lng, veiculo_inventario.lng),
      foto_url       = coalesce(excluded.foto_url, veiculo_inventario.foto_url),
      face           = coalesce(excluded.face, veiculo_inventario.face),
      maps_url       = coalesce(excluded.maps_url, veiculo_inventario.maps_url),
      formato_origem = coalesce(excluded.formato_origem, veiculo_inventario.formato_origem),
      raw            = excluded.raw,
      ativo          = true,
      updated_at     = now();
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'processados', v_n);
end; $function$;

-- upsert_invite_link
CREATE OR REPLACE FUNCTION public.upsert_invite_link(p_user_id uuid, p_org_id uuid, p_role member_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_caller_role member_role; v_token uuid;
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  SELECT role INTO v_caller_role FROM organization_members WHERE org_id = p_org_id AND user_id = p_user_id;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  UPDATE org_invite_links SET is_active = false WHERE org_id = p_org_id AND role = p_role AND is_active = true;
  INSERT INTO org_invite_links (org_id, role, created_by) VALUES (p_org_id, p_role, p_user_id) RETURNING token INTO v_token;
  RETURN v_token;
END;
$function$;

-- upsert_org_settings
CREATE OR REPLACE FUNCTION public.upsert_org_settings(p_user_id uuid, p_org_id uuid, p_logo_url text, p_accent_color text, p_status_overrides jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  SELECT role INTO v_role
  FROM organization_members
  WHERE org_id = p_org_id AND user_id = p_user_id;

  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar as configurações';
  END IF;

  INSERT INTO org_settings (org_id, logo_url, accent_color, status_overrides, updated_at)
  VALUES (p_org_id, p_logo_url, p_accent_color, p_status_overrides, now())
  ON CONFLICT (org_id) DO UPDATE SET
    logo_url         = EXCLUDED.logo_url,
    accent_color     = EXCLUDED.accent_color,
    status_overrides = EXCLUDED.status_overrides,
    updated_at       = now();
END;
$function$;

-- ── Funções language sql (leitura): guard como predicado ──
-- can_user_manage_doc
create or replace function public.can_user_manage_doc(p_user_id uuid, p_doc_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select p_user_id = auth.uid() and exists (
    select 1 from documents d where d.id = p_doc_id and (
      d.created_by = p_user_id
      or exists (
        select 1 from organization_members m
        where m.org_id = d.org_id and m.user_id = p_user_id and m.role in ('owner','admin')
      )
    )
  );
$function$;

-- pode_mover_status
create or replace function public.pode_mover_status(p_user_id uuid, p_activity_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select p_user_id = auth.uid() and exists (
    select 1
    from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id and m.user_id = p_user_id
    left join org_positions op on op.id = m.position_id
    where a.id = p_activity_id
      and (
        m.role in ('owner', 'admin')
        or op.id is null
        or coalesce(array_length(op.allowed_statuses, 1), 0) = 0
        or a.status = any(op.allowed_statuses)
      )
  );
$function$;

-- get_chat_conversation
create or replace function public.get_chat_conversation(p_user_id uuid, p_other_id uuid, p_org_id uuid)
 returns setof chat_messages language sql security definer set search_path to 'public'
as $function$
  select * from chat_messages
   where p_user_id = auth.uid() and org_id = p_org_id
     and ((sender_id = p_user_id and recipient_id = p_other_id)
       or (sender_id = p_other_id and recipient_id = p_user_id))
   order by created_at asc
   limit 300;
$function$;

-- get_unread_counts
create or replace function public.get_unread_counts(p_user_id uuid, p_org_id uuid)
 returns table(other_id uuid, n integer) language sql security definer set search_path to 'public'
as $function$
  select sender_id as other_id, count(*)::int as n
    from chat_messages
   where p_user_id = auth.uid() and recipient_id = p_user_id and org_id = p_org_id and read_at is null
   group by sender_id;
$function$;

-- search_activities
create or replace function public.search_activities(p_user_id uuid, p_org_id uuid, p_query text, p_include_archived boolean default false)
 returns table(id uuid, title text, status text, archived boolean, campaign_id uuid, campaign_name text, workspace_id uuid, workspace_name text)
 language sql security definer set search_path to 'public', 'extensions'
as $function$
  select a.id, a.title, a.status::text, a.archived,
         c.id, c.name, w.id, w.name
  from activities a
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  where p_user_id = auth.uid() and w.org_id = p_org_id
    and exists (
      select 1 from organization_members m
      where m.org_id = p_org_id and m.user_id = p_user_id
    )
    and (p_include_archived or not a.archived)
    and (
      unaccent(a.title) ilike '%' || unaccent(p_query) || '%'
      or unaccent(coalesce(a.description, '')) ilike '%' || unaccent(p_query) || '%'
    )
  order by a.archived asc, a.updated_at desc
  limit 12;
$function$;

-- ── Defesa em profundidade: tira EXECUTE de PUBLIC, mantém authenticated ──
revoke execute on function public.accept_invite_link(p_user_id uuid, p_token uuid) from public;
grant execute on function public.accept_invite_link(p_user_id uuid, p_token uuid) to authenticated;
revoke execute on function public.add_activity_comment(p_user_id uuid, p_activity_id uuid, p_content text) from public;
grant execute on function public.add_activity_comment(p_user_id uuid, p_activity_id uuid, p_content text) to authenticated;
revoke execute on function public.add_comment_with_mentions(p_user_id uuid, p_activity_id uuid, p_content text, p_mention_ids uuid[], p_mention_all boolean, p_reply_to uuid) from public;
grant execute on function public.add_comment_with_mentions(p_user_id uuid, p_activity_id uuid, p_content text, p_mention_ids uuid[], p_mention_all boolean, p_reply_to uuid) to authenticated;
revoke execute on function public.can_user_manage_doc(p_user_id uuid, p_doc_id uuid) from public;
grant execute on function public.can_user_manage_doc(p_user_id uuid, p_doc_id uuid) to authenticated;
revoke execute on function public.clear_extrato(p_user_id uuid, p_org_id uuid) from public;
grant execute on function public.clear_extrato(p_user_id uuid, p_org_id uuid) to authenticated;
revoke execute on function public.conciliar_btg_movimento(p_user_id uuid, p_movement_id uuid, p_lancamento_id uuid) from public;
grant execute on function public.conciliar_btg_movimento(p_user_id uuid, p_movement_id uuid, p_lancamento_id uuid) to authenticated;
revoke execute on function public.conciliar_btg_multi(p_user_id uuid, p_movement_id uuid, p_itens jsonb, p_modo text) from public;
grant execute on function public.conciliar_btg_multi(p_user_id uuid, p_movement_id uuid, p_itens jsonb, p_modo text) to authenticated;
revoke execute on function public.concluir_orcamento(p_user_id uuid, p_orcamento_id uuid) from public;
grant execute on function public.concluir_orcamento(p_user_id uuid, p_orcamento_id uuid) to authenticated;
revoke execute on function public.create_activity(p_user_id uuid, p_campaign_id uuid, p_title text, p_description text, p_status text, p_priority text, p_complexity text, p_due_date date, p_estimated_hours numeric, p_start_date date) from public;
grant execute on function public.create_activity(p_user_id uuid, p_campaign_id uuid, p_title text, p_description text, p_status text, p_priority text, p_complexity text, p_due_date date, p_estimated_hours numeric, p_start_date date) to authenticated;
revoke execute on function public.create_campaign(p_user_id uuid, p_workspace_id uuid, p_name text, p_description text, p_start_date date, p_end_date date) from public;
grant execute on function public.create_campaign(p_user_id uuid, p_workspace_id uuid, p_name text, p_description text, p_start_date date, p_end_date date) to authenticated;
revoke execute on function public.create_conta_financeira(p_user_id uuid, p_org_id uuid, p_data jsonb) from public;
grant execute on function public.create_conta_financeira(p_user_id uuid, p_org_id uuid, p_data jsonb) to authenticated;
revoke execute on function public.create_document(p_user_id uuid, p_org_id uuid, p_workspace_id uuid, p_parent_id uuid) from public;
grant execute on function public.create_document(p_user_id uuid, p_org_id uuid, p_workspace_id uuid, p_parent_id uuid) to authenticated;
revoke execute on function public.create_folder(p_user_id uuid, p_org_id uuid, p_workspace_id uuid, p_name text, p_parent_id uuid) from public;
grant execute on function public.create_folder(p_user_id uuid, p_org_id uuid, p_workspace_id uuid, p_name text, p_parent_id uuid) to authenticated;
revoke execute on function public.create_fornecedor(p_user_id uuid, p_org_id uuid, p_data jsonb) from public;
grant execute on function public.create_fornecedor(p_user_id uuid, p_org_id uuid, p_data jsonb) to authenticated;
revoke execute on function public.create_lancamento(p_user_id uuid, p_org_id uuid, p_data jsonb) from public;
grant execute on function public.create_lancamento(p_user_id uuid, p_org_id uuid, p_data jsonb) to authenticated;
revoke execute on function public.create_lancamentos_serie(p_user_id uuid, p_org_id uuid, p_data jsonb, p_modo text, p_n integer) from public;
grant execute on function public.create_lancamentos_serie(p_user_id uuid, p_org_id uuid, p_data jsonb, p_modo text, p_n integer) to authenticated;
revoke execute on function public.create_midia(p_user_id uuid, p_org_id uuid, p_data jsonb) from public;
grant execute on function public.create_midia(p_user_id uuid, p_org_id uuid, p_data jsonb) to authenticated;
revoke execute on function public.create_org_for_user(p_user_id uuid, p_name text, p_slug text, p_type text, p_size text, p_segment text) from public;
grant execute on function public.create_org_for_user(p_user_id uuid, p_name text, p_slug text, p_type text, p_size text, p_segment text) to authenticated;
revoke execute on function public.create_org_position(p_user_id uuid, p_org_id uuid, p_name text, p_color text, p_allowed_statuses activity_status[], p_op_ver_tudo boolean, p_op_midias boolean, p_op_producao boolean) from public;
grant execute on function public.create_org_position(p_user_id uuid, p_org_id uuid, p_name text, p_color text, p_allowed_statuses activity_status[], p_op_ver_tudo boolean, p_op_midias boolean, p_op_producao boolean) to authenticated;
revoke execute on function public.create_producao(p_user_id uuid, p_org_id uuid, p_data jsonb) from public;
grant execute on function public.create_producao(p_user_id uuid, p_org_id uuid, p_data jsonb) to authenticated;
revoke execute on function public.create_veiculo(p_user_id uuid, p_org_id uuid, p_data jsonb) from public;
grant execute on function public.create_veiculo(p_user_id uuid, p_org_id uuid, p_data jsonb) to authenticated;
revoke execute on function public.create_workspace(p_user_id uuid, p_org_id uuid, p_name text, p_description text, p_color text) from public;
grant execute on function public.create_workspace(p_user_id uuid, p_org_id uuid, p_name text, p_description text, p_color text) to authenticated;
revoke execute on function public.criar_transferencia(p_user_id uuid, p_org_id uuid, p_data jsonb) from public;
grant execute on function public.criar_transferencia(p_user_id uuid, p_org_id uuid, p_data jsonb) to authenticated;
revoke execute on function public.dashboard_engajamento(p_user_id uuid, p_org_id uuid, p_days integer) from public;
grant execute on function public.dashboard_engajamento(p_user_id uuid, p_org_id uuid, p_days integer) to authenticated;
revoke execute on function public.dashboard_financeiro(p_user_id uuid, p_org_id uuid, p_mes text) from public;
grant execute on function public.dashboard_financeiro(p_user_id uuid, p_org_id uuid, p_mes text) to authenticated;
revoke execute on function public.dashboard_gestao(p_user_id uuid, p_org_id uuid, p_ws uuid[]) from public;
grant execute on function public.dashboard_gestao(p_user_id uuid, p_org_id uuid, p_ws uuid[]) to authenticated;
revoke execute on function public.dashboard_home(p_user_id uuid, p_org_id uuid) from public;
grant execute on function public.dashboard_home(p_user_id uuid, p_org_id uuid) to authenticated;
revoke execute on function public.deactivate_invite_link(p_user_id uuid, p_org_id uuid) from public;
grant execute on function public.deactivate_invite_link(p_user_id uuid, p_org_id uuid) to authenticated;
revoke execute on function public.delete_campaign(p_user_id uuid, p_campaign_id uuid) from public;
grant execute on function public.delete_campaign(p_user_id uuid, p_campaign_id uuid) to authenticated;
revoke execute on function public.delete_comment(p_user_id uuid, p_comment_id uuid) from public;
grant execute on function public.delete_comment(p_user_id uuid, p_comment_id uuid) to authenticated;
revoke execute on function public.delete_document(p_user_id uuid, p_doc_id uuid) from public;
grant execute on function public.delete_document(p_user_id uuid, p_doc_id uuid) to authenticated;
revoke execute on function public.delete_lancamento(p_user_id uuid, p_lancamento_id uuid) from public;
grant execute on function public.delete_lancamento(p_user_id uuid, p_lancamento_id uuid) to authenticated;
revoke execute on function public.delete_org_position(p_user_id uuid, p_position_id uuid) from public;
grant execute on function public.delete_org_position(p_user_id uuid, p_position_id uuid) to authenticated;
revoke execute on function public.delete_workspace(p_user_id uuid, p_workspace_id uuid) from public;
grant execute on function public.delete_workspace(p_user_id uuid, p_workspace_id uuid) to authenticated;
revoke execute on function public.descartar_extrato(p_user_id uuid, p_org_id uuid, p_import_ref text, p_motivo text) from public;
grant execute on function public.descartar_extrato(p_user_id uuid, p_org_id uuid, p_import_ref text, p_motivo text) to authenticated;
revoke execute on function public.desfazer_conciliacao_btg(p_user_id uuid, p_movement_id uuid) from public;
grant execute on function public.desfazer_conciliacao_btg(p_user_id uuid, p_movement_id uuid) to authenticated;
revoke execute on function public.excluir_transferencia(p_user_id uuid, p_transferencia_id uuid) from public;
grant execute on function public.excluir_transferencia(p_user_id uuid, p_transferencia_id uuid) to authenticated;
revoke execute on function public.get_chat_conversation(p_user_id uuid, p_other_id uuid, p_org_id uuid) from public;
grant execute on function public.get_chat_conversation(p_user_id uuid, p_other_id uuid, p_org_id uuid) to authenticated;
revoke execute on function public.get_unread_counts(p_user_id uuid, p_org_id uuid) from public;
grant execute on function public.get_unread_counts(p_user_id uuid, p_org_id uuid) to authenticated;
revoke execute on function public.ignorar_btg_movimento(p_user_id uuid, p_movement_id uuid) from public;
grant execute on function public.ignorar_btg_movimento(p_user_id uuid, p_movement_id uuid) to authenticated;
revoke execute on function public.impacto_excluir_lancamento(p_user_id uuid, p_lancamento_id uuid) from public;
grant execute on function public.impacto_excluir_lancamento(p_user_id uuid, p_lancamento_id uuid) to authenticated;
revoke execute on function public.import_extrato(p_user_id uuid, p_org_id uuid, p_rows jsonb) from public;
grant execute on function public.import_extrato(p_user_id uuid, p_org_id uuid, p_rows jsonb) to authenticated;
revoke execute on function public.lancar_midia(p_user_id uuid, p_midia_id uuid, p_conta_id uuid, p_categoria text, p_centro_custo text, p_forma text) from public;
grant execute on function public.lancar_midia(p_user_id uuid, p_midia_id uuid, p_conta_id uuid, p_categoria text, p_centro_custo text, p_forma text) to authenticated;
revoke execute on function public.liquidar_lancamento(p_user_id uuid, p_lancamento_id uuid, p_data jsonb) from public;
grant execute on function public.liquidar_lancamento(p_user_id uuid, p_lancamento_id uuid, p_data jsonb) to authenticated;
revoke execute on function public.log_system_error(p_user_id uuid, p_context text, p_message text, p_detail text, p_activity_id uuid) from public;
grant execute on function public.log_system_error(p_user_id uuid, p_context text, p_message text, p_detail text, p_activity_id uuid) to authenticated;
revoke execute on function public.marcar_fechamento_enviado(p_org_id uuid, p_competencia text, p_user_id uuid, p_destinatarios text[], p_erro text) from public;
grant execute on function public.marcar_fechamento_enviado(p_org_id uuid, p_competencia text, p_user_id uuid, p_destinatarios text[], p_erro text) to authenticated;
revoke execute on function public.marcar_lancamento_revisado(p_user_id uuid, p_lancamento_id uuid) from public;
grant execute on function public.marcar_lancamento_revisado(p_user_id uuid, p_lancamento_id uuid) to authenticated;
revoke execute on function public.mark_chat_read(p_user_id uuid, p_other_id uuid, p_org_id uuid) from public;
grant execute on function public.mark_chat_read(p_user_id uuid, p_other_id uuid, p_org_id uuid) to authenticated;
revoke execute on function public.move_activity(p_user_id uuid, p_activity_id uuid, p_new_campaign_id uuid) from public;
grant execute on function public.move_activity(p_user_id uuid, p_activity_id uuid, p_new_campaign_id uuid) to authenticated;
revoke execute on function public.move_document(p_user_id uuid, p_doc_id uuid, p_parent_id uuid, p_workspace_id uuid) from public;
grant execute on function public.move_document(p_user_id uuid, p_doc_id uuid, p_parent_id uuid, p_workspace_id uuid) to authenticated;
revoke execute on function public.notify_drive_sync(p_user_id uuid, p_campaign_id uuid) from public;
grant execute on function public.notify_drive_sync(p_user_id uuid, p_campaign_id uuid) to authenticated;
revoke execute on function public.pode_mover_status(p_user_id uuid, p_activity_id uuid) from public;
grant execute on function public.pode_mover_status(p_user_id uuid, p_activity_id uuid) to authenticated;
revoke execute on function public.promover_extrato(p_user_id uuid, p_org_id uuid, p_import_ref text, p_dados jsonb) from public;
grant execute on function public.promover_extrato(p_user_id uuid, p_org_id uuid, p_import_ref text, p_dados jsonb) to authenticated;
revoke execute on function public.promover_extrato_previstos(p_user_id uuid, p_org_id uuid) from public;
grant execute on function public.promover_extrato_previstos(p_user_id uuid, p_org_id uuid) to authenticated;
revoke execute on function public.reabrir_lancamento(p_user_id uuid, p_lancamento_id uuid) from public;
grant execute on function public.reabrir_lancamento(p_user_id uuid, p_lancamento_id uuid) to authenticated;
revoke execute on function public.recur_activity(p_user_id uuid, p_activity_id uuid) from public;
grant execute on function public.recur_activity(p_user_id uuid, p_activity_id uuid) to authenticated;
revoke execute on function public.regerar_lancamentos_midias(p_user_id uuid, p_org_id uuid) from public;
grant execute on function public.regerar_lancamentos_midias(p_user_id uuid, p_org_id uuid) to authenticated;
revoke execute on function public.remove_member(p_user_id uuid, p_org_id uuid, p_member_id uuid) from public;
grant execute on function public.remove_member(p_user_id uuid, p_org_id uuid, p_member_id uuid) to authenticated;
revoke execute on function public.resolve_system_error(p_user_id uuid, p_error_id uuid, p_resolved boolean) from public;
grant execute on function public.resolve_system_error(p_user_id uuid, p_error_id uuid, p_resolved boolean) to authenticated;
revoke execute on function public.ressincronizar_lancamento(p_user_id uuid, p_lancamento_id uuid) from public;
grant execute on function public.ressincronizar_lancamento(p_user_id uuid, p_lancamento_id uuid) to authenticated;
revoke execute on function public.restaurar_extrato(p_user_id uuid, p_org_id uuid, p_import_ref text) from public;
grant execute on function public.restaurar_extrato(p_user_id uuid, p_org_id uuid, p_import_ref text) to authenticated;
revoke execute on function public.salvar_config_contabil(p_org_id uuid, p_user_id uuid, p_emails text[], p_dia integer, p_ativo boolean) from public;
grant execute on function public.salvar_config_contabil(p_org_id uuid, p_user_id uuid, p_emails text[], p_dia integer, p_ativo boolean) to authenticated;
revoke execute on function public.search_activities(p_user_id uuid, p_org_id uuid, p_query text, p_include_archived boolean) from public;
grant execute on function public.search_activities(p_user_id uuid, p_org_id uuid, p_query text, p_include_archived boolean) to authenticated;
revoke execute on function public.seed_finance_from_extrato(p_user_id uuid, p_org_id uuid, p_contas jsonb, p_centros jsonb, p_categorias jsonb) from public;
grant execute on function public.seed_finance_from_extrato(p_user_id uuid, p_org_id uuid, p_contas jsonb, p_centros jsonb, p_categorias jsonb) to authenticated;
revoke execute on function public.seed_finance_from_extrato_table(p_user_id uuid, p_org_id uuid) from public;
grant execute on function public.seed_finance_from_extrato_table(p_user_id uuid, p_org_id uuid) to authenticated;
revoke execute on function public.send_chat_message(p_user_id uuid, p_recipient_id uuid, p_org_id uuid, p_content text) from public;
grant execute on function public.send_chat_message(p_user_id uuid, p_recipient_id uuid, p_org_id uuid, p_content text) to authenticated;
revoke execute on function public.set_activity_archived(p_user_id uuid, p_activity_id uuid, p_archived boolean) from public;
grant execute on function public.set_activity_archived(p_user_id uuid, p_activity_id uuid, p_archived boolean) to authenticated;
revoke execute on function public.set_activity_checklist(p_user_id uuid, p_activity_id uuid, p_items jsonb) from public;
grant execute on function public.set_activity_checklist(p_user_id uuid, p_activity_id uuid, p_items jsonb) to authenticated;
revoke execute on function public.set_activity_drive(p_user_id uuid, p_activity_id uuid, p_drive_folder_id text, p_drive_path text, p_drive_folder_url text, p_redacao_url text, p_finalizacao_url text, p_preview_url text) from public;
grant execute on function public.set_activity_drive(p_user_id uuid, p_activity_id uuid, p_drive_folder_id text, p_drive_path text, p_drive_folder_url text, p_redacao_url text, p_finalizacao_url text, p_preview_url text) to authenticated;
revoke execute on function public.set_activity_extra_links(p_user_id uuid, p_activity_id uuid, p_links jsonb) from public;
grant execute on function public.set_activity_extra_links(p_user_id uuid, p_activity_id uuid, p_links jsonb) to authenticated;
revoke execute on function public.set_activity_mute(p_user_id uuid, p_activity_id uuid, p_muted boolean) from public;
grant execute on function public.set_activity_mute(p_user_id uuid, p_activity_id uuid, p_muted boolean) to authenticated;
revoke execute on function public.set_activity_recurrence(p_user_id uuid, p_activity_id uuid, p_recurrence text, p_remaining integer, p_reset_status text) from public;
grant execute on function public.set_activity_recurrence(p_user_id uuid, p_activity_id uuid, p_recurrence text, p_remaining integer, p_reset_status text) to authenticated;
revoke execute on function public.set_campaign_archived(p_user_id uuid, p_campaign_id uuid, p_archived boolean) from public;
grant execute on function public.set_campaign_archived(p_user_id uuid, p_campaign_id uuid, p_archived boolean) to authenticated;
revoke execute on function public.set_campaign_drive(p_user_id uuid, p_campaign_id uuid, p_drive_folder_id text) from public;
grant execute on function public.set_campaign_drive(p_user_id uuid, p_campaign_id uuid, p_drive_folder_id text) to authenticated;
revoke execute on function public.set_conta_favorita(p_user_id uuid, p_conta_id uuid) from public;
grant execute on function public.set_conta_favorita(p_user_id uuid, p_conta_id uuid) to authenticated;
revoke execute on function public.set_digest_enabled(p_user_id uuid, p_enabled boolean) from public;
grant execute on function public.set_digest_enabled(p_user_id uuid, p_enabled boolean) to authenticated;
revoke execute on function public.set_document_archived(p_user_id uuid, p_doc_id uuid, p_archived boolean) from public;
grant execute on function public.set_document_archived(p_user_id uuid, p_doc_id uuid, p_archived boolean) to authenticated;
revoke execute on function public.set_document_briefing(p_user_id uuid, p_doc_id uuid, p_kind text, p_target_id uuid) from public;
grant execute on function public.set_document_briefing(p_user_id uuid, p_doc_id uuid, p_kind text, p_target_id uuid) to authenticated;
revoke execute on function public.set_document_visibility(p_user_id uuid, p_doc_id uuid, p_visibility text, p_member_ids uuid[]) from public;
grant execute on function public.set_document_visibility(p_user_id uuid, p_doc_id uuid, p_visibility text, p_member_ids uuid[]) to authenticated;
revoke execute on function public.set_document_workspace(p_user_id uuid, p_doc_id uuid, p_workspace_id uuid) from public;
grant execute on function public.set_document_workspace(p_user_id uuid, p_doc_id uuid, p_workspace_id uuid) to authenticated;
revoke execute on function public.set_finance_config(p_user_id uuid, p_org_id uuid, p_categorias jsonb, p_centros jsonb) from public;
grant execute on function public.set_finance_config(p_user_id uuid, p_org_id uuid, p_categorias jsonb, p_centros jsonb) to authenticated;
revoke execute on function public.set_fornecedor_archived(p_user_id uuid, p_fornecedor_id uuid, p_archived boolean) from public;
grant execute on function public.set_fornecedor_archived(p_user_id uuid, p_fornecedor_id uuid, p_archived boolean) to authenticated;
revoke execute on function public.set_lancamento_anexos(p_user_id uuid, p_lancamento_id uuid, p_anexos jsonb) from public;
grant execute on function public.set_lancamento_anexos(p_user_id uuid, p_lancamento_id uuid, p_anexos jsonb) to authenticated;
revoke execute on function public.set_lancamento_flags(p_user_id uuid, p_lancamento_id uuid, p_nf boolean, p_boleto boolean) from public;
grant execute on function public.set_lancamento_flags(p_user_id uuid, p_lancamento_id uuid, p_nf boolean, p_boleto boolean) to authenticated;
revoke execute on function public.set_lancamento_situacao(p_user_id uuid, p_lancamento_id uuid, p_situacao text) from public;
grant execute on function public.set_lancamento_situacao(p_user_id uuid, p_lancamento_id uuid, p_situacao text) to authenticated;
revoke execute on function public.set_member_avatar(p_user_id uuid, p_org_id uuid, p_target uuid, p_avatar_url text) from public;
grant execute on function public.set_member_avatar(p_user_id uuid, p_org_id uuid, p_target uuid, p_avatar_url text) to authenticated;
revoke execute on function public.set_midia_anexos(p_user_id uuid, p_midia_id uuid, p_anexos jsonb) from public;
grant execute on function public.set_midia_anexos(p_user_id uuid, p_midia_id uuid, p_anexos jsonb) to authenticated;
revoke execute on function public.set_midia_archived(p_user_id uuid, p_midia_id uuid, p_archived boolean) from public;
grant execute on function public.set_midia_archived(p_user_id uuid, p_midia_id uuid, p_archived boolean) to authenticated;
revoke execute on function public.set_midia_situacao(p_user_id uuid, p_midia_id uuid, p_situacao text) from public;
grant execute on function public.set_midia_situacao(p_user_id uuid, p_midia_id uuid, p_situacao text) to authenticated;
revoke execute on function public.set_org_docs(p_user_id uuid, p_org_id uuid, p_agency jsonb, p_nf_notes jsonb, p_midia_notes jsonb) from public;
grant execute on function public.set_org_docs(p_user_id uuid, p_org_id uuid, p_agency jsonb, p_nf_notes jsonb, p_midia_notes jsonb) to authenticated;
revoke execute on function public.set_org_payment_info(p_user_id uuid, p_org_id uuid, p_info text) from public;
grant execute on function public.set_org_payment_info(p_user_id uuid, p_org_id uuid, p_info text) to authenticated;
revoke execute on function public.set_org_review_gates(p_user_id uuid, p_org_id uuid, p_gates jsonb) from public;
grant execute on function public.set_org_review_gates(p_user_id uuid, p_org_id uuid, p_gates jsonb) to authenticated;
revoke execute on function public.set_producao_anexos(p_user_id uuid, p_producao_id uuid, p_anexos jsonb) from public;
grant execute on function public.set_producao_anexos(p_user_id uuid, p_producao_id uuid, p_anexos jsonb) to authenticated;
revoke execute on function public.set_producao_archived(p_user_id uuid, p_producao_id uuid, p_archived boolean) from public;
grant execute on function public.set_producao_archived(p_user_id uuid, p_producao_id uuid, p_archived boolean) to authenticated;
revoke execute on function public.set_producao_situacao(p_user_id uuid, p_producao_id uuid, p_situacao text, p_conta_id uuid, p_categoria text, p_centro_custo text, p_forma text) from public;
grant execute on function public.set_producao_situacao(p_user_id uuid, p_producao_id uuid, p_situacao text, p_conta_id uuid, p_categoria text, p_centro_custo text, p_forma text) to authenticated;
revoke execute on function public.set_redacao_review(p_user_id uuid, p_activity_id uuid, p_status text, p_errors jsonb, p_target text) from public;
grant execute on function public.set_redacao_review(p_user_id uuid, p_activity_id uuid, p_status text, p_errors jsonb, p_target text) to authenticated;
revoke execute on function public.set_review(p_user_id uuid, p_activity_id uuid, p_kind text, p_status text, p_errors jsonb, p_target text) from public;
grant execute on function public.set_review(p_user_id uuid, p_activity_id uuid, p_kind text, p_status text, p_errors jsonb, p_target text) to authenticated;
revoke execute on function public.set_veiculo_archived(p_user_id uuid, p_veiculo_id uuid, p_archived boolean) from public;
grant execute on function public.set_veiculo_archived(p_user_id uuid, p_veiculo_id uuid, p_archived boolean) to authenticated;
revoke execute on function public.set_workspace_archived(p_user_id uuid, p_workspace_id uuid, p_archived boolean) from public;
grant execute on function public.set_workspace_archived(p_user_id uuid, p_workspace_id uuid, p_archived boolean) to authenticated;
revoke execute on function public.toggle_activity_assignee(p_user_id uuid, p_activity_id uuid, p_assignee_id uuid) from public;
grant execute on function public.toggle_activity_assignee(p_user_id uuid, p_activity_id uuid, p_assignee_id uuid) to authenticated;
revoke execute on function public.toggle_comment_reaction(p_user_id uuid, p_comment_id uuid, p_emoji text) from public;
grant execute on function public.toggle_comment_reaction(p_user_id uuid, p_comment_id uuid, p_emoji text) to authenticated;
revoke execute on function public.touch_presence(p_user_id uuid) from public;
grant execute on function public.touch_presence(p_user_id uuid) to authenticated;
revoke execute on function public.update_activity_dates(p_user_id uuid, p_activity_id uuid, p_start_date date, p_due_date date) from public;
grant execute on function public.update_activity_dates(p_user_id uuid, p_activity_id uuid, p_start_date date, p_due_date date) to authenticated;
revoke execute on function public.update_activity_field(p_user_id uuid, p_activity_id uuid, p_field text, p_value text) from public;
grant execute on function public.update_activity_field(p_user_id uuid, p_activity_id uuid, p_field text, p_value text) to authenticated;
revoke execute on function public.update_activity_links(p_user_id uuid, p_activity_id uuid, p_drive_folder_url text, p_redacao_url text, p_layout_url text, p_finalizacao_url text, p_orcamento text) from public;
grant execute on function public.update_activity_links(p_user_id uuid, p_activity_id uuid, p_drive_folder_url text, p_redacao_url text, p_layout_url text, p_finalizacao_url text, p_orcamento text) to authenticated;
revoke execute on function public.update_activity_status(p_user_id uuid, p_activity_id uuid, p_new_status activity_status, p_comment text) from public;
grant execute on function public.update_activity_status(p_user_id uuid, p_activity_id uuid, p_new_status activity_status, p_comment text) to authenticated;
revoke execute on function public.update_campaign(p_user_id uuid, p_campaign_id uuid, p_name text, p_description text, p_start_date date, p_end_date date) from public;
grant execute on function public.update_campaign(p_user_id uuid, p_campaign_id uuid, p_name text, p_description text, p_start_date date, p_end_date date) to authenticated;
revoke execute on function public.update_comment(p_user_id uuid, p_comment_id uuid, p_content text) from public;
grant execute on function public.update_comment(p_user_id uuid, p_comment_id uuid, p_content text) to authenticated;
revoke execute on function public.update_conta_financeira(p_user_id uuid, p_conta_id uuid, p_data jsonb) from public;
grant execute on function public.update_conta_financeira(p_user_id uuid, p_conta_id uuid, p_data jsonb) to authenticated;
revoke execute on function public.update_document_content(p_user_id uuid, p_doc_id uuid, p_content jsonb) from public;
grant execute on function public.update_document_content(p_user_id uuid, p_doc_id uuid, p_content jsonb) to authenticated;
revoke execute on function public.update_document_title(p_user_id uuid, p_doc_id uuid, p_title text) from public;
grant execute on function public.update_document_title(p_user_id uuid, p_doc_id uuid, p_title text) to authenticated;
revoke execute on function public.update_fornecedor(p_user_id uuid, p_fornecedor_id uuid, p_data jsonb) from public;
grant execute on function public.update_fornecedor(p_user_id uuid, p_fornecedor_id uuid, p_data jsonb) to authenticated;
revoke execute on function public.update_lancamento(p_user_id uuid, p_lancamento_id uuid, p_data jsonb) from public;
grant execute on function public.update_lancamento(p_user_id uuid, p_lancamento_id uuid, p_data jsonb) to authenticated;
revoke execute on function public.update_lancamentos_lote(p_user_id uuid, p_ids uuid[], p_data jsonb) from public;
grant execute on function public.update_lancamentos_lote(p_user_id uuid, p_ids uuid[], p_data jsonb) to authenticated;
revoke execute on function public.update_member(p_user_id uuid, p_org_id uuid, p_member_id uuid, p_position_id uuid, p_role member_role, p_can_finance boolean, p_can_vendas boolean) from public;
grant execute on function public.update_member(p_user_id uuid, p_org_id uuid, p_member_id uuid, p_position_id uuid, p_role member_role, p_can_finance boolean, p_can_vendas boolean) to authenticated;
revoke execute on function public.update_midia(p_user_id uuid, p_midia_id uuid, p_data jsonb) from public;
grant execute on function public.update_midia(p_user_id uuid, p_midia_id uuid, p_data jsonb) to authenticated;
revoke execute on function public.update_org_position(p_user_id uuid, p_position_id uuid, p_name text, p_color text, p_allowed_statuses activity_status[], p_op_ver_tudo boolean, p_op_midias boolean, p_op_producao boolean) from public;
grant execute on function public.update_org_position(p_user_id uuid, p_position_id uuid, p_name text, p_color text, p_allowed_statuses activity_status[], p_op_ver_tudo boolean, p_op_midias boolean, p_op_producao boolean) to authenticated;
revoke execute on function public.update_producao(p_user_id uuid, p_producao_id uuid, p_data jsonb) from public;
grant execute on function public.update_producao(p_user_id uuid, p_producao_id uuid, p_data jsonb) to authenticated;
revoke execute on function public.update_veiculo(p_user_id uuid, p_veiculo_id uuid, p_data jsonb) from public;
grant execute on function public.update_veiculo(p_user_id uuid, p_veiculo_id uuid, p_data jsonb) to authenticated;
revoke execute on function public.update_workspace(p_user_id uuid, p_workspace_id uuid, p_name text, p_description text, p_color text) from public;
grant execute on function public.update_workspace(p_user_id uuid, p_workspace_id uuid, p_name text, p_description text, p_color text) to authenticated;
revoke execute on function public.update_workspace_cadastro(p_user_id uuid, p_workspace_id uuid, p_data jsonb) from public;
grant execute on function public.update_workspace_cadastro(p_user_id uuid, p_workspace_id uuid, p_data jsonb) to authenticated;
revoke execute on function public.upsert_inventario_pontos(p_user_id uuid, p_org_id uuid, p_veiculo_id uuid, p_formato text, p_pontos jsonb) from public;
grant execute on function public.upsert_inventario_pontos(p_user_id uuid, p_org_id uuid, p_veiculo_id uuid, p_formato text, p_pontos jsonb) to authenticated;
revoke execute on function public.upsert_invite_link(p_user_id uuid, p_org_id uuid, p_role member_role) from public;
grant execute on function public.upsert_invite_link(p_user_id uuid, p_org_id uuid, p_role member_role) to authenticated;
revoke execute on function public.upsert_org_settings(p_user_id uuid, p_org_id uuid, p_logo_url text, p_accent_color text, p_status_overrides jsonb) from public;
grant execute on function public.upsert_org_settings(p_user_id uuid, p_org_id uuid, p_logo_url text, p_accent_color text, p_status_overrides jsonb) to authenticated;

notify pgrst, 'reload schema';
