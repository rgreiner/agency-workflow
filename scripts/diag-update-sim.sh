for N in $(docker ps --format '{{.Names}}'); do
  HAS=$(docker exec -i "$N" psql -U postgres -d postgres -tAc "select 1 from pg_class where relname='lancamentos' and relkind='r' limit 1" 2>/dev/null)
  if [ "$HAS" = "1" ]; then
    echo ">>> Flow em $N"
    docker exec -i "$N" psql -U postgres -d postgres <<'SQL'
\echo '== [1] overloads de update_lancamento / promover_extrato (PostgREST exige 1 assinatura) =='
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('update_lancamento','promover_extrato','liquidar_lancamento')
order by 1,2;
\echo ''
\echo '== [2] qual origem_ref esta duplicado =='
select origem_ref, count(*), array_agg(id::text) ids, array_agg(vencimento::text) vencs
from lancamentos where origem_tipo='conta_azul' and origem_ref is not null
group by origem_ref having count(*)>1;
\echo ''
\echo '== [3] SIMULA edicao de vencimento (rollback) numa Opera de julho =='
begin;
select id, vencimento, origem_ref from lancamentos
 where origem_tipo='conta_azul' and contato_nome ilike '%opera%' and vencimento='2026-07-20' limit 1 \gset
\echo 'ANTES:'
select id, vencimento, origem_ref from lancamentos where id='':id'';
update lancamentos set vencimento='2026-07-28'::date, updated_at=now() where id='':id'';
\echo 'DEPOIS do UPDATE direto:'
select id, vencimento, origem_ref from lancamentos where id='':id'';
\echo 'A linha importada gemea ainda casa o origem_ref? (dedup esconde ela)'
select e.import_ref=l.origem_ref as casa, e.venc_original, e.situacao
from lancamentos l join extrato_importado e on e.import_ref=l.origem_ref
where l.id='':id'';
rollback;
SQL
  fi
done
