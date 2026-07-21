#!/bin/sh
# Testa a 138 em produção SEM gravar: begin; <migration>; <verificação>; rollback;
# Acha o Postgres do Flow pelo trio activities+org_settings+lancamentos.
for N in $(docker ps --format '{{.Names}}'); do
  docker inspect "$N" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | grep -q '^POSTGRES_USER=' || continue
  HAS=$(docker exec -i "$N" psql -U postgres -d postgres -tAc \
    "select 1 where (select count(*) from pg_class
       where relname in ('activities','org_settings','lancamentos') and relkind='r') = 3" 2>/dev/null)
  [ "$HAS" = "1" ] || continue
  echo ">>> Flow em $N"
  docker exec -i "$N" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
begin;

\i /tmp/138_categorias_arvore.sql

\echo ''
\echo '== Árvore resultante: macro-grupo, tipo, nº de filhos =='
select g->>'nome' as macro, g->>'tipo' as tipo,
       jsonb_array_length(coalesce(g->'filhos','[]'::jsonb)) as filhos
from org_settings o, jsonb_array_elements(o.finance_categorias) g
order by g->>'tipo', g->>'nome';

\echo ''
\echo '== Conferência: total de categorias-folha (deve ser 72 originais + 3 orfas = 75) =='
select count(*) as folhas from (
  select f->>'nome'
  from org_settings o, jsonb_array_elements(o.finance_categorias) g,
       jsonb_array_elements(coalesce(g->'filhos','[]'::jsonb)) f) x;

\echo ''
\echo '== Conferência: alguma FOLHA AVULSA (macro sem filhos = erro de mapa)? =='
select g->>'nome' as avulsa_suspeita, g->>'tipo'
from org_settings o, jsonb_array_elements(o.finance_categorias) g
where jsonb_array_length(coalesce(g->'filhos','[]'::jsonb)) = 0;

\echo ''
\echo '== Conferência CRÍTICA: todo lançamento continua com categoria selecionável? =='
select count(distinct l.categoria) as categorias_orfas_em_lancamentos
from lancamentos l
where l.categoria is not null and l.categoria <> ''
  and not exists (
    select 1 from org_settings o, jsonb_array_elements(o.finance_categorias) g
    where o.org_id = l.org_id and (
      lower(g->>'nome') = lower(l.categoria)
      or exists (select 1 from jsonb_array_elements(coalesce(g->'filhos','[]'::jsonb)) f
                 where lower(f->>'nome') = lower(l.categoria))));

rollback;
\echo ''
\echo '== ROLLBACK feito — nada foi gravado. =='
SQL
done
