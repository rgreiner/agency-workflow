for N in $(docker ps --format '{{.Names}}'); do
  HAS=$(docker exec -i "$N" psql -U postgres -d postgres -tAc "select 1 from pg_class where relname='activities' and relkind='r' limit 1" 2>/dev/null)
  if [ "$HAS" = "1" ]; then
    echo ">>> Flow em $N"
    docker exec -i "$N" psql -U postgres -d postgres <<'SQL'
\echo '== Contas (id, nome, saldo_inicial) =='
select id, nome, saldo_inicial from contas_financeiras order by nome;
\echo ''
\echo '== Movimentos OFX por conta e status (btg_movements fonte=ofx) =='
select coalesce(c.nome,'(sem conta)') conta, m.status, count(*) qtd, sum(case when m.tipo='credit' then m.valor else -m.valor end) saldo_liq
from btg_movements m left join contas_financeiras c on c.id=m.conta_id
where m.fonte='ofx' group by 1,2 order by 1,2;
\echo ''
\echo '== Lançamentos vindos do Conta Azul (origem_tipo=conta_azul) por situação =='
select situacao, count(*) qtd, sum(valor) total from lancamentos where origem_tipo='conta_azul' group by 1 order by 1;
\echo ''
\echo '== Extrato Conta Azul: realizados x previstos (base do saldo seedado) =='
select case when situacao in ('Conciliado','Quitado','Transferido') then 'realizado' when situacao in ('Em aberto','Atrasado') then 'previsto' else situacao end grupo,
       conta, count(*) qtd, sum(valor) soma_assinada
from extrato_importado group by 1,2 order by 2,1;
SQL
  fi
done
