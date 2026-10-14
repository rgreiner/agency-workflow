-- 343_portal_quadro_e_legendas.sql
-- Portal do cliente, terceira volta (14/10/2026). Decisões do Rafael:
--   A) QUADRO (kanban) como tela separada — visão completa por fase;
--   B) aprovação mostra cada peça JUNTO da legenda dela (texto da Redação);
--   C) o cliente contribui por "Solicitar alteração": caixa de texto (+ anexos,
--      que vão para a pasta Links da tarefa). Não muda o status: avisa o
--      atendimento, como as respostas.
-- Idempotente. Funções novas fechadas explicitamente no fim.

-- ── 1. Painel ganha "alteração enviada" por card ────────────────────────────
create or replace function portal_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pu portal_users; v_org_nome text;
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select o.name into v_org_nome from organizations o where o.id = v_pu.org_id;

  return jsonb_build_object(
    'usuario', jsonb_build_object('nome', v_pu.nome, 'email', v_pu.email),
    'preview', v_pu.interno_user_id is not null,
    'agencia', v_org_nome,
    'cliente', (select jsonb_build_object('nome', w.name) from workspaces w where w.id = v_pu.workspace_id),

    -- Trabalhos em aberto: fase, prazo e desde quando estão parados com o cliente.
    'tarefas', coalesce((
      select jsonb_agg(t order by t->>'campanha', t->>'titulo')
      from (
        select jsonb_build_object(
          'id', a.id, 'titulo', a.title, 'campanha', c.name,
          'coluna', case a.status when 'pendente_cliente' then 'pendente'
                                  when 'aprovacao_cliente' then 'aprovacao' else 'agencia' end,
          'fase', portal_fase(a.status),
          'prazo', a.due_date,
          'desde', coalesce(portal_no_status_desde(a.id, a.status), a.updated_at),
          -- Decisão só conta na rodada ATUAL de aprovação.
          'decidido', case when a.status = 'aprovacao_cliente' then (
              select e.kind from portal_entries e
               where e.activity_id = a.id and e.kind in ('aprovacao','ajuste')
                 and e.created_at >= portal_ciclo_desde(a.id)
               order by e.created_at desc limit 1) end,
          -- Último pedido de alteração feito pelo quadro (mig. 343) nesta fase.
          'alteracao_em', (
              select max(e.created_at) from portal_entries e
               where e.activity_id = a.id and e.kind = 'ajuste'
                 and e.created_at >= coalesce(portal_no_status_desde(a.id, a.status), '-infinity'::timestamptz)),
          'respondido', case when a.status = 'pendente_cliente' then exists (
              select 1 from portal_entries e
               where e.activity_id = a.id and e.kind = 'resposta'
                 and e.created_at >= coalesce(portal_no_status_desde(a.id, 'pendente_cliente'), '-infinity'::timestamptz)) end
        ) as t
        from activities a join campaigns c on c.id = a.campaign_id
        where c.workspace_id = v_pu.workspace_id
          and not a.archived and not c.archived and a.status <> 'concluido'
      ) sub
    ), '[]'::jsonb),

    -- Entregues nos últimos 30 dias (arquivada também conta: o arquivamento é
    -- faxina da agência, não desfaz a entrega).
    'entregues', coalesce((
      select jsonb_agg(x order by x->>'em' desc)
      from (
        select jsonb_build_object('id', a.id, 'titulo', a.title, 'campanha', c.name,
                 'em', coalesce(portal_no_status_desde(a.id, 'concluido'), a.updated_at)) as x
        from activities a join campaigns c on c.id = a.campaign_id
        where c.workspace_id = v_pu.workspace_id and a.status = 'concluido'
          and coalesce(portal_no_status_desde(a.id, 'concluido'), a.updated_at) >= now() - interval '30 days'
        limit 60
      ) s
    ), '[]'::jsonb),

    -- Orçamentos publicados: em aberto (decisão) + decididos nos últimos 60 dias.
    'orcamentos', coalesce((
      select jsonb_agg(o order by o->>'publicado_em' desc)
      from (
        select jsonb_build_object(
          'id', p.id, 'titulo', p.titulo, 'numero', p.numero, 'serie', p.serie,
          -- producao.valor é o "a faturar"; o cliente vê o total com honorários.
          'valor', round(coalesce(p.valor, 0) * (1 + coalesce(p.honorarios_pct, 0) / 100), 2),
          'emissao', p.emissao,
          'publicado_em', p.portal_publicado_em,
          'estado', case
            when p.situacao = 'em_aberto' and p.portal_decisao = 'ajuste'
                 and p.portal_decidido_em >= p.portal_publicado_em then 'ajuste'
            when p.situacao = 'em_aberto' then 'aguardando'
            else 'aprovado' end
        ) as o
        from producao p
        where p.workspace_id = v_pu.workspace_id and p.tipo = 'orcamento' and not p.archived
          and p.portal_publicado_em is not null and p.situacao <> 'cancelado'
          and (p.situacao = 'em_aberto' or p.updated_at >= now() - interval '60 days')
      ) s
    ), '[]'::jsonb),

    -- Última reunião publicada e o que ficou em aberto dos dois lados.
    'reuniao', (
      select jsonb_build_object(
        'id', r.id, 'titulo', r.titulo, 'realizada_em', r.realizada_em,
        'passos', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'texto', ps.texto, 'responsavel', ps.responsavel,
                   'em_andamento', ps.activity_id is not null or ps.producao_id is not null or ps.todo_id is not null)
                 order by ps.ordem, ps.created_at)
          from reuniao_passos ps
          where ps.reuniao_id = r.id and ps.feito_em is null
        ), '[]'::jsonb))
      from reunioes r
      where r.workspace_id = v_pu.workspace_id and r.publicada
      order by r.realizada_em desc, r.created_at desc limit 1
    )
  );
