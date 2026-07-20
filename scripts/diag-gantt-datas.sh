for N in $(docker ps --format '{{.Names}}'); do
  HAS=$(docker exec -i "$N" psql -U postgres -d postgres -tAc "select 1 from pg_class where relname='activities' and relkind='r' limit 1" 2>/dev/null)
  if [ "$HAS" = "1" ]; then
    echo ">>> Flow em $N"
    docker exec -i "$N" psql -U postgres -d postgres -c "
      select current_setting('TimeZone') as tz_do_banco,
             (select setting from pg_settings where name='TimeZone') as tz_setting;"
    docker exec -i "$N" psql -U postgres -d postgres -c "
      select left(title,34) as titulo,
             start_date,
             due_date                                        as due_instante,
             to_char(due_date,'YYYY-MM-DD\"T\"HH24:MI:SSOF')  as como_o_postgrest_serializa,
             (due_date at time zone 'America/Sao_Paulo')::date as dia_em_brt,
             (due_date at time zone 'UTC')::date              as dia_em_utc
      from activities
      where title ilike '%260619%'
      order by title limit 8;"
  fi
done
