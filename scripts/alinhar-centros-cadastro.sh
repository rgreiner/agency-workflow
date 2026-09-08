#!/bin/sh
# Alinha ao CADASTRO a grafia do centro de custo dos lançamentos nascidos no Flow
# ("É O Amor" do cliente → "É o Amor" do cadastro). Só origem do Flow: conta_azul/ofx
# ficam como a fonte escreveu (mig. 250). Idempotente; lista antes e depois.
# Uso: ssh root@72.61.27.227 'sh -s' < /Users/rafaelgreiner/Repositorio-rgreiner/agency-workflow/scripts/alinhar-centros-cadastro.sh
#
# Container: o Postgres do Flow roda com a imagem sem tag; filtra por quem tem
# POSTGRES_USER e pelo TRIO activities+org_settings+lancamentos (outro app no VPS
# tem uma `lancamentos` própria).
for N in $(docker ps --format '{{.Names}}'); do
  docker inspect "$N" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -q '^POSTGRES_USER=' || continue
  HAS=$(docker exec -i "$N" psql -U postgres -d postgres -tAc "select 1 where (select count(*) from pg_class where relname in ('activities','org_settings','lancamentos') and relkind='r') = 3" 2>/dev/null)
  [ "$HAS" = "1" ] || continue
  echo ">>> Flow em $N"
  docker exec -i "$N" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
begin;
\echo '== [antes] lançamentos cuja grafia do centro difere do centro ATIVO de mesma chave =='
create temp table _cad on commit drop as
  select distinct on (o.org_id, fin_chave_nome(c->>'nome')) o.org_id, c->>'nome' as nome, fin_chave_nome(c->>'nome') as chave
  from org_settings o, jsonb_array_elements(coalesce(o.finance_centros_custo,'[]'::jsonb)) c
  where not coalesce((c->>'arquivado')::boolean,false) and nullif(btrim(c->>'nome'),'') is not null
  order by o.org_id, fin_chave_nome(c->>'nome'), c->>'nome';
select l.id, l.origem_tipo, l.created_at::date as criado, l.centro_custo as de, k.nome as para
from lancamentos l join _cad k on k.org_id=l.org_id and k.chave=fin_chave_nome(l.centro_custo)
where l.centro_custo <> k.nome
order by l.created_at;

\echo ''
\echo '== [update] só origem do Flow (fora conta_azul/ofx) =='
update lancamentos l set centro_custo = k.nome, updated_at = now()
from _cad k
where k.org_id=l.org_id and k.chave=fin_chave_nome(l.centro_custo) and l.centro_custo <> k.nome
  and coalesce(l.origem_tipo,'') not in ('conta_azul','ofx')
returning l.id, l.origem_tipo, l.centro_custo as agora;

\echo ''
\echo '== [depois] o que ainda não bate exato com um centro ativo (esperado: só conta_azul, arquivados e ausentes do cadastro) =='
select l.centro_custo, l.origem_tipo, count(*) as lancs
from lancamentos l
where coalesce(l.centro_custo,'') <> ''
  and not exists (select 1 from _cad k where k.org_id=l.org_id and k.nome=l.centro_custo)
group by 1,2 order by 1,2;
commit;
SQL
done