end $$;

-- ── 2. Tela de aprovação: devolve também o link da Redação ──────────────────
-- O link NUNCA vai para o navegador do cliente: o servidor lê o documento e
-- entrega só o trecho "Legenda" de cada peça.
create or replace function portal_aprovacao(p_activity_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pu portal_users; v_row jsonb;
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode='42501'; end if;

  select jsonb_build_object(
    'id', a.id, 'titulo', a.title, 'campanha', c.name,
    'pasta_ref', a.drive_folder_id,
    'redacao_ref', a.redacao_url,
    'decisao', (
      select jsonb_build_object('kind', e.kind, 'mensagem', e.mensagem, 'em', e.created_at)
      from portal_entries e
      where e.activity_id = a.id and e.kind in ('aprovacao','ajuste')
        and e.created_at >= portal_ciclo_desde(a.id)
      order by e.created_at desc limit 1
    )
  ) into v_row
  from activities a join campaigns c on c.id = a.campaign_id
  where a.id = p_activity_id and c.workspace_id = v_pu.workspace_id
    and a.status = 'aprovacao_cliente' and not a.archived and not c.archived;

  if v_row is null then raise exception 'Trabalho indisponível'; end if;
  return v_row;
end $$;

-- ── 3. Card do quadro: o que o cliente pode pedir ───────────────────────────
create or replace function portal_card(p_activity_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pu portal_users; v_row jsonb;
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode='42501'; end if;
  select jsonb_build_object('id', a.id, 'titulo', a.title, 'campanha', c.name,
                            'fase', portal_fase(a.status), 'prazo', a.due_date)
    into v_row
    from activities a join campaigns c on c.id = a.campaign_id
   where a.id = p_activity_id and c.workspace_id = v_pu.workspace_id
     and not a.archived and not c.archived
     and a.status not in ('concluido', 'aprovacao_cliente');
  if v_row is null then raise exception 'Trabalho indisponível'; end if;
  return v_row;
end $$;

-- Pedido de alteração fora da aprovação. Devolve a pasta para o servidor subir
-- os anexos na Links (o navegador não recebe a ref).
create or replace function portal_solicitar_alteracao(p_activity_id uuid, p_mensagem text, p_anexos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pu portal_users; v_act activities; v_entry uuid;
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode='42501'; end if;
  if v_pu.interno_user_id is not null then raise exception 'Modo visualização: só o cliente pede alteração'; end if;
  if coalesce(btrim(p_mensagem), '') = '' then raise exception 'Descreva a alteração'; end if;

  select a.* into v_act
    from activities a join campaigns c on c.id = a.campaign_id
   where a.id = p_activity_id and c.workspace_id = v_pu.workspace_id
     and not a.archived and not c.archived
     and a.status not in ('concluido', 'aprovacao_cliente');
  if v_act.id is null then raise exception 'Trabalho indisponível'; end if;

  insert into portal_entries (org_id, workspace_id, portal_user_id, kind, activity_id, mensagem, anexos)
  values (v_pu.org_id, v_pu.workspace_id, v_pu.id, 'ajuste', v_act.id, btrim(p_mensagem),
          coalesce(p_anexos, '[]'::jsonb))
  returning id into v_entry;

  -- Mesma régua do pedido de ajuste na aprovação: quem atende o cliente recebe.
  perform portal_notificar(v_pu.org_id, 'aprovacao_cliente'::text, 'portal_ajuste', v_act.id,
    jsonb_build_object('cliente', v_pu.nome, 'entry_id', v_entry,
                       'preview', left(btrim(p_mensagem), 140), 'pecas', 0));

  return jsonb_build_object('entry_id', v_entry, 'pasta_ref', v_act.drive_folder_id,
                            'org_id', v_pu.org_id, 'workspace_id', v_pu.workspace_id);
end $$;

-- ── 4. Privilégios ───────────────────────────────────────────────────────────
revoke execute on function portal_dashboard() from public, anon, authenticated;
grant  execute on function portal_dashboard() to portal;
revoke execute on function portal_aprovacao(uuid) from public, anon, authenticated;
grant  execute on function portal_aprovacao(uuid) to portal;
revoke execute on function portal_card(uuid) from public, anon, authenticated;
grant  execute on function portal_card(uuid) to portal;
revoke execute on function portal_solicitar_alteracao(uuid, text, jsonb) from public, anon, authenticated;
grant  execute on function portal_solicitar_alteracao(uuid, text, jsonb) to portal;

notify pgrst, 'reload schema';
