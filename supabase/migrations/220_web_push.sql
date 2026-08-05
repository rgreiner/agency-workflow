-- 220_web_push.sql
-- Web-push do PWA (fase 4): inscrições por aparelho, despacho de notificações
-- do sino e lembrete de ponto que chega com o app FECHADO — o pré-requisito
-- prático da virada do Pontomais.
--
-- Desenho:
--   • push_subscriptions — 1 linha por aparelho inscrito (endpoint único).
--   • push_subscribe()   — grava a inscrição resolvendo o dono pelo auth.uid();
--                          delete-antes-de-insert porque o MESMO aparelho pode
--                          trocar de login (o endpoint migra de dono).
--   • notifications.push_sent_at + push_claim_pending() — o despachante marca
--     e devolve atomicamente (for update skip locked: o cron de 15min e o
--     disparo inline pós-action podem correr juntos sem push duplicado).
--   • rh_push_lembrete_entrada() — quem já devia ter batido a entrada e não
--     bateu; dedup por dia em push_lembrete_log. A régua respeita feriado,
--     justificativa aberta/aprovada e só cobra quem TEM aparelho inscrito.

-- ── Inscrições ───────────────────────────────────────────────────────────────
create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_subs_user on push_subscriptions(user_id);

alter table push_subscriptions enable row level security;
drop policy if exists "push subs select" on push_subscriptions;
drop policy if exists "push subs insert" on push_subscriptions;
drop policy if exists "push subs update" on push_subscriptions;
drop policy if exists "push subs delete" on push_subscriptions;
-- O cron lê/limpa inscrições de todo mundo (envio + endpoint morto 404/410).
create policy "push subs select" on push_subscriptions for select
  using (user_id = auth.uid() or is_cron());
create policy "push subs insert" on push_subscriptions for insert
  with check (user_id = auth.uid());
create policy "push subs delete" on push_subscriptions for delete
  using (user_id = auth.uid() or is_cron());
grant select, insert, delete on push_subscriptions to authenticated;

create or replace function push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Acesso negado' using errcode = '42501'; end if;
  -- Mesmo aparelho, outro login: o endpoint troca de dono em vez de conflitar.
  delete from push_subscriptions where endpoint = p_endpoint;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, p_ua);
end $$;
revoke execute on function push_subscribe(text, text, text, text) from anon, authenticated, public;
grant execute on function push_subscribe(text, text, text, text) to authenticated;

-- ── Despacho das notificações do sino ────────────────────────────────────────
alter table notifications add column if not exists push_sent_at timestamptz;
-- Histórico nunca vira push retroativo: nasce marcado.
update notifications set push_sent_at = created_at where push_sent_at is null;
create index if not exists idx_notifications_push_pending
  on notifications(created_at) where push_sent_at is null;

create or replace function push_claim_pending()
returns table (
  id uuid, user_id uuid, org_slug text, type text, data jsonb, created_at timestamptz,
  actor_name text, activity_id uuid, activity_title text, campaign_id uuid, workspace_id uuid
) language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_cron() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return query
  with claimed as (
    update notifications n set push_sent_at = now()
    where n.id in (
      -- Janela de 24h: null antigo (gap entre migration e deploy) não vira spam.
      select n2.id from notifications n2
      where n2.push_sent_at is null and n2.created_at > now() - interval '24 hours'
      order by n2.created_at limit 200
      for update skip locked
    )
    returning n.id, n.user_id, n.org_id, n.type, n.data, n.created_at, n.actor_id, n.activity_id
  )
  select c.id, c.user_id, o.slug, c.type, c.data, c.created_at,
         p.full_name, c.activity_id, a.title, a.campaign_id, ca.workspace_id
  from claimed c
  left join organizations o on o.id = c.org_id
  left join profiles p on p.id = c.actor_id
  left join activities a on a.id = c.activity_id
  left join campaigns ca on ca.id = a.campaign_id;
end $$;
revoke execute on function push_claim_pending() from anon, authenticated, public;
grant execute on function push_claim_pending() to authenticated;  -- gate real é o is_cron()

-- ── Lembrete de entrada (ponto) ──────────────────────────────────────────────
create table if not exists push_lembrete_log (
  colaborador_id uuid not null references rh_colaborador(id) on delete cascade,
  dia            date not null,
  tipo           text not null,
  sent_at        timestamptz not null default now(),
  primary key (colaborador_id, dia, tipo)
);
alter table push_lembrete_log enable row level security;  -- sem policy: só security definer

create or replace function rh_push_lembrete_entrada()
returns table (user_id uuid, entrada text, org_slug text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_hoje date; v_agora time;
begin
  if not is_cron() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  v_hoje  := (now() at time zone 'America/Sao_Paulo')::date;
  v_agora := (now() at time zone 'America/Sao_Paulo')::time;
  if extract(isodow from v_hoje) >= 6 then return; end if;  -- fim de semana não cobra

  return query
  with alvo as (
    select c.id as colab, c.membro_user_id as uid, c.org_id,
           coalesce(j.entrada, time '08:30') as hora_entrada
    from rh_colaborador c
    left join lateral (
      select j2.entrada from rh_jornada j2
      where j2.colaborador_id = c.id or (j2.org_id = c.org_id and j2.colaborador_id is null)
      order by j2.colaborador_id nulls last limit 1
    ) j on true
    where c.status = 'ativo' and c.membro_user_id is not null
  ),
  pend as (
    select a.colab, a.uid, a.org_id, a.hora_entrada
    from alvo a
    -- janela: 10 min antes até 40 min depois da entrada — passou disso, cobrar
    -- de manhã inteira vira ruído (e o PontoPrompt/Gate cobrem quem abrir o app)
    where v_agora >= a.hora_entrada - interval '10 minutes'
      and v_agora <= a.hora_entrada + interval '40 minutes'
      -- só cobra quem PODE receber (tem aparelho inscrito)
      and exists (select 1 from push_subscriptions ps where ps.user_id = a.uid)
      -- já bateu hoje → nada a cobrar
      and not exists (
        select 1 from rh_ponto p join rh_marcacao m on m.ponto_id = p.id
        where p.colaborador_id = a.colab and p.data = v_hoje)
      -- feriado que abona não espera ponto
      and not exists (
        select 1 from rh_feriado f
        where f.org_id = a.org_id and f.data = v_hoje and f.abona)
      -- férias/atestado/falta registrada (qualquer justificativa não-rejeitada)
      and not exists (
        select 1 from rh_justificativa jx
        where jx.colaborador_id = a.colab and jx.status <> 'rejeitado'
          and jx.data_ini <= v_hoje and jx.data_fim >= v_hoje)
      -- 1 lembrete por dia
      and not exists (
        select 1 from push_lembrete_log l
        where l.colaborador_id = a.colab and l.dia = v_hoje and l.tipo = 'entrada')
  ),
  ins as (
    insert into push_lembrete_log (colaborador_id, dia, tipo)
    select pend.colab, v_hoje, 'entrada' from pend
    on conflict do nothing
    returning colaborador_id
  )
  select pend.uid, to_char(pend.hora_entrada, 'HH24:MI'), o.slug
  from pend
  join ins on ins.colaborador_id = pend.colab
  join organizations o on o.id = pend.org_id;
end $$;
revoke execute on function rh_push_lembrete_entrada() from anon, authenticated, public;
grant execute on function rh_push_lembrete_entrada() to authenticated;  -- gate real é o is_cron()

notify pgrst, 'reload schema';
