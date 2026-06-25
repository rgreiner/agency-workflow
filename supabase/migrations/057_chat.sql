-- ── Messenger interno (chat 1:1) ─────────────────────────────────────────────
-- Mensagens diretas entre membros da mesma org + presença (online) por heartbeat.
-- Leituras são client-side (RLS por auth.uid()); escritas via RPC security definer
-- que usam auth.uid() (seguras p/ chamada direta do browser — NÃO recebem user_id).

create table if not exists chat_messages (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  sender_id    uuid not null references profiles(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  content      text not null,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);
create index if not exists idx_chat_pair on chat_messages (org_id, sender_id, recipient_id, created_at);
create index if not exists idx_chat_unread on chat_messages (recipient_id, org_id) where read_at is null;

alter table chat_messages enable row level security;
drop policy if exists "chat read own" on chat_messages;
create policy "chat read own" on chat_messages for select
  using (sender_id = auth.uid() or recipient_id = auth.uid());
grant select on chat_messages to anon, authenticated;

-- Presença global por usuário (last_seen via heartbeat). Online = visto há < ~70s.
create table if not exists user_presence (
  user_id      uuid primary key references profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
alter table user_presence enable row level security;
drop policy if exists "presence read" on user_presence;
create policy "presence read" on user_presence for select using (true);
grant select on user_presence to anon, authenticated;

-- ── Escritas (auth.uid() — seguras p/ chamada client-side) ───────────────────

-- Envia mensagem 1:1 (remetente = auth.uid()); ambos têm de ser membros da org.
create or replace function send_chat_message(p_recipient_id uuid, p_org_id uuid, p_content text)
 returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_me uuid := auth.uid(); v_text text := nullif(btrim(p_content), '');
begin
  if v_me is null then raise exception 'Não autenticado'; end if;
  if v_text is null then raise exception 'Mensagem vazia'; end if;
  if p_recipient_id = v_me then raise exception 'Destinatário inválido'; end if;
  if not exists (select 1 from organization_members where org_id = p_org_id and user_id = v_me)
     or not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_recipient_id)
  then raise exception 'Acesso negado'; end if;

  insert into chat_messages (org_id, sender_id, recipient_id, content)
  values (p_org_id, v_me, p_recipient_id, left(v_text, 4000))
  returning id into v_id;
  return v_id;
end; $$;

-- Marca como lidas as mensagens recebidas de p_other_id (nesta org).
create or replace function mark_chat_read(p_other_id uuid, p_org_id uuid)
 returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then return; end if;
  update chat_messages set read_at = now()
   where recipient_id = v_me and sender_id = p_other_id and org_id = p_org_id and read_at is null;
end; $$;

-- Heartbeat de presença (marca o próprio usuário como visto agora).
create or replace function touch_presence()
 returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then return; end if;
  insert into user_presence (user_id, last_seen_at) values (v_me, now())
  on conflict (user_id) do update set last_seen_at = now();
end; $$;

grant execute on function
  send_chat_message(uuid, uuid, text),
  mark_chat_read(uuid, uuid),
  touch_presence()
  to anon, authenticated;

notify pgrst, 'reload schema';
