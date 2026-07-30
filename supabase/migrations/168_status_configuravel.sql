-- 168_status_configuravel.sql
-- Status da atividade deixa de ser ENUM fixo do Postgres e passa a ser CADASTRO
-- por organização (Configurações → Aparência): adicionar, renomear, recolorir,
-- reordenar e remover.
--
-- Por que o enum tinha que sair: o Postgres não remove valor de enum, e adicionar
-- exigiria DDL em runtime. Com `text` + tabela, o cadastro é dado comum.
--
-- Regras que ficam no banco (não na tela):
--   • `valor` (o slug gravado em activities.status) é IMUTÁVEL. Renomear muda só o
--     label — histórico, cargos e gates de IA continuam apontando pro mesmo lugar.
--   • Status com PAPEL de sistema não pode ser excluído: 'inicial' (padrão de tarefa
--     nova), 'conclusao' (fecha/recorre/arquiva), 'aprovacao_cliente' (portal) e os
--     três gates de revisão por IA. Renomear e recolorir, à vontade.
--   • Excluir status COM TAREFAS exige dizer pra onde elas vão. Sem destino, erro —
--     nunca some com tarefa.
--
-- Migração de tipo: os valores continuam EXATAMENTE os mesmos (enum::text), então
-- nada em produção muda de comportamento. O tipo `activity_status` fica órfão de
-- propósito (dropar exigiria garantir que nada mais o referencia; ele é inofensivo).

-- ── Cadastro de status por org ───────────────────────────────────────────────
create table if not exists org_status (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organizations(id) on delete cascade,
  valor    text not null,                 -- slug imutável (activities.status)
  label    text not null,
  grupo    text not null default 'internal',   -- internal | external | done
  bg       text not null default '#f3f4f6',
  txt      text not null default '#374151',
  ordem    int  not null default 999,
  papel    text,                          -- inicial | conclusao | aprovacao_cliente | gate_*
  ativo    boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists org_status_uk on org_status (org_id, valor);
create index if not exists org_status_org_idx on org_status (org_id, ordem);

alter table org_status enable row level security;
drop policy if exists org_status_read on org_status;
create policy org_status_read on org_status for select using (is_org_member(org_id));
-- Escrita só pelas RPCs (owner/admin).

-- ── Semente: os 20 status atuais, já com os overrides salvos em org_settings ──
insert into org_status (org_id, valor, label, grupo, bg, txt, ordem, papel)
select o.id, d.valor,
       coalesce(ov.value ->> 'label', d.label),
       d.grupo,
       coalesce(ov.value ->> 'bg',   d.bg),
       coalesce(ov.value ->> 'text', d.txt),
       d.ordem, d.papel
from organizations o
cross join (values
    ('briefing', 'Briefing', 'internal', '#f3e8ff', '#7e22ce', 10, 'inicial'),
    ('pendente_cliente', 'Pendente do cliente', 'internal', '#ffedd5', '#c2410c', 20, null),
    ('planejamento', 'Planejamento', 'internal', '#dbeafe', '#1d4ed8', 30, null),
    ('insight', 'Insight', 'internal', '#e0e7ff', '#4338ca', 40, null),
    ('redacao', 'Redação', 'internal', '#cffafe', '#0e7490', 50, 'gate_redacao'),
    ('design', 'Design', 'internal', '#fce7f3', '#be185d', 60, 'gate_design'),
    ('edicao', 'Edição', 'internal', '#ffe4e6', '#be123c', 70, null),
    ('finalizacao', 'Finalização', 'internal', '#ede9fe', '#6d28d9', 80, 'gate_finalizacao'),
    ('revisao_interna', 'Revisão interna', 'internal', '#fef3c7', '#b45309', 90, null),
    ('validacao_atendimento', 'Validação do atendimento', 'internal', '#fefce8', '#854d0e', 100, null),
    ('orcamento', 'Orçamento', 'internal', '#f7fee7', '#4d7c0f', 110, null),
    ('producao_fornecedores', 'Produção fornecedores', 'internal', '#ccfbf1', '#0f766e', 120, null),
    ('producao_audiovisual', 'Produção audiovisual', 'internal', '#e0f2fe', '#0369a1', 130, null),
    ('validacao_midia', 'Validação de mídia', 'internal', '#dbeafe', '#1d4ed8', 140, null),
    ('midia', 'Mídia', 'internal', '#d1fae5', '#065f46', 150, null),
    ('social', 'Social', 'internal', '#fae8ff', '#86198f', 160, null),
    ('aprovacao_cliente', 'Aprovação do cliente', 'external', '#ffedd5', '#c2410c', 170, 'aprovacao_cliente'),
    ('implantacao_digital', 'Implantação digital', 'external', '#dbeafe', '#1d4ed8', 180, null),
    ('implantacao_off', 'Implantação off/orgânico', 'external', '#dcfce7', '#15803d', 190, null),
    ('concluido', 'Concluído', 'done', '#f3f4f6', '#374151', 200, 'conclusao')
) as d(valor, label, grupo, bg, txt, ordem, papel)
left join org_settings s on s.org_id = o.id
left join lateral (
  select value from jsonb_array_elements(coalesce(s.status_overrides, '[]'::jsonb)) value
  where value ->> 'value' = d.valor limit 1
) ov on true
on conflict (org_id, valor) do nothing;

-- ── Enum → text (mesmos valores; nenhuma view depende destas colunas) ────────
alter table activities                alter column status                  type text using status::text;
alter table activities                alter column recurrence_reset_status type text using recurrence_reset_status::text;
alter table activity_history          alter column from_status             type text using from_status::text;
alter table activity_history          alter column to_status               type text using to_status::text;
alter table activity_status_assignees alter column status                  type text using status::text;
alter table org_positions             alter column allowed_statuses        type text[] using allowed_statuses::text[];
alter table activities                alter column status set default 'briefing';

-- ── Funções que declaravam/casteavam o enum ─────────────────────────────────
-- As 4 com o enum na ASSINATURA precisam cair antes (o PostgREST não aceita
-- overload: duas assinaturas do mesmo nome quebram a chamada).
drop function if exists create_org_position(uuid, uuid, text, text, activity_status[], boolean, boolean, boolean);
drop function if exists update_org_position(uuid, uuid, text, text, activity_status[], boolean, boolean, boolean);
drop function if exists update_activity_status(uuid, uuid, activity_status, text);
drop function if exists portal_notificar(uuid, activity_status, text, uuid, jsonb);

-- Definições abaixo: geradas do pg_get_functiondef VIVO em produção, com a troca
-- mecânica activity_status → text. Nada foi reescrito à mão.
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
    p_campaign_id, p_title, p_description, p_status::text,
    p_priority::activity_priority, p_complexity::activity_complexity,
    p_due_date, p_estimated_hours, p_start_date, p_user_id
  )
  RETURNING id INTO v_id;

  -- Registra no histórico
  INSERT INTO activity_history (activity_id, changed_by, to_status)
  VALUES (v_id, p_user_id, p_status::text);

  RETURN v_id;
