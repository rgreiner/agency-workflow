-- 113_due_date_para_date.sql
-- activities.due_date: timestamptz → date.
--
-- POR QUÊ: prazo é um DIA do calendário, não um instante. A coluna guardava
-- meia-noite UTC ('2026-07-17 00:00:00+00') pra representar "dia 17", e isso só
-- funcionava porque TODO MUNDO lia em UTC (o app faz slice(0,10) da string '+00' e
-- o PostgREST serializa em UTC). No dia em que o TimeZone do Postgres/PostgREST
-- virasse America/Sao_Paulo, esse mesmo instante viraria 16/07 21:00 e TODAS as datas
-- do app andariam um dia pra trás de uma vez — prazo, atrasado, Gantt, digest e os
-- `due_date::date` dentro das RPCs (o cast usa o fuso da sessão). Bomba silenciosa.
-- `start_date` já virou date na 020; due_date só ficou pra trás.
--
-- A HORA NÃO SE PERDE: ela nunca esteve aqui. O instante-limite é regra do app —
-- `deadlineAt()` em lib/utils = 19h local do dia da entrega ("final do dia"). Rafael
-- confirmou (15/07/2026) que existe UMA opção só de prazo: fim do dia. Se um dia
-- quiserem "meio-dia | fim do dia", isso é uma COLUNA NOVA (ex.: due_period), não
-- ressuscitar o timestamptz.
--
-- CONVERSÃO: `at time zone 'UTC'` — o dado foi GRAVADO como meia-noite UTC, então é
-- em UTC que se lê o dia pretendido. Usar 'America/Sao_Paulo' aqui gravaria o bug de
-- -1 dia permanentemente (17 viraria 16). Idempotente.

-- ── Trava: aborta se algum prazo tiver hora real (a conversão descartaria) ───
do $$
declare n int;
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'activities' and column_name = 'due_date' and data_type = 'timestamp with time zone'
  ) then
    select count(*) into n from activities
    where due_date is not null and (due_date at time zone 'UTC')::time <> '00:00:00';
    if n > 0 then
      raise exception 'ABORTADO: % tarefa(s) com due_date fora da meia-noite UTC — converter descartaria a hora. Investigar antes de migrar.', n;
    end if;
  end if;
end $$;

alter table activities
  alter column due_date type date using (due_date at time zone 'UTC')::date;

-- ── Recorrência: date + interval = timestamp, precisa do cast de volta ──────
-- v_due era timestamptz; se ficasse assim, `select due_date into v_due` e a volta pro
-- update fariam um round-trip pelo fuso da SESSÃO — plantando de novo o bug que a
-- migração está matando. Agora espelha o que start_date já fazia: (v + interval)::date.
create or replace function public.recur_activity(p_user_id uuid, p_activity_id uuid)
returns boolean
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_rec   text;
  v_rem   integer;
  v_due   date;
  v_start date;
  v_reset activity_status;
  v_to    activity_status;
  v_int   interval;
begin
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
$$;

grant execute on function public.recur_activity(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
