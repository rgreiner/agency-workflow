-- 283_rotina_diaria.sql
-- Rotina DIÁRIA — faltava a opção no catálogo (Rafael, 08/09/2026). Diária aqui
-- é em DIAS ÚTEIS: prazo em sábado/domingo só geraria "atrasado" na segunda.
-- 'daily' entra em recurrence_interval (vale para qualquer tarefa recorrente) e
-- três lugares passam a pular o fim de semana: o próximo prazo ao recorrer (que,
-- na diária, nunca cai no passado: é o próximo dia útil depois de hoje), o
-- primeiro prazo ao ativar a rotina num cliente e o "esperado" da cobertura
-- (= dias úteis do período). Idempotente.

create or replace function public.recurrence_interval(p_recurrence text)
returns interval language sql immutable as $$
  select case p_recurrence
    when 'daily'      then interval '1 day'
    when 'weekly'     then interval '7 days'
    when 'biweekly'   then interval '14 days'
    when 'monthly'    then interval '1 month'
    when 'bimonthly'  then interval '2 months'
    when 'quarterly'  then interval '3 months'
    when 'semiannual' then interval '6 months'
    when 'annual'     then interval '1 year'
    else null
  end;
$$;

/** O próprio dia, se for útil; senão a próxima segunda. */
create or replace function public.proximo_dia_util(p_dia date)
returns date language sql immutable as $$
  select case extract(dow from p_dia)::int
    when 6 then p_dia + 2
    when 0 then p_dia + 1
    else p_dia
  end;
$$;

-- ── recur_activity: igual à 113, com a régua da diária ───────────────────────
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
  v_hoje  date;
  v_novo_due   date;
  v_novo_start date;
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

  if v_rec = 'daily' then
    -- Diária: o próximo dia útil DEPOIS de hoje. Somar 1 dia ao prazo antigo
    -- deixaria a tarefa nascer atrasada sempre que alguém concluísse com atraso.
    v_hoje := (now() at time zone 'America/Sao_Paulo')::date;
    v_novo_due   := case when v_due   is null then null else public.proximo_dia_util(greatest(v_due, v_hoje) + 1) end;
    v_novo_start := case when v_start is null then null else public.proximo_dia_util(greatest(v_start, v_hoje) + 1) end;
  else
    v_novo_due   := case when v_due   is not null then (v_due + v_int)::date else null end;
    v_novo_start := case when v_start is not null then (v_start + v_int)::date else null end;
  end if;

  update activities
     set status = v_to,
         due_date = v_novo_due,
         start_date = v_novo_start,
         recurrence_remaining = case when v_rem is null then null else v_rem - 1 end,
         updated_at = now()
   where id = p_activity_id;

  insert into activity_history (activity_id, from_status, to_status, changed_by, comment)
  values (p_activity_id, 'concluido', v_to, p_user_id, 'Recorrência: reaberta para o próximo prazo');

  return true;
end;
$$;

-- ── primeiro prazo ao ativar a rotina: diária = hoje, se útil ────────────────
create or replace function midia_primeiro_prazo(
  p_frequencia text, p_dia_mes int, p_dia_semana int, p_hoje date
) returns date language sql immutable as $$
  select case
    when p_frequencia = 'daily' then public.proximo_dia_util(p_hoje)
    when p_dia_mes is not null then
      case when extract(day from p_hoje)::int <= p_dia_mes
           then date_trunc('month', p_hoje)::date + (p_dia_mes - 1)
           else (date_trunc('month', p_hoje) + interval '1 month')::date + (p_dia_mes - 1)
      end
    when p_dia_semana is not null then
      p_hoje + ((p_dia_semana - extract(dow from p_hoje)::int + 7) % 7)
    else p_hoje
  end;
$$;

-- ── cobertura: esperado da diária = dias úteis do período ────────────────────
create or replace function midia_cobertura(p_org uuid, p_ini date, p_fim date)
returns table (
  workspace_id uuid, cliente text, rotina_id uuid, rotina text, frequencia text,
  activity_id uuid, prazo date, status text,
  esperado int, feitas int, ultima_conclusao timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not midia_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return query
  with vinculo as (
    select cr.id, cr.rotina_id, cr.activity_id, cr.origem_activity_id,
           mc.workspace_id, w.name as cliente,
           r.nome as rotina, r.frequencia, r.dia_semana, r.ordem,
           a.due_date, a.status
      from midia_cliente_rotina cr
      join midia_cliente mc on mc.id = cr.midia_cliente_id
      join workspaces w     on w.id = mc.workspace_id
      join midia_rotina r   on r.id = cr.rotina_id
      left join activities a on a.id = cr.activity_id
     where cr.org_id = p_org and cr.ativo
  ),
  conclusoes as (
    select v.id as vinculo_id, count(*) as feitas, max(h.changed_at) as ultima
      from vinculo v
      join activity_history h
        on h.activity_id in (v.activity_id, v.origem_activity_id)
     where h.to_status = 'concluido'
       and h.changed_at >= p_ini::timestamptz
       and h.changed_at <  (p_fim + 1)::timestamptz
     group by v.id
  )
  select v.workspace_id, v.cliente, v.rotina_id, v.rotina, v.frequencia,
         v.activity_id, v.due_date, v.status,
         case
           when v.frequencia = 'daily' then
             (select count(*)::int from generate_series(p_ini, p_fim, interval '1 day') d
               where extract(dow from d) between 1 and 5)
           when v.frequencia = 'weekly' and v.dia_semana is not null then
             (select count(*)::int from generate_series(p_ini, p_fim, interval '1 day') d
               where extract(dow from d) = v.dia_semana)
           when v.frequencia = 'weekly' then
             greatest(1, ((p_fim - p_ini + 1) / 7))
           when v.frequencia = 'biweekly' then
             greatest(1, ((p_fim - p_ini + 1) / 14))
           else 1
         end as esperado,
         coalesce(c.feitas, 0)::int as feitas,
         c.ultima
    from vinculo v
    left join conclusoes c on c.vinculo_id = v.id
   order by v.cliente, v.ordem;
end $$;
revoke execute on function midia_cobertura(uuid, date, date) from anon, public;
grant  execute on function midia_cobertura(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
