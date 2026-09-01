-- 274_notificacao_preview_texto.sql
-- A caixa de entrada estava mostrando a tag crua do editor:
-- "Fulano comentou: <p><span class="mention" data-type="mention" data-id="116b…".
-- O comentário do TipTap é HTML e a prévia era `left(content, 120)` — guardava
-- markup e ainda cortava no meio de uma tag, então o texto de verdade nem
-- aparecia (os 120 caracteres iam embora nos atributos da menção).
--
--  1. `notif_preview`: HTML → texto puro ANTES de truncar (e só imagem vira
--     "📷 Imagem", igual ao commentPreview do front).
--  2. As duas origens da prévia passam a usar o helper: o trigger
--     `notify_comment` e a RPC `add_comment_with_mentions` (a menção).
--  3. O histórico é reescrito a partir do comentário ORIGINAL (o texto cortado
--     no meio da tag não dá pra recuperar da própria prévia); sem comentário
--     casável, limpa o que dá e, se sobrar vazio, tira a chave.
-- Idempotente.

-- ── HTML → texto puro, truncado no fim (nunca no meio de uma tag) ───────────
create or replace function notif_preview(p_html text, p_max int)
returns text language sql immutable as $$
  with t as (
    select btrim(regexp_replace(
      replace(replace(replace(replace(replace(
        -- tag inteira; depois o rabo de tag sem fechar (prévia antiga cortada)
        regexp_replace(regexp_replace(coalesce(p_html, ''), '<[^>]*>', ' ', 'g'),
                       '<[^>]*$', ' ', 'g'),
      '&nbsp;', ' '), '&amp;', '&'), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'),
      '[[:space:]]+', ' ', 'g')) as txt
  )
  select case
           when txt <> ''                        then left(txt, p_max)
           when coalesce(p_html, '') ~* '<img'   then '📷 Imagem'
           else ''
         end
  from t;
$$;

-- Helper interno: quem chama é função SECURITY DEFINER, não a API.
revoke all on function notif_preview(text, int) from public, anon, authenticated;

-- ── Origem 1: comentário novo avisa quem já participou da tarefa ───────────
create or replace function notify_comment()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_org uuid;
begin
  select w.org_id into v_org
  from activities a
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  where a.id = NEW.activity_id;
  if v_org is null then return NEW; end if;

  -- Avisa quem JÁ comentou nesta tarefa (participantes), exceto o autor.
  insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
  select distinct ac.user_id, v_org, 'new_comment', NEW.activity_id, NEW.user_id,
         jsonb_build_object('preview', notif_preview(NEW.content, 120))
  from activity_comments ac
  where ac.activity_id = NEW.activity_id
    and ac.user_id is distinct from NEW.user_id;

  return NEW;
end; $function$;

-- ── Origem 2: menção (@fulano / @todos) ────────────────────────────────────
create or replace function add_comment_with_mentions(
  p_user_id uuid, p_activity_id uuid, p_content text,
  p_mention_ids uuid[] default '{}'::uuid[], p_mention_all boolean default false,
  p_reply_to uuid default null)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
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
           jsonb_build_object('preview', notif_preview(p_content, 120), 'all', true)
    from organization_members om
    where om.org_id = v_org and om.user_id is distinct from p_user_id;
  elsif p_mention_ids is not null and array_length(p_mention_ids, 1) > 0 then
    insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
    select distinct uid, v_org, 'mention', p_activity_id, p_user_id,
           jsonb_build_object('preview', notif_preview(p_content, 120))
    from unnest(p_mention_ids) uid
    where uid is distinct from p_user_id
      and exists (select 1 from organization_members om where om.org_id = v_org and om.user_id = uid);
  end if;

  return v_id;
end; $function$;

-- ── Histórico: reescreve a prévia das notificações já gravadas ─────────────
with alvo as (
  select n.id, n.data, n.activity_id, n.actor_id, n.created_at
  from notifications n
  where n.type in ('new_comment', 'mention')
    and n.data->>'preview' ~ '<[a-zA-Z/!]'          -- só o que tem tag mesmo
), novo as (
  select a.id,
         coalesce(
           -- o comentário que gerou o aviso (nasce no mesmo instante)
           (select notif_preview(ac.content, 120)
              from activity_comments ac
             where ac.activity_id = a.activity_id
               and ac.user_id = a.actor_id
               and abs(extract(epoch from (ac.created_at - a.created_at))) < 10
             order by abs(extract(epoch from (ac.created_at - a.created_at)))
             limit 1),
           notif_preview(a.data->>'preview', 120)
         ) as txt
  from alvo a
)
update notifications n
   set data = case when coalesce(novo.txt, '') = ''
                   then n.data - 'preview'
                   else jsonb_set(n.data, '{preview}', to_jsonb(novo.txt)) end
  from novo
 where novo.id = n.id;

notify pgrst, 'reload schema';
