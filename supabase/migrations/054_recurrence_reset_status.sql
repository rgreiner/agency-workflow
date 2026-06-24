-- ── Recorrência: status de retorno configurável ─────────────────────────────
-- Antes a tarefa recorrente voltava sempre para 'briefing'. Agora dá pra escolher
-- em qual status ela reabre (ex.: já passou do briefing → volta direto p/ Mídia, ou
-- reinicia o ciclo criativo em Redação). NULL = mantém o padrão 'briefing'.

alter table activities add column if not exists recurrence_reset_status activity_status;

-- Substitui a assinatura antiga (4 args) pela nova com p_reset_status.
drop function if exists public.set_activity_recurrence(uuid, uuid, text, integer);

create or replace function public.set_activity_recurrence(
  p_user_id uuid, p_activity_id uuid, p_recurrence text, p_remaining integer, p_reset_status text
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare v_rec text := nullif(p_recurrence, '');
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

  update activities
     set recurrence = v_rec,
         recurrence_remaining = case when v_rec is null then null else p_remaining end,
         recurrence_reset_status = case when v_rec is null then null else nullif(p_reset_status, '')::activity_status end,
         updated_at = now()
   where id = p_activity_id;
end;
$$;

-- Reabre a tarefa concluída no próximo ciclo, no status de retorno escolhido
-- (coalesce p/ 'briefing'). Retorna true se de fato recorreu.
create or replace function public.recur_activity(p_user_id uuid, p_activity_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_rec   text;
  v_rem   integer;
  v_due   timestamptz;
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
         due_date = case when v_due is not null then v_due + v_int else null end,
         start_date = case when v_start is not null then (v_start + v_int)::date else null end,
         recurrence_remaining = case when v_rem is null then null else v_rem - 1 end,
         updated_at = now()
   where id = p_activity_id;

  insert into activity_history (activity_id, from_status, to_status, changed_by, comment)
  values (p_activity_id, 'concluido', v_to, p_user_id, 'Recorrência: reaberta para o próximo prazo');

  return true;
end;
$$;

grant execute on function
  public.set_activity_recurrence(uuid, uuid, text, integer, text),
  public.recur_activity(uuid, uuid)
  to anon, authenticated;

notify pgrst, 'reload schema';