END;
$function$

;
CREATE OR REPLACE FUNCTION public.create_org_position(p_user_id uuid, p_org_id uuid, p_name text, p_color text, p_allowed_statuses text[], p_op_ver_tudo boolean DEFAULT false, p_op_midias boolean DEFAULT false, p_op_producao boolean DEFAULT false)
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
end; $function$

;
CREATE OR REPLACE FUNCTION public.portal_criar_solicitacao(p_titulo text, p_mensagem text, p_anexos jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    v_pu.org_id, 'briefing'::text, 'portal_solicitacao', null,
    jsonb_build_object('cliente', v_pu.nome, 'entry_id', v_entry, 'titulo', btrim(p_titulo),
                       'preview', left(btrim(p_mensagem), 140),
                       'anexos', jsonb_array_length(coalesce(p_anexos,'[]'::jsonb)))
  );
  return jsonb_build_object('ok', true, 'entry_id', v_entry);
end $function$

;
CREATE OR REPLACE FUNCTION public.portal_notificar(p_org uuid, p_status text, p_type text, p_activity uuid, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
  select distinct m.user_id, p_org, p_type, p_activity, null::uuid, p_data
  from organization_members m
  left join org_positions pos on pos.id = m.position_id
  where m.org_id = p_org
    and (m.role in ('owner','admin') or p_status = any(pos.allowed_statuses));
end $function$

;
CREATE OR REPLACE FUNCTION public.portal_pode_gerir(p_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from organization_members m
    left join org_positions pos on pos.id = m.position_id
    where m.org_id = p_org and m.user_id = auth.uid()
      and (
        m.role in ('owner','admin')
        or pos.allowed_statuses && array['pendente_cliente','briefing']::text[]
      )
  );
$function$

;
CREATE OR REPLACE FUNCTION public.portal_registrar_decisao(p_activity_id uuid, p_decisao text, p_mensagem text DEFAULT NULL::text, p_pecas jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    v_pu.org_id, 'aprovacao_cliente'::text,
    case when v_kind='aprovacao' then 'portal_aprovado' else 'portal_ajuste' end,
    v_act.id,
    jsonb_build_object('cliente', v_pu.nome, 'entry_id', v_entry,
                       'preview', left(coalesce(btrim(p_mensagem),''), 140),
                       'pecas', coalesce(jsonb_array_length(p_pecas), 0))
  );
  return jsonb_build_object('ok', true, 'entry_id', v_entry, 'kind', v_kind);
end $function$

;
CREATE OR REPLACE FUNCTION public.portal_responder_pendencia(p_activity_id uuid, p_mensagem text, p_anexos jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    v_pu.org_id, 'pendente_cliente'::text, 'portal_resposta', v_act.id,
    jsonb_build_object('cliente', v_pu.nome, 'entry_id', v_entry,
                       'preview', left(btrim(p_mensagem), 140),
                       'anexos', jsonb_array_length(coalesce(p_anexos,'[]'::jsonb)))
  );
  return jsonb_build_object('ok', true, 'entry_id', v_entry);
end $function$

;
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
  v_reset text;
  v_to    text;
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
$function$

;
CREATE OR REPLACE FUNCTION public.seed_default_positions(p_org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO org_positions (org_id, name, color, allowed_statuses) VALUES
    (p_org_id, 'Gestão',      '#6366f1', ARRAY[
      'briefing','pendente_cliente','planejamento','insight','redacao','design','edicao',
      'finalizacao','revisao_interna','validacao_atendimento','orcamento',
      'producao_fornecedores','producao_audiovisual','validacao_midia','midia','social',
      'aprovacao_cliente','implantacao_digital','implantacao_off','concluido'
    ]::text[]),
    (p_org_id, 'Atendimento', '#f97316', ARRAY[
      'briefing','pendente_cliente','planejamento','validacao_atendimento',
      'aprovacao_cliente','implantacao_digital','implantacao_off','concluido'
    ]::text[]),
    (p_org_id, 'Redação',     '#14b8a6', ARRAY['insight','redacao']::text[]),
    (p_org_id, 'Design',      '#ec4899', ARRAY['design','edicao','finalizacao']::text[]),
    (p_org_id, 'Produção',    '#f59e0b', ARRAY['producao_fornecedores','producao_audiovisual']::text[]),
    (p_org_id, 'Mídia',       '#8b5cf6', ARRAY['validacao_midia','midia','social']::text[]);
END;
$function$

;
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
         recurrence_reset_status = case when v_rec is null then null else nullif(p_reset_status, '')::text end,
         updated_at = now()
   where id = p_activity_id;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.update_activity_status(p_user_id uuid, p_activity_id uuid, p_new_status text, p_comment text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_old_status text; v_label text;
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
$function$

;
CREATE OR REPLACE FUNCTION public.update_org_position(p_user_id uuid, p_position_id uuid, p_name text, p_color text, p_allowed_statuses text[], p_op_ver_tudo boolean DEFAULT NULL::boolean, p_op_midias boolean DEFAULT NULL::boolean, p_op_producao boolean DEFAULT NULL::boolean)
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
end; $function$
;

-- ── CRUD do cadastro (owner/admin; auth.uid(), nunca usuário por parâmetro) ──
create or replace function org_status_pode(p_org uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from organization_members
    where org_id = p_org and user_id = auth.uid() and role in ('owner','admin')
  );
$$;
revoke execute on function org_status_pode(uuid) from public;
grant execute on function org_status_pode(uuid) to authenticated;

-- Slug estável a partir do nome (sem acento, minúsculo, _), com sufixo se colidir.
create or replace function org_status_slug(p_org uuid, p_label text)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare v_base text; v_try text; i int := 2;
begin
  v_base := regexp_replace(lower(unaccent(coalesce(p_label,''))), '[^a-z0-9]+', '_', 'g');
  v_base := trim(both '_' from v_base);
  if v_base = '' then v_base := 'status'; end if;
  v_try := v_base;
  while exists (select 1 from org_status where org_id = p_org and valor = v_try) loop
    v_try := v_base || '_' || i; i := i + 1;
  end loop;
  return v_try;
end $$;
revoke execute on function org_status_slug(uuid, text) from public;

-- Cria ou edita. `p_valor` null = criação (gera o slug do label).
-- Renomear NUNCA mexe no valor: o histórico e os gates seguem apontando pro mesmo.
create or replace function org_status_salvar(p_org uuid, p_valor text, p_data jsonb)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_valor text;
begin
  if not org_status_pode(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if coalesce(btrim(p_data->>'label'), '') = '' then raise exception 'O status precisa de um nome'; end if;

  if p_valor is null then
    v_valor := org_status_slug(p_org, p_data->>'label');
    insert into org_status (org_id, valor, label, grupo, bg, txt, ordem)
    values (p_org, v_valor, btrim(p_data->>'label'),
            coalesce(nullif(p_data->>'grupo',''), 'internal'),
            coalesce(nullif(p_data->>'bg',''), '#f3f4f6'),
            coalesce(nullif(p_data->>'txt',''), '#374151'),
            coalesce((p_data->>'ordem')::int,
                     (select coalesce(max(ordem), 0) + 10 from org_status where org_id = p_org)));
    return v_valor;
  end if;

  update org_status set
    label = btrim(p_data->>'label'),
    grupo = coalesce(nullif(p_data->>'grupo',''), grupo),
    bg    = coalesce(nullif(p_data->>'bg',''), bg),
    txt   = coalesce(nullif(p_data->>'txt',''), txt),
    ordem = coalesce((p_data->>'ordem')::int, ordem)
  where org_id = p_org and valor = p_valor;
  if not found then raise exception 'Status não encontrado'; end if;
  return p_valor;
end $$;
revoke execute on function org_status_salvar(uuid, text, jsonb) from public;
grant execute on function org_status_salvar(uuid, text, jsonb) to authenticated;

-- Exclui. Com tarefas no status, exige destino — e move tudo (tarefa, histórico
-- de recorrência e a permissão dos cargos) antes de apagar.
create or replace function org_status_excluir(p_org uuid, p_valor text, p_mover_para text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_papel text; v_qtd int; v_destino_ok boolean;
begin
  if not org_status_pode(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  select papel into v_papel from org_status where org_id = p_org and valor = p_valor;
  if not found then raise exception 'Status não encontrado'; end if;
  if v_papel is not null then
    raise exception 'Este status é usado pelo sistema e não pode ser excluído. Você pode renomeá-lo.';
  end if;

  select count(*) into v_qtd
  from activities a
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  where w.org_id = p_org and a.status = p_valor;

  if v_qtd > 0 then
    if coalesce(p_mover_para, '') = '' then
      raise exception 'Há % tarefa(s) neste status. Escolha para onde movê-las.', v_qtd;
    end if;
    select exists (select 1 from org_status where org_id = p_org and valor = p_mover_para)
      into v_destino_ok;
    if not v_destino_ok then raise exception 'Status de destino inválido'; end if;

    update activities a set status = p_mover_para, updated_at = now()
    from campaigns c, workspaces w
    where a.campaign_id = c.id and c.workspace_id = w.id
      and w.org_id = p_org and a.status = p_valor;
  end if;

  -- Recorrência que voltava pra este status passa a voltar pro destino (ou padrão).
  update activities a set recurrence_reset_status = nullif(p_mover_para, '')
  from campaigns c, workspaces w
  where a.campaign_id = c.id and c.workspace_id = w.id
    and w.org_id = p_org and a.recurrence_reset_status = p_valor;

  -- Sai da permissão dos cargos (senão fica um valor órfão no array).
  update org_positions set allowed_statuses = array_remove(allowed_statuses, p_valor)
  where org_id = p_org and p_valor = any(allowed_statuses);

  delete from org_status where org_id = p_org and valor = p_valor;
  return jsonb_build_object('ok', true, 'movidas', v_qtd);
end $$;
revoke execute on function org_status_excluir(uuid, text, text) from public;
grant execute on function org_status_excluir(uuid, text, text) to authenticated;

-- Reordena na ordem do array recebido.
create or replace function org_status_reordenar(p_org uuid, p_valores text[])
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not org_status_pode(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update org_status s set ordem = x.pos * 10
  from (select unnest(p_valores) as valor, generate_subscripts(p_valores, 1) as pos) x
  where s.org_id = p_org and s.valor = x.valor;
end $$;
revoke execute on function org_status_reordenar(uuid, text[]) from public;
grant execute on function org_status_reordenar(uuid, text[]) to authenticated;

notify pgrst, 'reload schema';
