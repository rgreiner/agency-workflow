-- 134: saldo da conta passa a contar o lançamento PROMOVIDO do extrato quando ele foi
-- baixado no Flow (conciliação do OFX).
--
-- Bug: a 127 excluía TODO lançamento com origem_ref ("promovido do extrato") pra não
-- contar o mesmo dinheiro duas vezes. Só que o previsto do Conta Azul (extrato com
-- situacao 'Em aberto') virou lançamento e foi pago de verdade — a baixa caiu no
-- lançamento, que estava excluído, e a linha do extrato continuou 'Em aberto', que
-- também não soma. O dinheiro sumia do saldo e da movimentação da conta (ex.: FGTS,
-- DARF e um recebimento em 20-21/07/2026 = R$ 2.626,82 de diferença pro banco).
--
-- Correção: excluir só o promovido cuja linha do extrato JÁ está realizada — que é o
-- caso de dupla contagem de verdade. Promovido de previsto passa a somar pela baixa.
create or replace view contas_saldo with (security_invoker = true) as
select
  c.id, c.org_id, c.nome, c.tipo, c.cor, c.ativo, c.ordem,
  c.saldo_inicial, c.saldo_banco, c.saldo_banco_data,
  round(
    c.saldo_inicial
    -- realizado do extrato do Conta Azul (histórico)
    + coalesce((select sum(e.valor) from extrato_importado e
                where e.org_id = c.org_id and e.conta = c.nome
                  and e.situacao in ('Conciliado', 'Quitado', 'Transferido')), 0)
    -- realizado dos lançamentos do Flow
    + coalesce((select sum(case when l.tipo = 'saida'
                                then -coalesce(l.valor_realizado, l.valor)
                                else  coalesce(l.valor_realizado, l.valor) end)
                from lancamentos l
                where l.org_id = c.org_id and l.conta_id = c.id
                  and l.situacao in ('pago', 'recebido')
                  -- anti dupla contagem: só sai quem já é contado pela linha do extrato
                  and (l.origem_ref is null or not exists (
                        select 1 from extrato_importado e
                        where e.org_id = l.org_id and e.import_ref = l.origem_ref
                          and e.situacao in ('Conciliado', 'Quitado', 'Transferido')))), 0)
  , 2) as saldo_atual
from contas_financeiras c;

grant select on contas_saldo to anon, authenticated;

notify pgrst, 'reload schema';
