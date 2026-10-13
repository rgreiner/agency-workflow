-- 342_portal_reuniao_orcamento_convite.sql
-- Portal do cliente, segunda volta (13/10/2026). Decisões do Rafael:
--   A) datas de entrega aparecem para o cliente (transparência);
--   B) orçamento aprovado no portal MUDA a situação para 'aprovado' e avisa
--      atendimento, gerentes e dono;
--   C) acesso por LINK DE CADASTRO: a agência manda o link, o cliente preenche
--      nome, e-mail e senha e já entra no painel daquele cliente.
-- E duas peças para a tela virar abertura de reunião:
--   • "ver como cliente": quem gere o portal abre o painel do cliente sem a
--     senha dele (contato INTERNO, só leitura);
--   • painel novo: decisões, próximas entregas, fases, entregues, última reunião.
-- Mais o aviso diário por e-mail ao cliente quando algo novo chega para ele.
--
-- Idempotente. Toda função nasce chamável por anon/authenticated (DEFAULT
-- PRIVILEGES deste banco) — cada uma é fechada explicitamente no fim.

-- ── 1. Colunas novas ─────────────────────────────────────────────────────────

-- Contato INTERNO = membro vendo o painel como o cliente vê. Nunca loga por
-- e-mail/senha, nunca recebe aviso, não aparece na lista de acessos.
alter table portal_users add column if not exists interno_user_id uuid;
-- Último aviso por e-mail enviado ao contato (o próximo só lista o que é novo).
alter table portal_users add column if not exists aviso_em timestamptz;
-- Por onde a pessoa entrou (convite por link) — rastreio, não regra.
alter table portal_users add column if not exists convite_id uuid;
create unique index if not exists portal_users_interno_uq
  on portal_users (workspace_id, interno_user_id) where interno_user_id is not null;

-- Orçamento no portal: só aparece depois que a agência publica. Decisão do
-- cliente vale por PUBLICAÇÃO (republicar abre nova rodada).
alter table producao add column if not exists portal_publicado_em timestamptz;
alter table producao add column if not exists portal_decisao text;
alter table producao add column if not exists portal_decidido_em timestamptz;
alter table producao add column if not exists portal_decidido_por uuid references portal_users(id) on delete set null;
alter table producao add column if not exists portal_decisao_ip text;
do $$ begin
  alter table producao add constraint producao_portal_decisao_chk
    check (portal_decisao is null or portal_decisao in ('aprovado','ajuste'));
exception when duplicate_object then null; end $$;

-- Entrada do cliente pode ser sobre um orçamento (aceite/ajuste).
alter table portal_entries add column if not exists producao_id uuid references producao(id) on delete set null;

-- ── 2. Convite por link ──────────────────────────────────────────────────────
-- Um link ATIVO por cliente (gerar outro revoga o anterior). Multiuso: várias
-- pessoas do cliente podem se cadastrar pelo mesmo link enquanto valer.
create table if not exists portal_convites (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  token        text not null unique,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '30 days',
  revogado_em  timestamptz,
  usos         integer not null default 0
);
create index if not exists portal_convites_ws_idx on portal_convites (workspace_id) where revogado_em is null;
alter table portal_convites enable row level security;
-- O token mora na tabela: só quem gere o portal enxerga.
drop policy if exists portal_convites_gerir on portal_convites;
create policy portal_convites_gerir on portal_convites for all to authenticated
  using (portal_pode_gerir(org_id)) with check (portal_pode_gerir(org_id));
revoke all on portal_convites from anon, portal;
grant select, insert, update on portal_convites to authenticated;

-- ── 3. Fase do trabalho (o status interno NUNCA sai do banco) ───────────────
create or replace function portal_fase(p_status text) returns text
language sql immutable as $$
  select case
    when p_status = 'pendente_cliente' then 'Aguardando você'
    when p_status = 'aprovacao_cliente' then 'Sua aprovação'
    when p_status = 'concluido' then 'Entregue'
    when p_status in ('briefing','planejamento','insight') then 'Planejamento'
    when p_status in ('redacao','design','edicao','finalizacao','validacao_de_criacao',
                      'revisao_interna','validacao_atendimento') then 'Criação'
    when p_status in ('orcamento','producao_fornecedores','producao_audiovisual') then 'Produção'
    when p_status in ('validacao_midia','midia','social','implantacao_digital','implantacao_off') then 'Veiculação'
    else 'Em andamento'
  end
