for N in $(docker ps --format '{{.Names}}'); do
  HAS=$(docker exec -i "$N" psql -U postgres -d postgres -tAc "select 1 from pg_class where relname='activities' and relkind='r' limit 1" 2>/dev/null)
  if [ "$HAS" = "1" ]; then
    echo ">>> Flow em $N"
    docker exec -i "$N" psql -U postgres -d postgres <<'SQL'
\set ON_ERROR_STOP on
begin;

-- Lote unico de OFX: conta BTG Pactual, importado em 2026-07-20 11:41.
-- Nenhum movimento foi conciliado manualmente (verificado antes), entao a
-- remocao nao descarta trabalho humano.

create temp table _mov on commit drop as
  select id, lancamento_id from btg_movements
  where fonte = 'ofx'
    and conta_id = '18cee0cb-92cc-4003-b29f-7dd8d30e1289'
    and created_at::date = '2026-07-20';

select count(*) as movimentos_a_remover from _mov;

delete from btg_conciliacao_itens where movement_id in (select id from _mov);
delete from btg_movements       where id          in (select id from _mov);
delete from lancamentos
  where origem_tipo = 'ofx'
    and conta_id = '18cee0cb-92cc-4003-b29f-7dd8d30e1289';

update contas_financeiras
  set saldo_banco = null, saldo_banco_data = null
  where id = '18cee0cb-92cc-4003-b29f-7dd8d30e1289';

\echo '-- conferencia (tudo deve ser 0) --'
select
  (select count(*) from btg_movements where fonte='ofx') as movs_ofx,
  (select count(*) from lancamentos where origem_tipo='ofx') as lanc_ofx,
  (select count(*) from btg_conciliacao_itens i
     join btg_movements m on m.id=i.movement_id where m.fonte='ofx') as itens_ofx;

commit;
SQL
  fi
done
