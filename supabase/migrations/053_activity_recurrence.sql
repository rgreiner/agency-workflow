-- ── Prazos recorrentes ───────────────────────────────────────────────────────
-- Ao concluir uma tarefa recorrente, ela "reseta" no lugar: volta ao status
-- inicial (briefing) com o próximo prazo (due_date/start_date + intervalo).
--   recurrence            = frequência ('weekly'|'monthly'|'bimonthly'|
--                           'quarterly'|'semiannual'|'annual'); NULL = não repete
--   recurrence_remaining  = quantas vezes ainda repete; NULL = sem limite

alter table activities add column if not exists recurrence text;
alter table activities add column if not exists recurrence_remaining integer;

-- Frequência -> intervalo de tempo.
create or replace function public.recurrence_interval(p_recurrence text)
 returns interval
 language sql
 immutable
as $$
  select case p_recurrence
    when 'weekly'     then interval '7 days'
    when 'monthly'    then interval '1 month'
    when 'bimonthly'  then interval '2 months'
    when 'quarterly'  then interval '3 months'
    when 'semiannual' then interval '6 months'
    when 'annual'     then interval '1 year'
    else null
  end;
$$;

-- Define/atualiza a recorrência de uma atividade.
create or replace function public.set_activity_recurrence(
  p_user_id uuid, p_activity_id uuid, p_recurrence text, p_remaining integer
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
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
     set recurrence = nullif(p_recurrence, ''),
         recurrence_remaining = case when nullif(p_recurrence, '') is null then null else p_remaining end,
         updated_at = now()
   where id = p_activity_id;
end;
$$;

-- Reabre a tarefa concluída no próximo ciclo (reset in-place). Retorna true se
-- de fato recorreu (era recorrente e ainda tinha repetições).
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

  select recurrence, recurrence_remaining, due_date, start_date
    into v_rec, v_rem, v_due, v_start
    from activities where id = p_activity_id;

  if v_rec is null then return false; end if;
  if v_rem is not null and v_rem <= 0 then return false; end if;

  v_int := public.recurrence_interval(v_rec);
  if v_int is null then return false; end if;

  update activities
     set status = 'briefing',
         due_date = case when v_due is not null then v_due + v_int else null end,
         start_date = case when v_start is not null then (v_start + v_int)::date else null end,
         recurrence_remaining = case when v_rem is null then null else v_rem - 1 end,
         updated_at = now()
   where id = p_activity_id;

  insert into activity_history (activity_id, from_status, to_status, changed_by, comment)
  values (p_activity_id, 'concluido', 'briefing', p_user_id, 'Recorrência: reaberta para o próximo prazo');

  return true;
end;
$$;

grant execute on function
  public.recurrence_interval(text),
  public.set_activity_recurrence(uuid, uuid, text, integer),
  public.recur_activity(uuid, uuid)
  to anon, authenticated;

notify pgrst, 'reload schema';
