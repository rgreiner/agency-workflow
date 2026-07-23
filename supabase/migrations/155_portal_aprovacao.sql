-- 155_portal_aprovacao.sql
-- Portal do cliente — Fase 2: ambiente de aprovação.
-- O cliente vê as peças da pasta **Preview** da tarefa (a Final, arquivo de
-- impressão, NUNCA aparece), comenta por peça e decide:
--   • aprovado → aceite formal (quem/quando), encerra o ciclo dele;
--   • ajuste   → apontamentos, volta pro ATENDIMENTO.
-- Em NENHUM dos dois o status da tarefa muda sozinho (regra do Rafael: nunca vai
-- direto pra pauta) — registra + notifica quem responde por aprovacao_cliente.
-- Idempotente.

-- ── portal_entries ganha os 2 tipos novos + comentários por peça ──
alter table portal_entries drop constraint if exists portal_entries_kind_check;
alter table portal_entries add constraint portal_entries_kind_check
  check (kind in ('resposta','solicitacao','aprovacao','ajuste'));

alter table portal_entries add column if not exists pecas jsonb not null default '[]'::jsonb;
comment on column portal_entries.pecas is 'Comentários por peça: [{nome, comentario}]';

-- ── RPC: dados da tela de aprovação (tarefa + decisão já dada) ──
-- A ref da pasta sai daqui pro servidor listar as peças; o cliente nunca escolhe
-- a pasta (ela vem da LINHA da tarefa validada contra o workspace dele).
create or replace function portal_aprovacao(p_activity_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_pu portal_users; v_row jsonb;
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode='42501'; end if;

  select jsonb_build_object(
    'id', a.id, 'titulo', a.title, 'campanha', c.name,
    'pasta_ref', a.drive_folder_id,
    'decisao', (
      select jsonb_build_object('kind', e.kind, 'mensagem', e.mensagem, 'em', e.created_at)
      from portal_entries e
      where e.activity_id = a.id and e.kind in ('aprovacao','ajuste')
      order by e.created_at desc limit 1
    )
  ) into v_row
  from activities a join campaigns c on c.id = a.campaign_id
  where a.id = p_activity_id and c.workspace_id = v_pu.workspace_id
    and a.status = 'aprovacao_cliente' and not a.archived and not c.archived;

  if v_row is null then raise exception 'Trabalho indisponível'; end if;
  return v_row;
end $$;
revoke execute on function portal_aprovacao(uuid) from public;
grant execute on function portal_aprovacao(uuid) to portal;

-- ── RPC: registrar a decisão (aceite ou pedido de ajuste) ──
create or replace function portal_registrar_decisao(
  p_activity_id uuid, p_decisao text, p_mensagem text default null,
  p_pecas jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_pu portal_users; v_act activities; v_entry uuid; v_kind text;
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode='42501'; end if;
  if p_decisao not in ('aprovado','ajuste') then raise exception 'Decisão inválida'; end if;
  v_kind := case when p_decisao = 'aprovado' then 'aprovacao' else 'ajuste' end;

  -- Pedido de ajuste PRECISA dizer o que ajustar (no aceite a mensagem é opcional).
  if v_kind = 'ajuste' and coalesce(btrim(p_mensagem),'') = ''
     and coalesce(jsonb_array_length(p_pecas), 0) = 0 then
    raise exception 'Descreva o ajuste';
  end if;

  select a.* into v_act
  from activities a join campaigns c on c.id = a.campaign_id
  where a.id = p_activity_id and c.workspace_id = v_pu.workspace_id
    and a.status = 'aprovacao_cliente' and not a.archived and not c.archived;
  if v_act.id is null then raise exception 'Trabalho indisponível'; end if;

  -- Uma decisão por ciclo: se já respondeu, não sobrescreve em silêncio.
  if exists (
    select 1 from portal_entries
    where activity_id = v_act.id and kind in ('aprovacao','ajuste')
  ) then
    raise exception 'Este trabalho já foi respondido';
  end if;

  insert into portal_entries (org_id, workspace_id, portal_user_id, kind, activity_id, mensagem, pecas)
  values (v_pu.org_id, v_pu.workspace_id, v_pu.id, v_kind, v_act.id,
          coalesce(btrim(p_mensagem), case when v_kind='aprovacao' then 'Aprovado pelo cliente.' else '' end),
          coalesce(p_pecas,'[]'::jsonb))
  returning id into v_entry;

  perform portal_notificar(
    v_pu.org_id, 'aprovacao_cliente'::activity_status,
    case when v_kind='aprovacao' then 'portal_aprovado' else 'portal_ajuste' end,
    v_act.id,
    jsonb_build_object('cliente', v_pu.nome, 'entry_id', v_entry,
                       'preview', left(coalesce(btrim(p_mensagem),''), 140),
                       'pecas', coalesce(jsonb_array_length(p_pecas), 0))
  );
  return jsonb_build_object('ok', true, 'entry_id', v_entry, 'kind', v_kind);
end $$;
revoke execute on function portal_registrar_decisao(uuid, text, text, jsonb) from public;
grant execute on function portal_registrar_decisao(uuid, text, text, jsonb) to portal;

-- ── portal_dashboard: marca o que o cliente JÁ respondeu ──
-- Sem isso o card fica em "Em aprovação" depois do aceite e parece que não foi.
create or replace function portal_dashboard()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_sub uuid;
  v_pu  portal_users%rowtype;
begin
  v_sub := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'portal_sub';
  if v_sub is null then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  select * into v_pu from portal_users where id = v_sub and ativo;
  if not found then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'usuario', jsonb_build_object('nome', v_pu.nome, 'email', v_pu.email),
    'cliente', (select jsonb_build_object('nome', w.name)
                from workspaces w where w.id = v_pu.workspace_id),
    'tarefas', coalesce((
      select jsonb_agg(t order by t->>'campanha', t->>'titulo')
      from (
        select jsonb_build_object(
          'id',       a.id,
          'titulo',   a.title,
          'campanha', c.name,
          -- Só as 3 colunas do portal — o status interno NUNCA sai daqui.
          'coluna',   case a.status
                        when 'pendente_cliente'  then 'pendente'
                        when 'aprovacao_cliente' then 'aprovacao'
                        else 'agencia'
                      end,
          -- 'aprovacao' | 'ajuste' | null: o que o cliente já respondeu neste ciclo.
          'decidido', (
            select e.kind from portal_entries e
            where e.activity_id = a.id and e.kind in ('aprovacao','ajuste')
            order by e.created_at desc limit 1
          ),
          -- Já respondeu a pendência? (evita mandar 2x sem saber)
          'respondido', exists (
            select 1 from portal_entries e
            where e.activity_id = a.id and e.kind = 'resposta'
          )
        ) as t
        from activities a
        join campaigns c on c.id = a.campaign_id
        where c.workspace_id = v_pu.workspace_id
          and not a.archived and not c.archived
          and a.status <> 'concluido'
      ) sub
    ), '[]'::jsonb)
  );
end $$;
revoke execute on function portal_dashboard() from public;
revoke execute on function portal_dashboard() from anon;
revoke execute on function portal_dashboard() from authenticated;
grant execute on function portal_dashboard() to portal;

notify pgrst, 'reload schema';
