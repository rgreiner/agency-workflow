-- 281_presenca_diaria.sql
-- "Esqueci de bater a saída": que horas a pessoa ainda estava no Flow? (Rafael, 08/09/2026)
--
-- A presença do chat (057/058) já recebe um heartbeat a cada 25 s da aba visível,
-- mas guarda só o ÚLTIMO instante por pessoa — no dia seguinte o de ontem sumiu.
-- Medido em prod (90 dias): 36 justificativas "esqueci" em 62; o último EVENTO do
-- Flow (status, comentário, chat…) fica a 69 min (mediana) da saída batida e em
-- 23% dos dias não há evento nenhum — não serve de base. Este histórico serve.
--
-- Uma linha por pessoa por dia (~330/mês pra 15 pessoas): primeiro acesso e última
-- INTERAÇÃO (o cliente só manda p_interagiu quando houve mouse/teclado nos últimos
-- minutos — aba esquecida aberta não conta). Leitura só pela RPC rh_presenca_dias
-- (a própria pessoa ou quem tem RH), pra virar a dica "Última interação no Flow:
-- 17:52" nas telas de correção — sugestão, nunca preenchimento automático.
-- Idempotente. touch_presence: DROP+CREATE (parâmetro novo com default viraria
-- overload e o PostgREST recusa — 1 assinatura por RPC).

create table if not exists user_presence_dia (
  user_id     uuid not null references profiles(id) on delete cascade,
  dia         date not null,
  primeiro_em timestamptz not null default now(),
  ultimo_em   timestamptz not null default now(),
  primary key (user_id, dia)
);
alter table user_presence_dia enable row level security;
-- Sem policy de select de propósito: a leitura passa pela RPC (self ou RH).
revoke all on user_presence_dia from public, anon, authenticated;

drop function if exists touch_presence();
drop function if exists touch_presence(uuid);
create or replace function touch_presence(p_user_id uuid, p_interagiu boolean default true)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  -- presença do chat (online = visto há < 70 s), como antes
  insert into user_presence (user_id, last_seen_at) values (p_user_id, now())
  on conflict (user_id) do update set last_seen_at = now();
  -- histórico do dia: só com interação real
  if p_interagiu then
    insert into user_presence_dia (user_id, dia, primeiro_em, ultimo_em) values (p_user_id, v_dia, now(), now())
    on conflict (user_id, dia) do update set ultimo_em = now();
  end if;
end; $$;
revoke execute on function touch_presence(uuid, boolean) from public, anon;
grant execute on function touch_presence(uuid, boolean) to authenticated;

-- Presença por colaborador × dia. Quem pode ver: a própria pessoa ou quem tem RH na org.
create or replace function rh_presenca_dias(p_colaborador_ids uuid[], p_datas date[])
returns table (colaborador_id uuid, dia date, primeiro_em timestamptz, ultimo_em timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select c.id, d.dia, d.primeiro_em, d.ultimo_em
    from rh_colaborador c
    join user_presence_dia d on d.user_id = c.membro_user_id
   where c.id = any(p_colaborador_ids)
     and d.dia = any(p_datas)
     and (c.membro_user_id = auth.uid() or rh_can(c.org_id))
$$;
revoke execute on function rh_presenca_dias(uuid[], date[]) from public, anon;
grant execute on function rh_presenca_dias(uuid[], date[]) to authenticated;

notify pgrst, 'reload schema';
