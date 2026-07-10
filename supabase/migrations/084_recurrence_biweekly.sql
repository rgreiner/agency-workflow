-- 084_recurrence_biweekly.sql
-- Adiciona a frequência 'biweekly' (quinzenal / a cada 2 semanas) na recorrência.
-- Só reescreve a função de intervalo (immutable). Idempotente.

create or replace function public.recurrence_interval(p_recurrence text)
 returns interval
 language sql
 immutable
as $$
  select case p_recurrence
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

notify pgrst, 'reload schema';
