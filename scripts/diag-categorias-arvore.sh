#!/bin/sh
# Read-only: fotografia das categorias financeiras antes de montar a árvore.
#
# Achar o container: o Postgres do Flow roda com a imagem SEM TAG (só o hash), então
# `--filter ancestor=postgres:17-alpine` NÃO o encontra. Filtra por quem tem o comando
# `postgres` — nunca docker exec em todo container (já derrubou um build).
#
# E a chave é o PAR activities+org_settings: existe outro app no VPS (banco `grana`)
# com uma tabela `lancamentos` própria; procurar só por ela acha o banco errado.
for N in $(docker ps --format '{{.Names}}'); do
  docker inspect "$N" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | grep -q '^POSTGRES_USER=' || continue
  HAS=$(docker exec -i "$N" psql -U postgres -d postgres -tAc \
    "select 1 where (select count(*) from pg_class
       where relname in ('activities','org_settings','lancamentos') and relkind='r') = 3" 2>/dev/null)
  [ "$HAS" = "1" ] || continue
  echo ">>> Flow em $N"
  docker exec -i "$N" psql -U postgres -d postgres <<'SQL'
\echo '== [1] Quantos grupos hoje, e quantos já têm filhos =='
select o.org_id,
       jsonb_array_length(coalesce(o.finance_categorias,'[]'::jsonb)) as grupos,
       (select count(*) from jsonb_array_elements(coalesce(o.finance_categorias,'[]'::jsonb)) g
         where jsonb_array_length(coalesce(g->'filhos','[]'::jsonb)) > 0) as com_filhos
from org_settings o;

\echo ''
\echo '== [2] Toda categoria de topo: nome, tipo, nº de filhos, e quanto já foi lançado =='
select g->>'nome' as nome, g->>'tipo' as tipo,
       jsonb_array_length(coalesce(g->'filhos','[]'::jsonb)) as filhos,
       (select count(*) from lancamentos l where l.org_id=o.org_id and l.categoria = g->>'nome') as lancs,
       (select round(coalesce(sum(abs(l.valor)),0),2) from lancamentos l
         where l.org_id=o.org_id and l.categoria = g->>'nome') as total
from org_settings o, jsonb_array_elements(coalesce(o.finance_categorias,'[]'::jsonb)) g
order by g->>'tipo', g->>'nome';

\echo ''
\echo '== [3] Categorias USADAS em lançamentos que NÃO existem no cadastro (órfãs) =='
select l.categoria, count(*), round(sum(abs(l.valor)),2) as total
from lancamentos l
where l.categoria is not null and l.categoria <> ''
  and not exists (
    select 1 from org_settings o, jsonb_array_elements(coalesce(o.finance_categorias,'[]'::jsonb)) g
    where o.org_id = l.org_id and (
      lower(g->>'nome') = lower(l.categoria)
      or exists (select 1 from jsonb_array_elements(coalesce(g->'filhos','[]'::jsonb)) f
                 where lower(f->>'nome') = lower(l.categoria))))
group by 1 order by 3 desc;

\echo ''
\echo '== [4] Nomes repetidos entre grupos (colidiriam ao virar filhos) =='
select lower(nome) as nome, count(*), string_agg(tipo, ' | ') as tipos from (
  select g->>'nome' as nome, g->>'tipo' as tipo
  from org_settings o, jsonb_array_elements(coalesce(o.finance_categorias,'[]'::jsonb)) g) x
group by 1 having count(*) > 1 order by 2 desc;
SQL
done
