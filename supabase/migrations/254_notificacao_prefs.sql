-- 254_notificacao_prefs.sql
-- Preferências de notificação por usuário: evento × canal (caixa de entrada / push).
--
-- Cada usuário escolhe o que recebe — por tipo de evento (mudança de status,
-- inclusive QUAIS status via data->>'to'; comentário; menção; atribuição; prazo;
-- portal; Drive) e por canal. Decisões do Rafael (24/08):
--   1) PUSH ⊂ CAIXA: o que sai da caixa não vira push; push só refina "desses,
--      quais vibram". Por isso inbox desligada = a linha nem nasce (return null)
--      e push desligado = pré-carimba push_sent_at (o claim da 220 só pega
--      push_sent_at is null — mesmo significado do backfill da própria 220).
--   2) Menção (@você) SEMPRE entra na caixa — só o push dela é configurável
--      (a chave 'mention' nem existe no canal inbox — whitelist do RPC).
--
-- Ponto único: trigger BEFORE INSERT em notifications. Todos os produtores
-- (notify_status_change 078, notify_comment 071, notify_assignee 188,
-- add_comment_with_mentions 143, notify_due_soon 246, notify_drive_sync 143,
-- portal_notificar 168/195, abrir_fechamento_contabil 183) convergem aqui.
-- Sem linha de prefs / chave ausente = tudo ligado (comportamento atual).
-- Prefs valem só para notificações NOVAS (histórico intacto).
-- fechamento_contabil e tipos futuros passam direto de propósito.
--
-- ⚠️ A fn do trigger é SECURITY DEFINER por CORREÇÃO, não estilo: invoker sob
-- role authenticated leria user_notification_prefs com a RLS do ATOR, não do
-- destinatário (NEW.user_id), e o filtro desligaria em silêncio. E NUNCA usar
-- auth.uid() aqui — notify_due_soon roda via cron, sem uid.
--
-- Rollback do filtro: drop trigger trg_filtrar_notificacao on notifications;
-- Idempotente.

-- ── Tabela ──────────────────────────────────────────────────────────────────
-- Escrita SÓ pelo RPC: só há policy de SELECT (update direto via PostgREST
-- casa 0 linhas de propósito — mesmo padrão de org_settings).
create table if not exists user_notification_prefs (
  user_id    uuid not null references profiles(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  prefs      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, org_id)
);
alter table user_notification_prefs enable row level security;
drop policy if exists "own notif prefs select" on user_notification_prefs;
create policy "own notif prefs select" on user_notification_prefs
  for select using (user_id = auth.uid());
grant select on user_notification_prefs to authenticated;

-- ── RPC de escrita ──────────────────────────────────────────────────────────
-- Reconstrói o jsonb com whitelist de chaves e valida os tipos: lixo gravado
-- seria remastigado pelo trigger a cada insert para sempre. Não valida os
-- status contra o cadastro da org: valor obsoleto no array é inerte.
create or replace function set_notification_prefs(p_user_id uuid, p_org_id uuid, p_prefs jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_clean jsonb;
  v_ch text; v_k text; v_val jsonb;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and arquivado = false
  ) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object'
     or pg_column_size(p_prefs) > 8192 then
    raise exception 'Preferências inválidas';
  end if;

  -- Whitelist por canal ('mention' só existe no push — inbox de menção é fixa).
  v_clean := jsonb_build_object(
    'inbox', (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
              from jsonb_each(case when jsonb_typeof(p_prefs->'inbox') = 'object'
                                   then p_prefs->'inbox' else '{}'::jsonb end) e
              where e.key in ('status','new_comment','assigned','due_soon','portal','drive_sync')),
    'push',  (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
              from jsonb_each(case when jsonb_typeof(p_prefs->'push') = 'object'
                                   then p_prefs->'push' else '{}'::jsonb end) e
              where e.key in ('status','new_comment','mention','assigned','due_soon','portal','drive_sync'))
  );

  -- Tipos: 'status' = null|array de strings; o resto = boolean.
  foreach v_ch in array array['inbox','push'] loop
    for v_k, v_val in select * from jsonb_each(v_clean->v_ch) loop
      if v_k = 'status' then
        if jsonb_typeof(v_val) not in ('null','array') then
          raise exception 'Preferências inválidas';
        end if;
        if jsonb_typeof(v_val) = 'array' and exists (
          select 1 from jsonb_array_elements(v_val) el where jsonb_typeof(el.value) <> 'string'
        ) then
          raise exception 'Preferências inválidas';
        end if;
      elsif jsonb_typeof(v_val) <> 'boolean' then
        raise exception 'Preferências inválidas';
      end if;
    end loop;
  end loop;

  insert into user_notification_prefs (user_id, org_id, prefs, updated_at)
  values (p_user_id, p_org_id, v_clean, now())
  on conflict (user_id, org_id) do update set prefs = excluded.prefs, updated_at = now();
end;
$$;
revoke execute on function set_notification_prefs(uuid, uuid, jsonb) from public, anon;
grant execute on function set_notification_prefs(uuid, uuid, jsonb) to authenticated;

-- ── Filtro único: BEFORE INSERT ─────────────────────────────────────────────
-- Leitura tolerante: valor de tipo errado (não deveria existir — o RPC valida)
-- conta como ligado. Jamais deixar um cast quebrar o INSERT do produtor.
create or replace function filtrar_notificacao()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v jsonb;
  v_key text;
  v_val jsonb;
begin
  select prefs into v from user_notification_prefs
   where user_id = NEW.user_id and org_id = NEW.org_id;
  if not found or v is null then return NEW; end if;  -- fast path: sem prefs = tudo ligado

  v_key := case
    when NEW.type in ('status_change','entered_status') then 'status'
    when NEW.type like 'portal\_%' escape '\' then 'portal'
    when NEW.type in ('new_comment','mention','assigned','due_soon','drive_sync') then NEW.type
    else null
  end;
  if v_key is null then return NEW; end if;  -- fechamento_contabil e futuros: passam

  -- CAIXA DE ENTRADA (menção nunca é filtrada aqui)
  if v_key <> 'mention' then
    if v_key = 'status' then
      v_val := v #> '{inbox,status}';
      if jsonb_typeof(v_val) = 'array' and not (v_val ? coalesce(NEW.data->>'to', '')) then
        return null;  -- linha não nasce ⇒ sem push também (push ⊂ caixa)
      end if;
    else
      v_val := v #> array['inbox', v_key];
      if jsonb_typeof(v_val) = 'boolean' and not (v_val)::boolean then
        return null;
      end if;
    end if;
  end if;

  -- PUSH (só avaliado se a linha nasceu): pré-carimba e o claim nem enxerga.
  if v_key = 'status' then
    v_val := v #> '{push,status}';
    if jsonb_typeof(v_val) = 'array' and not (v_val ? coalesce(NEW.data->>'to', '')) then
      NEW.push_sent_at := now();
    end if;
  else
    v_val := v #> array['push', v_key];
    if jsonb_typeof(v_val) = 'boolean' and not (v_val)::boolean then
      NEW.push_sent_at := now();
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_filtrar_notificacao on notifications;
create trigger trg_filtrar_notificacao
  before insert on notifications
  for each row execute function filtrar_notificacao();

notify pgrst, 'reload schema';
