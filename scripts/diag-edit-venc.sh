for N in $(docker ps --format '{{.Names}}'); do
  HAS=$(docker exec -i "$N" psql -U postgres -d postgres -tAc "select 1 from pg_class where relname='lancamentos' and relkind='r' limit 1" 2>/dev/null)
  if [ "$HAS" = "1" ]; then
    echo ">>> Flow em $N"
    docker exec -i "$N" psql -U postgres -d postgres <<'SQL'
\echo '== [A] conta_azul: origem_ref duplicado (mais de 1 lançamento p/ mesma linha) =='
select count(*) as origem_refs_com_duplicata
from (select origem_ref from lancamentos where origem_tipo='conta_azul' and origem_ref is not null group by origem_ref having count(*)>1) x;
\echo ''
\echo '== [B] conta_azul ORFAO: lançamento cujo origem_ref NAO casa nenhuma linha do extrato atual =='
select count(*) as orfaos
from lancamentos l
where l.origem_tipo='conta_azul' and l.origem_ref is not null
  and not exists (select 1 from extrato_importado e where e.org_id=l.org_id and e.import_ref=l.origem_ref);
\echo ''
\echo '== [C] SOMBRA: linha importada (nao ignorada) que TEM lançamento gemeo mas com import_ref != origem_ref por normalizacao? =='
\echo '     (linhas do extrato cujo import_ref aparece como origem_ref) — quantas casam de fato'
select
  (select count(*) from extrato_importado e where e.situacao not in ('Ignorado','Ignorada')) as extrato_ativo,
  (select count(distinct origem_ref) from lancamentos where origem_tipo=''||'conta_azul'||'' and origem_ref is not null) as refs_promovidos,
  (select count(*) from extrato_importado e where exists (select 1 from lancamentos l where l.org_id=e.org_id and l.origem_ref=e.import_ref)) as extrato_com_gemeo;
\echo ''
\echo '== [D] amostra Opera Empreendimentos: linhas no extrato x lançamentos (comparar vencimento) =='
select 'LANC' as fonte, l.id::text, l.vencimento::text, l.competencia::text, left(l.origem_ref,50) as ref, l.updated_at::text
from lancamentos l where l.origem_tipo='conta_azul' and l.contato_nome ilike '%opera%'
union all
select 'EXTR', left(e.import_ref,8), e.venc_original::text, e.competencia::text, left(e.import_ref,50), e.data_mov::text
from extrato_importado e where e.contato ilike '%opera%'
order by 3 limit 30;
SQL
  fi
done
