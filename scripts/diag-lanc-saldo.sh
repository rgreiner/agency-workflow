for N in $(docker ps --format '{{.Names}}'); do
  HAS=$(docker exec -i "$N" psql -U postgres -d postgres -tAc "select 1 from pg_class where relname='activities' and relkind='r' limit 1" 2>/dev/null)
  if [ "$HAS" = "1" ]; then
    echo ">>> Flow em $N"
    docker exec -i "$N" psql -U postgres -d postgres <<'SQL'
\echo '== [SALDO] Cresol x Sisprime: conta (saldo_inicial) vs extrato realizado =='
select c.nome, c.saldo_inicial,
       (select round(sum(case when e.situacao in ('Conciliado','Quitado','Transferido')
              then (case when e.tipo='receita' then abs(e.valor) when e.tipo='despesa' then -abs(e.valor) else 0 end) else 0 end),2)
        from extrato_importado e where e.org_id=c.org_id and lower(e.conta)=lower(c.nome)) as extrato_realizado
from contas_financeiras c where c.nome ~* 'cresol|sisprime' order by c.nome;
\echo ''
\echo '== [EDIT] Situações distintas no extrato (o bulk só promove Em aberto/Atrasado) =='
select situacao, count(*) from extrato_importado group by 1 order by 2 desc;
\echo ''
\echo '== [EDIT] Linhas Distribuicao de Lucros / Rafael: existe lançamento com esse origem_ref? =='
select e.situacao, e.venc_original, e.valor, left(e.import_ref,60) as import_ref,
       exists(select 1 from lancamentos l where l.org_id=e.org_id and l.origem_ref=e.import_ref) as tem_lanc
from extrato_importado e
where e.descricao ~* 'distribui' or e.contato ~* 'rafael greiner'
order by e.venc_original limit 12;
\echo ''
\echo '== [EDIT] Duplicados: origem_ref com mais de 1 lançamento =='
select count(*) as origem_refs_duplicados from (select origem_ref from lancamentos where origem_ref is not null group by origem_ref having count(*)>1) x;
\echo ''
\echo '== [EDIT] Previstos NAO promovidos (Em aberto/Atrasado sem lançamento) =='
select count(*) from extrato_importado e where e.situacao in ('Em aberto','Atrasado')
  and not exists(select 1 from lancamentos l where l.org_id=e.org_id and l.origem_ref=e.import_ref);
SQL
  fi
done
