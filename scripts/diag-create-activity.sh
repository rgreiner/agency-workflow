for N in $(docker ps --format '{{.Names}}'); do
  HAS=$(docker exec -i "$N" psql -U postgres -d postgres -tAc "select 1 from pg_class where relname='activities' and relkind='r' limit 1" 2>/dev/null)
  if [ "$HAS" = "1" ]; then
    echo ">>> Flow em $N"
    echo '--- Assinaturas de create_activity que existem HOJE ---'
    docker exec -i "$N" psql -U postgres -d postgres -c "
      select p.oid, pg_get_function_identity_arguments(p.oid) as assinatura
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='create_activity'
      order by p.oid;"
  fi
done