$$;

-- Desde quando a tarefa está no status atual (entrada mais recente nele).
create or replace function portal_no_status_desde(p_activity_id uuid, p_status text)
returns timestamptz language sql stable security definer set search_path = public as $$
  select max(h.changed_at) from activity_history h
   where h.activity_id = p_activity_id and h.to_status = p_status
$$;

-- ── 4. Painel ────────────────────────────────────────────────────────────────
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

-- ── 5. Orçamento: tela, PDF e decisão ────────────────────────────────────────

-- Orçamento visível para o contato (publicado, do cliente dele, não cancelado).
create or replace function portal_orcamento_do_contato(p_pu portal_users, p_id uuid)
returns producao language sql stable security definer set search_path = public as $$
  select p.* from producao p
   where p.id = p_id and p.workspace_id = p_pu.workspace_id and p.tipo = 'orcamento'
     and not p.archived and p.portal_publicado_em is not null and p.situacao <> 'cancelado'
$$;

create or replace function portal_orcamento(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pu portal_users; p producao; v_campanha text; v_por text;
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode = '42501'; end if;
  p := portal_orcamento_do_contato(v_pu, p_id);
  if p.id is null then raise exception 'Orçamento indisponível'; end if;
  select name into v_campanha from campaigns where id = p.campaign_id;
  select nome into v_por from portal_users where id = p.portal_decidido_por;

  return jsonb_build_object(
    'id', p.id, 'titulo', p.titulo, 'numero', p.numero, 'serie', p.serie,
    'campanha', v_campanha, 'emissao', p.emissao, 'validade_dias', p.validade_dias,
    'valor', p.valor, 'honorarios_pct', p.honorarios_pct, 'observacao', p.observacao,
    'situacao', case when p.situacao = 'em_aberto' then 'aguardando' else 'aprovado' end,
    -- Itens com a opção ESCOLHIDA pela agência (o PDF mostra todas as opções).
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nome', it->>'nome', 'descricao', it->>'descricao',
               -- Opção escolhida crua: o total sai da MESMA régua do PDF (valoresItem).
               'opcao', (select jsonb_build_object('quant', o->>'quant', 'valor_unit', o->>'valor_unit',
                                                   'valor_total', o->>'valor_total')
                           from jsonb_array_elements(coalesce(it->'opcoes','[]'::jsonb)) o
                          where coalesce(o->>'selecionado','') = 'true' limit 1)))
      from jsonb_array_elements(coalesce(p.detalhe->'itens','[]'::jsonb)) it
    ), '[]'::jsonb),
    'decisao', case when p.portal_decidido_em >= p.portal_publicado_em or p.situacao <> 'em_aberto' then
      jsonb_build_object('kind', coalesce(p.portal_decisao, 'aprovado'), 'em', p.portal_decidido_em, 'por', v_por) end,
    'pode_decidir', p.situacao = 'em_aberto'
      and (p.portal_decidido_em is null or p.portal_decidido_em < p.portal_publicado_em)
      and coalesce(p.valor, 0) > 0
  );
end $$;

-- Pacote para o servidor desenhar o MESMO PDF da agência (lib/pdf/ProducaoDoc).
-- Campos explícitos: comissão, NF, responsável e afins nunca saem daqui.
create or replace function portal_orcamento_doc(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pu portal_users; p producao;
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode = '42501'; end if;
  p := portal_orcamento_do_contato(v_pu, p_id);
  if p.id is null then raise exception 'Orçamento indisponível'; end if;

  return jsonb_build_object(
    'org_id', p.org_id,
    'producao', jsonb_build_object(
      'id', p.id, 'tipo', p.tipo, 'numero', p.numero, 'serie', p.serie, 'titulo', p.titulo,
      'emissao', p.emissao, 'validade_dias', p.validade_dias, 'honorarios_pct', p.honorarios_pct,
      'observacao', p.observacao, 'texto_legal', p.texto_legal,
      'workspace_id', p.workspace_id, 'campaign_id', p.campaign_id,
      'detalhe', jsonb_build_object('itens', coalesce(p.detalhe->'itens', '[]'::jsonb))),
    'workspaces', (select jsonb_build_object(
      'name', w.name, 'legal_name', w.legal_name, 'tax_id', w.tax_id, 'finance_email', w.finance_email,
      'phone', w.phone, 'address_street', w.address_street, 'address_number', w.address_number,
      'address_complement', w.address_complement, 'address_district', w.address_district,
      'address_city', w.address_city, 'address_state', w.address_state, 'address_zip', w.address_zip)
      from workspaces w where w.id = p.workspace_id),
    'campaigns', (select jsonb_build_object('name', c.name) from campaigns c where c.id = p.campaign_id),
    'org_settings', (select jsonb_build_object(
      'logo_url', s.logo_url, 'agency_info', s.agency_info,
      'doc_nf_notes', s.doc_nf_notes, 'doc_midia_notes', s.doc_midia_notes)
      from org_settings s where s.org_id = p.org_id),
    'fornecedores', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name))
      from fornecedores f
      where f.id in (
        select (o->>'fornecedor_id')::uuid
        from jsonb_array_elements(coalesce(p.detalhe->'itens','[]'::jsonb)) it,
             jsonb_array_elements(coalesce(it->'opcoes','[]'::jsonb)) o
        where coalesce(o->>'fornecedor_id','') ~ '^[0-9a-f-]{36}$')
    ), '[]'::jsonb)
  );
