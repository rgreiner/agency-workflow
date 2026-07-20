-- Reset do OFX (ponto de corte = hoje). Apaga TODO o OFX importado (movimentos +
-- conciliações + lançamentos de rendimento criados por ele) e zera o saldo do banco,
-- pra recomeçar limpo na segunda. Não toca em lançamentos do Conta Azul/faturamento.
do $$
declare v_afet uuid[]; r uuid;
begin
  select array_agg(distinct i.lancamento_id) into v_afet
    from btg_conciliacao_itens i join btg_movements m on m.id = i.movement_id
    where m.fonte = 'ofx';
  delete from btg_conciliacao_itens i using btg_movements m
    where m.id = i.movement_id and m.fonte = 'ofx';
  delete from lancamentos where origem_tipo = 'ofx';   -- rendimentos auto-criados
  delete from btg_movements where fonte = 'ofx';
  if v_afet is not null then
    foreach r in array v_afet loop
      if exists (select 1 from lancamentos where id = r) then
        perform _recompute_lanc_conciliacao(r);
      end if;
    end loop;
  end if;
end $$;
update contas_financeiras set saldo_banco = null, saldo_banco_data = null;
