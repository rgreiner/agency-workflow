for N in $(docker ps --format '{{.Names}}'); do
  HAS=$(docker exec -i "$N" psql -U postgres -d postgres -tAc "select 1 from pg_class where relname='lancamentos' and relkind='r' limit 1" 2>/dev/null)
  if [ "$HAS" = "1" ]; then
    echo ">>> Flow em $N"
    docker exec -i "$N" psql -U postgres -d postgres <<'SQL'
\echo '== [LANC] cobertura vencimento x competencia =='
select count(*) as total,
       count(vencimento) as com_venc,
       count(competencia) as com_comp,
       count(*) filter (where vencimento is null) as sem_venc,
       count(*) filter (where vencimento = competencia) as venc_igual_comp
from lancamentos;
\echo ''
\echo '== [LANC] por origem: quantos sem vencimento / venc=comp =='
select coalesce(origem_tipo,'(null)') as origem, count(*) as n,
       count(*) filter (where vencimento is null) as sem_venc,
       count(*) filter (where vencimento = competencia) as venc_igual_comp
from lancamentos group by 1 order by 2 desc;
\echo ''
\echo '== [LANC] amostra em aberto: o que a coluna Data mostra (=vencimento) =='
select left(coalesce(contato_nome,descricao,'—'),28) as quem, origem_tipo,
       vencimento, competencia, situacao
from lancamentos where situacao='em_aberto' order by vencimento nulls first limit 15;
\echo ''
\echo '== [EXTRATO] importado: venc_original x data_prevista x data_mov x competencia (o que vira vencimento) =='
select count(*) total,
       count(venc_original) com_venc_orig,
       count(data_prevista) com_data_prev,
       count(*) filter (where venc_original is null and data_prevista is null) cai_no_data_mov,
       count(competencia) com_comp
from extrato_importado;
SQL
  fi
done