end $$;

-- Aceite (situação vira 'aprovado') ou pedido de alteração. Uma decisão por
-- publicação. Devolve QUEM avisar por e-mail (ids — o e-mail o servidor busca).
create or replace function portal_decidir_orcamento(
  p_id uuid, p_decisao text, p_mensagem text, p_ip text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pu portal_users; p producao; v_entry uuid; v_titulo text; v_ids uuid[];
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if v_pu.interno_user_id is not null then raise exception 'Modo visualização: só o cliente decide'; end if;
  if p_decisao not in ('aprovado','ajuste') then raise exception 'Decisão inválida'; end if;
  if p_decisao = 'ajuste' and coalesce(btrim(p_mensagem), '') = '' then raise exception 'Descreva o ajuste'; end if;

  -- Trava a linha: dois cliques (ou duas pessoas do cliente) não decidem duas vezes.
  select * into p from producao
   where id = p_id and workspace_id = v_pu.workspace_id and tipo = 'orcamento'
     and not archived and portal_publicado_em is not null
   for update;
  if p.id is null then raise exception 'Orçamento indisponível'; end if;
  if p.situacao <> 'em_aberto'
     or (p.portal_decidido_em is not null and p.portal_decidido_em >= p.portal_publicado_em) then
    raise exception 'Este orçamento já foi respondido';
  end if;
  if coalesce(p.valor, 0) <= 0 then raise exception 'Orçamento sem valor'; end if;

  update producao set
    situacao = case when p_decisao = 'aprovado' then 'aprovado' else situacao end,
    portal_decisao = p_decisao, portal_decidido_em = now(),
    portal_decidido_por = v_pu.id, portal_decisao_ip = left(p_ip, 64), updated_at = now()
  where id = p.id;

  v_titulo := concat_ws(' ', 'Orçamento', nullif(concat_ws(' ', p.serie, p.numero::text), ''), '·', p.titulo);
  insert into portal_entries (org_id, workspace_id, portal_user_id, kind, producao_id, titulo, mensagem)
  values (v_pu.org_id, v_pu.workspace_id, v_pu.id,
          case when p_decisao = 'aprovado' then 'aprovacao' else 'ajuste' end,
          p.id, v_titulo,
          coalesce(nullif(btrim(p_mensagem), ''), 'Orçamento aprovado pelo cliente.'))
  returning id into v_entry;

  -- Destinatários: responsável pelo orçamento + quem atende cliente (cargo com
  -- aprovacao_cliente) + gerentes e dono.
  select array_agg(distinct m.user_id) into v_ids
    from organization_members m
    left join org_positions pos on pos.id = m.position_id
   where m.org_id = p.org_id
     and (m.role in ('owner','admin','manager')
          or 'aprovacao_cliente' = any(pos.allowed_statuses)
          or m.user_id = p.responsavel_id);

  insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
  select u, p.org_id,
         case when p_decisao = 'aprovado' then 'portal_orcamento_aprovado' else 'portal_orcamento_ajuste' end,
         null::uuid, null::uuid,
         jsonb_build_object('cliente', v_pu.nome, 'titulo', v_titulo, 'entry_id', v_entry,
                            'preview', left(coalesce(btrim(p_mensagem), ''), 140),
                            'href', '/' || (select slug from organizations where id = p.org_id)
                                    || '/producao/orcamento/' || p.id)
    from unnest(coalesce(v_ids, '{}'::uuid[])) u;

  return jsonb_build_object('ok', true, 'titulo', v_titulo,
                            'valor', round(coalesce(p.valor, 0) * (1 + coalesce(p.honorarios_pct, 0) / 100), 2),
                            'contato', v_pu.nome,
                            'cliente', (select name from workspaces where id = p.workspace_id),
                            'slug', (select slug from organizations where id = p.org_id),
                            'destinatarios', to_jsonb(coalesce(v_ids, '{}'::uuid[])));
end $$;

-- Agência publica/retira o orçamento do portal. Republicar abre nova rodada.
create or replace function orcamento_portal_publicar(p_id uuid, p_publicar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare p producao;
begin
  select * into p from producao where id = p_id and tipo = 'orcamento';
  if p.id is null then raise exception 'Orçamento não encontrado'; end if;
  if not exists (
    select 1 from organization_members m where m.org_id = p.org_id and m.user_id = auth.uid()
       and m.role in ('owner','admin','manager')
  ) and not portal_pode_gerir(p.org_id) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if p_publicar and coalesce(p.valor, 0) <= 0 then
    raise exception 'Escolha as opções do orçamento (valor zerado) antes de mostrar ao cliente.';
  end if;
  update producao set portal_publicado_em = case when p_publicar then now() end, updated_at = now()
   where id = p_id;
end $$;

-- ── 6. Ver como cliente ──────────────────────────────────────────────────────
-- Cria (ou reaproveita) o contato INTERNO do membro naquele cliente.
create or replace function portal_preview_abrir(p_workspace uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid; v_nome text;
begin
  select org_id into v_org from workspaces where id = p_workspace;
  if v_org is null or auth.uid() is null or not portal_pode_gerir(v_org) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select coalesce(nullif(full_name, ''), 'Agência') into v_nome from profiles where id = auth.uid();

  select id into v_id from portal_users where workspace_id = p_workspace and interno_user_id = auth.uid();
  if v_id is null then
    insert into portal_users (org_id, workspace_id, nome, email, ativo, created_by, interno_user_id)
    values (v_org, p_workspace, coalesce(v_nome, 'Agência'),
            auth.uid()::text || '@interno.flow', true, auth.uid(), auth.uid())
    returning id into v_id;
  else
    update portal_users set ativo = true, nome = coalesce(v_nome, nome) where id = v_id;
  end if;
  return v_id;
end $$;

-- ── 7. Cadastro pelo link (conexão direta, role flow_auth) ───────────────────
create or replace function portal_convite_info(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('cliente', w.name, 'agencia', o.name)
    from portal_convites cv
    join workspaces w on w.id = cv.workspace_id
    join organizations o on o.id = cv.org_id
   where cv.token = p_token and cv.revogado_em is null and cv.expires_at > now()
$$;

create or replace function portal_cadastrar(
  p_token text, p_nome text, p_email text, p_senha_hash text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare cv portal_convites; v_pu portal_users; v_cli text;
begin
  select * into cv from portal_convites
   where token = p_token and revogado_em is null and expires_at > now() for update;
  if cv.id is null then raise exception 'convite_invalido'; end if;
  if coalesce(btrim(p_nome), '') = '' or coalesce(btrim(p_email), '') = '' or coalesce(p_senha_hash, '') = '' then
    raise exception 'campos';
  end if;
  -- E-mail que já tem acesso NÃO é sobrescrito: senão o link viraria um jeito de
  -- tomar a conta de quem já está cadastrado.
  if exists (select 1 from portal_users where workspace_id = cv.workspace_id
              and lower(email) = lower(btrim(p_email))) then
    raise exception 'ja_tem_acesso';
  end if;

  insert into portal_users (org_id, workspace_id, nome, email, ativo, created_by, senha_hash, convite_id, last_login_at)
  values (cv.org_id, cv.workspace_id, btrim(p_nome), lower(btrim(p_email)), true, cv.created_by,
          p_senha_hash, cv.id, now())
  returning * into v_pu;
  update portal_convites set usos = usos + 1 where id = cv.id;

  select name into v_cli from workspaces where id = cv.workspace_id;
  perform portal_notificar(cv.org_id, 'pendente_cliente'::text, 'portal_cadastro', null::uuid,
    jsonb_build_object('cliente', v_pu.nome, 'empresa', v_cli, 'email', v_pu.email,
                       'href', '/' || (select slug from organizations where id = cv.org_id)
                               || '/workspaces/' || cv.workspace_id));

  return jsonb_build_object('id', v_pu.id, 'org_id', v_pu.org_id, 'workspace_id', v_pu.workspace_id,
                            'nome', v_pu.nome, 'email', v_pu.email, 'ativo', v_pu.ativo);
end $$;

-- ── 8. Aviso diário ao cliente (cron) ────────────────────────────────────────
-- O que chegou para cada contato desde o último aviso: trabalho que ENTROU em
-- aprovação/pendência e orçamento publicado. Contato sem novidade não aparece.
create or replace function portal_avisos_cliente()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_cron() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(x) from (
      select jsonb_build_object(
        'id', pu.id, 'nome', pu.nome, 'email', pu.email,
        'cliente', w.name, 'agencia', o.name,
        'itens', itens.lista) as x
      from portal_users pu
      join workspaces w on w.id = pu.workspace_id
      join organizations o on o.id = pu.org_id
      cross join lateral (
        select jsonb_agg(i order by i->>'tipo', i->>'titulo') as lista from (
          select jsonb_build_object('tipo', case a.status when 'aprovacao_cliente' then 'aprovar' else 'responder' end,
                                    'titulo', a.title, 'campanha', c.name, 'prazo', a.due_date) as i
            from activities a join campaigns c on c.id = a.campaign_id
           where c.workspace_id = pu.workspace_id and not a.archived and not c.archived
             and a.status in ('aprovacao_cliente','pendente_cliente')
             and portal_no_status_desde(a.id, a.status) > coalesce(pu.aviso_em, pu.created_at)
          union all
          select jsonb_build_object('tipo', 'orcamento', 'titulo', p.titulo, 'campanha', null, 'prazo', null)
            from producao p
           where p.workspace_id = pu.workspace_id and p.tipo = 'orcamento' and not p.archived
             and p.situacao = 'em_aberto' and p.portal_publicado_em > coalesce(pu.aviso_em, pu.created_at)
        ) s
      ) itens
      where pu.ativo and pu.interno_user_id is null and not w.archived and itens.lista is not null
    ) t
  ), '[]'::jsonb);
end $$;

create or replace function portal_avisos_marcar(p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_cron() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update portal_users set aviso_em = now() where id = any(p_ids);
end $$;

-- ── 9. Privilégios (fechar TUDO e abrir só o necessário) ─────────────────────
revoke execute on function portal_fase(text) from public, anon, authenticated, portal;
revoke execute on function portal_no_status_desde(uuid, text) from public, anon, authenticated, portal;
revoke execute on function portal_orcamento_do_contato(portal_users, uuid) from public, anon, authenticated, portal;

revoke execute on function portal_dashboard() from public, anon, authenticated;
grant  execute on function portal_dashboard() to portal;
revoke execute on function portal_orcamento(uuid) from public, anon, authenticated;
grant  execute on function portal_orcamento(uuid) to portal;
revoke execute on function portal_orcamento_doc(uuid) from public, anon, authenticated;
grant  execute on function portal_orcamento_doc(uuid) to portal;
revoke execute on function portal_decidir_orcamento(uuid, text, text, text) from public, anon, authenticated;
grant  execute on function portal_decidir_orcamento(uuid, text, text, text) to portal;

revoke execute on function orcamento_portal_publicar(uuid, boolean) from public, anon, portal;
grant  execute on function orcamento_portal_publicar(uuid, boolean) to authenticated;
revoke execute on function portal_preview_abrir(uuid) from public, anon, portal;
grant  execute on function portal_preview_abrir(uuid) to authenticated;

revoke execute on function portal_convite_info(text) from public, anon, authenticated, portal;
grant  execute on function portal_convite_info(text) to flow_auth;
revoke execute on function portal_cadastrar(text, text, text, text) from public, anon, authenticated, portal;
grant  execute on function portal_cadastrar(text, text, text, text) to flow_auth;

revoke execute on function portal_avisos_cliente() from public, anon, portal;
grant  execute on function portal_avisos_cliente() to authenticated;  -- cron vai como authenticated + claim flow_cron
revoke execute on function portal_avisos_marcar(uuid[]) from public, anon, portal;
grant  execute on function portal_avisos_marcar(uuid[]) to authenticated;

notify pgrst, 'reload schema';
