-- 154_portal_entradas.sql
-- Portal do cliente — Fase 3: entradas do cliente.
--   • resposta   → o cliente preenche a informação/arquivos que faltavam numa
--                  tarefa em `pendente_cliente` (não avança nada sozinho).
--   • solicitacao→ o cliente abre uma demanda nova (alternativa ao WhatsApp);
--                  cai pro time de ATENDIMENTO como briefing, NUNCA vira tarefa direto.
-- Escritas só pelas RPCs portal_* (role `portal`); a leitura interna é dos membros.
-- Roteamento pra quem recebe = a MESMA regra cargo×status do resto do app
-- (org_positions.allowed_statuses): pendente_cliente/briefing = o Atendimento.
-- Idempotente.

-- ── Registro da entrada do cliente ──
create table if not exists portal_entries (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  portal_user_id uuid not null references portal_users(id) on delete cascade,
  kind           text not null check (kind in ('resposta','solicitacao')),
  activity_id    uuid references activities(id) on delete set null,  -- só na resposta
  titulo         text,                                               -- só na solicitacao
  mensagem       text not null,
  anexos         jsonb not null default '[]'::jsonb,                 -- [{chave, nome}]
  status         text not null default 'novo' check (status in ('novo','lido','arquivado')),
  created_at     timestamptz not null default now()
);
create index if not exists portal_entries_org_idx on portal_entries (org_id, status, created_at desc);
create index if not exists portal_entries_activity_idx on portal_entries (activity_id) where activity_id is not null;

alter table portal_entries enable row level security;

-- Quem GERENCIA entradas do cliente na org: owner/admin OU cargo de atendimento
-- (allowed_statuses contém pendente_cliente ou briefing).
create or replace function portal_pode_gerir(p_org uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from organization_members m
    left join org_positions pos on pos.id = m.position_id
    where m.org_id = p_org and m.user_id = auth.uid()
      and (
        m.role in ('owner','admin')
        or pos.allowed_statuses && array['pendente_cliente','briefing']::activity_status[]
      )
  );
$$;
revoke execute on function portal_pode_gerir(uuid) from public;
grant execute on function portal_pode_gerir(uuid) to authenticated;

-- Membro da org lê; quem gerencia atualiza status (marcar lido/arquivar).
drop policy if exists portal_entries_select on portal_entries;
create policy portal_entries_select on portal_entries for select using (
  exists (select 1 from organization_members m
          where m.org_id = portal_entries.org_id and m.user_id = auth.uid())
);
drop policy if exists portal_entries_manage on portal_entries;
create policy portal_entries_manage on portal_entries for update using (
  portal_pode_gerir(portal_entries.org_id)
) with check (
  portal_pode_gerir(portal_entries.org_id)
);

-- A conexão direta (lib/db, role flow_auth) não toca esta tabela; só o portal
-- (via RPC) e os membros (via PostgREST authenticated). Sem grant a flow_auth.

-- ── Helper: notifica o conjunto que responde por um status (cargo×status + owner/admin) ──
-- SEM actor_id (o cliente não é um profile). data carrega cliente/título/preview.
create or replace function portal_notificar(
  p_org uuid, p_status activity_status, p_type text,
  p_activity uuid, p_data jsonb
) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
  select distinct m.user_id, p_org, p_type, p_activity, null::uuid, p_data
  from organization_members m
  left join org_positions pos on pos.id = m.position_id
  where m.org_id = p_org
    and (m.role in ('owner','admin') or p_status = any(pos.allowed_statuses));
end $$;
revoke execute on function portal_notificar(uuid, activity_status, text, uuid, jsonb) from public;

-- ── Identidade do portal a partir do JWT (claim portal_sub) ──
create or replace function portal_atual()
returns portal_users language sql stable security definer set search_path to 'public' as $$
  select * from portal_users
  where id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'portal_sub')::uuid
    and ativo;
$$;
revoke execute on function portal_atual() from public;

