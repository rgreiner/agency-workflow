for N in $(docker ps --format '{{.Names}}'); do
  HAS=$(docker exec -i "$N" psql -U postgres -d postgres -tAc "select 1 from pg_class where relname='activities' and relkind='r' limit 1" 2>/dev/null)
  if [ "$HAS" = "1" ]; then
    echo ">>> Flow em $N"
    docker exec -i "$N" psql -U postgres -d postgres <<'SQL'
\echo '== [1] Contas: saldo_inicial vs extrato_importado (tela da conta) vs lancamentos (painel) =='
select c.nome, c.saldo_inicial, c.saldo_banco, c.saldo_banco_data,
  coalesce((select round(sum(case when e.situacao in ('Conciliado','Quitado','Transferido') then e.valor else 0 end),2)
            from extrato_importado e where e.org_id=c.org_id and lower(e.conta)=lower(c.nome)),0) as extrato_realiz,
  coalesce((select round(sum(case when l.tipo='saida' then -l.valor else l.valor end),2)
            from lancamentos l where l.org_id=c.org_id and l.conta_id=c.id
              and l.situacao in ('pago','recebido','liquidado','conciliado')),0) as lanc_realiz
from contas_financeiras c order by c.nome;

\echo ''
\echo '== [2] OFX importado: por conta, lote (created_at), status =='
select m.conta_id, c.nome, date_trunc('minute', m.created_at) as lote, m.status,
       count(*) as qtd, round(sum(case when m.tipo='debit' then -m.valor else m.valor end),2) as soma
from btg_movements m left join contas_financeiras c on c.id=m.conta_id
where m.fonte='ofx'
group by 1,2,3,4 order by lote desc, c.nome;

\echo ''
\echo '== [3] Lancamentos criados pelo import (origem_tipo=ofx) =='
select date_trunc('minute', created_at) as lote, conta_id, count(*), round(sum(valor),2)
from lancamentos where origem_tipo='ofx' group by 1,2 order by 1 desc;

\echo ''
\echo '== [4] Movimentos OFX ja conciliados MANUALMENTE (perigo ao reverter) =='
select m.conta_id, date_trunc('minute', m.created_at) as lote, count(*) as conciliados_manual
from btg_movements m
where m.fonte='ofx' and m.status='conciliado'
  and not exists (select 1 from lancamentos l where l.id=m.lancamento_id and l.origem_tipo='ofx')
group by 1,2 order by 2 desc;

\echo ''
\echo '== [5] Amostra do lote mais recente =='
select m.data_mov, m.tipo, m.valor, left(m.descricao,50) as descricao, m.status, m.created_at
from btg_movements m where m.fonte='ofx'
order by m.created_at desc limit 15;
SQL
  fi
done
