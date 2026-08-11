-- 231_fin_movimentos_historico.sql
-- Fechamento contábil: a aba Extrato lia `extrato_importado` DIRETO. Com a base
-- da Conta Azul parada no corte de 16/07/2026 e tudo passando a nascer no Flow,
-- agosto/2026 sairia com a aba VAZIA — o pacote do mês chegaria na contabilidade
-- sem extrato nenhum, em silêncio. (Medido em produção: 0 movimento realizado em
-- `extrato_importado` desde 17/07.)
--
-- A fonte passa a ser `fin_movimentos` (185), que já é a fonte única do caixa:
-- histórico do extrato + o livro-caixa vivo, sem contar duas vezes o que veio
-- das duas fontes. Só faltava nela o que o escritório de fato LÊ pra classificar
-- cada linha — o histórico e o contato.
--
-- Esta migration só acrescenta `descricao` e `contato`. A régua de dedupe, os
-- três ramos e as colunas anteriores ficam idênticos.
--
-- ⚠️ `with (security_invoker = true)` é obrigatório e NÃO sobrevive a um
-- `create or replace` sem ele (foi assim que o livro-caixa vazou — migration 181).
-- Idempotente.

drop view if exists fin_movimentos;
create view fin_movimentos with (security_invoker = true) as
-- (1) Realizado histórico: extrato da Conta Azul.
select
  e.org_id,
  'extrato'::text                                          as fonte,
  'realizado'::text                                        as situacao,
  e.data_mov                                               as data_mov,
  coalesce(e.data_prevista, e.venc_original, e.data_mov)   as data_prevista,
  e.tipo                                                   as tipo,        -- receita | despesa
  abs(coalesce(e.valor, 0))                                as valor,
  null::uuid                                               as conta_id,
  e.conta                                                  as conta,
  e.categoria                                              as categoria,
  e.centro_custo                                           as centro_custo,
  (coalesce(e.origem, '') = 'Transferência'
    or coalesce(e.situacao, '') = 'Transferido'
    or lower(coalesce(e.categoria, '')) like 'transfer%')  as transferencia,
  e.descricao                                              as descricao,
  e.contato                                                as contato
from extrato_importado e
where e.situacao in ('Conciliado', 'Quitado', 'Transferido')
  and e.data_mov is not null

union all

-- (2) Realizado do livro-caixa, pulando o que o extrato já contou.
select
  l.org_id, 'lancamento', 'realizado',
  l.data_liquidacao,
  coalesce(l.vencimento, l.data_liquidacao),
  case when l.tipo = 'entrada' then 'receita' else 'despesa' end,
  abs(coalesce(l.valor_realizado, l.valor, 0)),
  l.conta_id, c.nome, l.categoria, l.centro_custo,
  (l.transferencia_id is not null or lower(coalesce(l.categoria, '')) like 'transfer%'),
  l.descricao, l.contato_nome
from lancamentos l
left join contas_financeiras c on c.id = l.conta_id
where l.situacao in ('pago', 'recebido')
  and l.data_liquidacao is not null
  and (l.origem_ref is null or not exists (
        select 1 from extrato_importado e
        where e.org_id = l.org_id and e.import_ref = l.origem_ref
          and e.situacao in ('Conciliado', 'Quitado', 'Transferido')))

union all

-- (3) Previsto: só o livro-caixa. O "em aberto" do extrato é o MESMO título já
-- semeado como lançamento — incluir os dois dobraria a previsão inteira.
select
  l.org_id, 'lancamento', 'previsto',
  null::date,
  l.vencimento,
  case when l.tipo = 'entrada' then 'receita' else 'despesa' end,
  abs(coalesce(l.valor, 0)),
  l.conta_id, c.nome, l.categoria, l.centro_custo,
  (l.transferencia_id is not null or lower(coalesce(l.categoria, '')) like 'transfer%'),
  l.descricao, l.contato_nome
from lancamentos l
left join contas_financeiras c on c.id = l.conta_id
where l.situacao = 'em_aberto'
  and l.vencimento is not null;

revoke all on fin_movimentos from anon;
grant select on fin_movimentos to authenticated;

notify pgrst, 'reload schema';
