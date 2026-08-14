-- 232_fin_categorias_competencia.sql
-- Receita e despesa POR CATEGORIA, dentro do mês de COMPETÊNCIA — o recorte que
-- faltava: o Fluxo de caixa mostra quando o dinheiro anda (caixa) e o Painel
-- agrega por trimestre/semestre/ano. Nenhum dos dois responde "quanto custou o
-- mês e quanto cada categoria pesou nele".
--
-- Duas mudanças:
--  (1) `fin_movimentos` ganha `competencia`. A view é a fonte única do caixa
--      (185/231) e já resolve a dedupe extrato × livro-caixa; refazer essa régua
--      numa segunda query seria a mesma conta em dois lugares.
--      Medido em produção: competência preenchida em 671/672 lançamentos e em
--      6.899/6.899 linhas do extrato — o coalesce abaixo é rede de segurança,
--      não o caminho normal.
--  (2) RPC agregada por (mês da competência, tipo, situação, categoria).
--      A tela não usa a linha, usa a soma: 7.006 linhas → 1.568 grupos.
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
  coalesce(e.competencia, e.data_mov)                      as competencia,
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
  coalesce(l.competencia, l.data_liquidacao, l.vencimento),
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
  coalesce(l.competencia, l.vencimento),
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

-- SECURITY DEFINER passando por cima de `fin_movimentos`: a view é
-- security_invoker, mas dentro de uma função definer o "invoker" é o dono
-- (postgres), então a RLS das tabelas de baixo NÃO é avaliada. O guard aqui é a
-- única barreira — e ele LEVANTA em vez de devolver vazio: gráfico em branco num
-- painel financeiro lê-se como "não teve custo", que é uma decisão errada.
create or replace function fin_categorias_competencia(p_org uuid)
returns table (
  mes date, tipo text, situacao text, categoria text, valor numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (fin_can(p_org) or is_psql_direto()) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  return query
    select date_trunc('month', m.competencia)::date,
           m.tipo, m.situacao,
           coalesce(nullif(btrim(m.categoria), ''), '(sem categoria)'),
           round(sum(abs(coalesce(m.valor, 0))), 2)
      from fin_movimentos m
     where m.org_id = p_org
       and m.competencia is not null
       -- Transferência entre contas é dinheiro mudando de bolso: não é receita
       -- nem despesa, e entrar aqui inflaria os dois gráficos com o mesmo valor.
       and coalesce(m.transferencia, false) = false
     group by 1, 2, 3, 4;
end $$;

revoke execute on function fin_categorias_competencia(uuid) from public, anon;
grant  execute on function fin_categorias_competencia(uuid) to authenticated;

notify pgrst, 'reload schema';
