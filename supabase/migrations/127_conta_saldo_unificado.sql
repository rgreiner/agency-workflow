-- 127_conta_saldo_unificado.sql
-- O saldo da conta era calculado de 3 formas diferentes (lista de contas, interna da
-- conta e painel), e a interna somava o mesmo dinheiro duas vezes: o saldo_inicial
-- tinha sido semeado a partir do próprio extrato pela RPC atualizar_saldos_conta_azul
-- (124), e a tela somava saldo_inicial + realizado do extrato de novo.
--
-- Aqui: (1) zera o saldo_inicial semeado, (2) aposenta a RPC que o repopulava e
-- (3) cria a view contas_saldo como fonte única do saldo. Idempotente.

-- (1) saldo_inicial volta a significar "saldo antes do 1º movimento do extrato".
-- Só zera onde a igualdade com o extrato ainda se confirma — conta com saldo digitado
-- à mão é pulada em vez de zerada errado.
with ini as (
  select c.id, c.saldo_inicial,
    coalesce((select round(sum(e.valor), 2) from extrato_importado e
              where e.org_id = c.org_id and e.conta = c.nome
                and e.situacao in ('Conciliado', 'Quitado', 'Transferido')), 0) as extrato_realiz
  from contas_financeiras c
)
update contas_financeiras c set saldo_inicial = 0, updated_at = now()
from ini i
where i.id = c.id and i.saldo_inicial = i.extrato_realiz and c.saldo_inicial <> 0;

-- (2) A RPC gravava saldo_inicial = realizado do extrato, que é exatamente a dupla
-- contagem. Some junto com o botão "Atualizar saldos" da tela de importação.
drop function if exists atualizar_saldos_conta_azul(uuid, uuid);

-- (3) Fonte única do saldo. security_invoker para a RLS das tabelas-base valer aqui.
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
    -- realizado dos lançamentos próprios do Flow. origem_ref is null exclui os que
    -- foram promovidos do extrato, senão o mesmo dinheiro entraria duas vezes.
    + coalesce((select sum(case when l.tipo = 'saida'
                                then -coalesce(l.valor_realizado, l.valor)
                                else  coalesce(l.valor_realizado, l.valor) end)
                from lancamentos l
                where l.org_id = c.org_id and l.conta_id = c.id
                  and l.situacao in ('pago', 'recebido')
                  and l.origem_ref is null), 0)
  , 2) as saldo_atual
from contas_financeiras c;

grant select on contas_saldo to anon, authenticated;

notify pgrst, 'reload schema';
