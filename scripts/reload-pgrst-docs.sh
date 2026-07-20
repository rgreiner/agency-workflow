for N in $(docker ps --format '{{.Names}}'); do
  HAS=$(docker exec -i "$N" psql -U postgres -d postgres -tAc "select 1 from pg_class where relname='activities' and relkind='r' limit 1" 2>/dev/null)
  if [ "$HAS" = "1" ]; then
    echo ">>> Flow DB em $N"
    echo "-- colunas novas em documents (devem aparecer 3):"
    docker exec -i "$N" psql -U postgres -d postgres -tAc "select column_name from information_schema.columns where table_name='documents' and column_name in ('archived','briefing_workspace_id','briefing_campaign_id') order by 1"
    echo "-- recarregando schema do PostgREST:"
    docker exec -i "$N" psql -U postgres -d postgres -c "notify pgrst, 'reload schema'"
  fi
done