-- ── RPC: detalhe de UMA pendência (pra abrir a tela de resposta direto por URL) ──
create or replace function portal_pendencia(p_activity_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_pu portal_users; v_row jsonb;
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode='42501'; end if;
  select jsonb_build_object('id', a.id, 'titulo', a.title, 'campanha', c.name)
    into v_row
  from activities a join campaigns c on c.id = a.campaign_id
  where a.id = p_activity_id and c.workspace_id = v_pu.workspace_id
    and a.status = 'pendente_cliente' and not a.archived and not c.archived;
  if v_row is null then raise exception 'Tarefa indisponível'; end if;
  return v_row;
end $$;
revoke execute on function portal_pendencia(uuid) from public;
grant execute on function portal_pendencia(uuid) to portal;

-- ── RPC: responder uma pendência ──
-- Valida que a tarefa é do workspace do cliente E está em pendente_cliente.
-- Grava a entrada e notifica quem responde por pendente_cliente (Atendimento).
create or replace function portal_responder_pendencia(
  p_activity_id uuid, p_mensagem text, p_anexos jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_pu portal_users; v_act activities; v_entry uuid; v_titulo text;
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode='42501'; end if;
  if coalesce(btrim(p_mensagem),'') = '' then raise exception 'Mensagem vazia'; end if;

  select a.* into v_act
  from activities a join campaigns c on c.id = a.campaign_id
  where a.id = p_activity_id and c.workspace_id = v_pu.workspace_id
    and a.status = 'pendente_cliente' and not a.archived and not c.archived;
  if v_act.id is null then raise exception 'Tarefa indisponível'; end if;

  insert into portal_entries (org_id, workspace_id, portal_user_id, kind, activity_id, mensagem, anexos)
  values (v_pu.org_id, v_pu.workspace_id, v_pu.id, 'resposta', v_act.id, btrim(p_mensagem),
          coalesce(p_anexos,'[]'::jsonb))
  returning id into v_entry;

  perform portal_notificar(
    v_pu.org_id, 'pendente_cliente'::activity_status, 'portal_resposta', v_act.id,
    jsonb_build_object('cliente', v_pu.nome, 'entry_id', v_entry,
                       'preview', left(btrim(p_mensagem), 140),
                       'anexos', jsonb_array_length(coalesce(p_anexos,'[]'::jsonb)))
  );
  return jsonb_build_object('ok', true, 'entry_id', v_entry);
end $$;
revoke execute on function portal_responder_pendencia(uuid, text, jsonb) from public;
grant execute on function portal_responder_pendencia(uuid, text, jsonb) to portal;

-- ── RPC: abrir uma solicitação nova ──
-- Sem tarefa: vira briefing pro Atendimento (quem responde por 'briefing').
create or replace function portal_criar_solicitacao(
  p_titulo text, p_mensagem text, p_anexos jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_pu portal_users; v_entry uuid;
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode='42501'; end if;
  if coalesce(btrim(p_titulo),'') = '' then raise exception 'Título vazio'; end if;
  if coalesce(btrim(p_mensagem),'') = '' then raise exception 'Mensagem vazia'; end if;

  insert into portal_entries (org_id, workspace_id, portal_user_id, kind, titulo, mensagem, anexos)
  values (v_pu.org_id, v_pu.workspace_id, v_pu.id, 'solicitacao', btrim(p_titulo), btrim(p_mensagem),
          coalesce(p_anexos,'[]'::jsonb))
  returning id into v_entry;

  perform portal_notificar(
    v_pu.org_id, 'briefing'::activity_status, 'portal_solicitacao', null,
    jsonb_build_object('cliente', v_pu.nome, 'entry_id', v_entry, 'titulo', btrim(p_titulo),
                       'preview', left(btrim(p_mensagem), 140),
                       'anexos', jsonb_array_length(coalesce(p_anexos,'[]'::jsonb)))
  );
  return jsonb_build_object('ok', true, 'entry_id', v_entry);
end $$;
revoke execute on function portal_criar_solicitacao(text, text, jsonb) from public;
grant execute on function portal_criar_solicitacao(text, text, jsonb) to portal;

notify pgrst, 'reload schema';
