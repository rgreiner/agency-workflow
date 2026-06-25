-- ── Chat: RPCs com p_user_id (server-trusted) ───────────────────────────────
-- Alinha o chat ao padrão do projeto (todas as RPCs recebem p_user_id e são
-- chamadas via server action), em vez de depender de auth.uid() dentro de
-- SECURITY DEFINER. Inclui RPCs de LEITURA (conversa + não-lidas) p/ não depender
-- de RLS no browser. Substitui as funções da migration 057.

drop function if exists send_chat_message(uuid, uuid, text);
drop function if exists mark_chat_read(uuid, uuid);
drop function if exists touch_presence();

create or replace function send_chat_message(p_user_id uuid, p_recipient_id uuid, p_org_id uuid, p_content text)
 returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_text text := nullif(btrim(p_content), '');
begin
  if v_text is null then raise exception 'Mensagem vazia'; end if;
  if p_recipient_id = p_user_id then raise exception 'Destinatário inválido'; end if;
  if not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_user_id)
     or not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_recipient_id)
  then raise exception 'Acesso negado'; end if;

  insert into chat_messages (org_id, sender_id, recipient_id, content)
  values (p_org_id, p_user_id, p_recipient_id, left(v_text, 4000))
  returning id into v_id;
  return v_id;
end; $$;

create or replace function mark_chat_read(p_user_id uuid, p_other_id uuid, p_org_id uuid)
 returns void language plpgsql security definer set search_path = public as $$
begin
  update chat_messages set read_at = now()
   where recipient_id = p_user_id and sender_id = p_other_id and org_id = p_org_id and read_at is null;
end; $$;

create or replace function touch_presence(p_user_id uuid)
 returns void language plpgsql security definer set search_path = public as $$
begin
  insert into user_presence (user_id, last_seen_at) values (p_user_id, now())
  on conflict (user_id) do update set last_seen_at = now();
end; $$;

-- Conversa 1:1 (mensagens entre p_user_id e p_other_id na org).
create or replace function get_chat_conversation(p_user_id uuid, p_other_id uuid, p_org_id uuid)
 returns setof chat_messages language sql security definer set search_path = public as $$
  select * from chat_messages
   where org_id = p_org_id
     and ((sender_id = p_user_id and recipient_id = p_other_id)
       or (sender_id = p_other_id and recipient_id = p_user_id))
   order by created_at asc
   limit 300;
$$;

-- Não-lidas por remetente (p/ os badges).
create or replace function get_unread_counts(p_user_id uuid, p_org_id uuid)
 returns table(other_id uuid, n integer) language sql security definer set search_path = public as $$
  select sender_id as other_id, count(*)::int as n
    from chat_messages
   where recipient_id = p_user_id and org_id = p_org_id and read_at is null
   group by sender_id;
$$;

grant execute on function
  send_chat_message(uuid, uuid, uuid, text),
  mark_chat_read(uuid, uuid, uuid),
  touch_presence(uuid),
  get_chat_conversation(uuid, uuid, uuid),
  get_unread_counts(uuid, uuid)
  to anon, authenticated;

notify pgrst, 'reload schema';
