for N in $(docker ps --format '{{.Names}}'); do
  HAS=$(docker exec -i "$N" psql -U postgres -d postgres -tAc "select 1 from pg_class where relname='activities' and relkind='r' limit 1" 2>/dev/null)
  if [ "$HAS" = "1" ]; then
    echo ">>> Flow em $N"
    docker exec -i "$N" psql -U postgres -d postgres <<'SQL'
\echo '== PRODUÇÃO existente (por série) =='
select coalesce(serie,'(sem série/orçamento)') serie, tipo, count(*) qtd, min(numero) menor, max(numero) maior
from producao group by 1,2 order by 2,1;
\echo ''
\echo '== MÍDIA existente (por série) =='
select coalesce(serie,'(sem série)') serie, tipo, count(*) qtd, min(numero) menor, max(numero) maior
from midias group by 1,2 order by 2,1;
\echo ''
\echo '== Contadores atuais (doc_series) =='
select serie, proximo_numero from doc_series order by serie;
\echo ''
\echo '== Docs do Flow com número ABAIXO do seed (candidatos a renumerar) =='
select 'producao' fonte, serie, numero, titulo, created_at::date from producao
  where serie is not null and numero < case serie when 'PP' then 1897 when 'FEE' then 64 when 'PR' then 145 else 999999 end
union all
select 'midia', serie, numero, titulo, created_at::date from midias
  where serie is not null and numero < case serie when 'MX' then 1626 when 'ME' then 1578 when 'MS' then 831 when 'MD' then 147 when 'MI' then 403 else 999999 end
order by 1,2,3;
SQL
  fi
done
