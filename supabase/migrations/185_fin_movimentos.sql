-- 185_fin_movimentos.sql
-- Auditoria 02/08 — Financeiro, achado 1: Fluxo de caixa, DRE e os indicadores da
-- Gestão liam SÓ `extrato_importado`, que parou de receber dado no corte de
-- 16/07/2026. As três telas que respondem "como está o caixa" mostravam um
-- retrato envelhecendo, com o livro-caixa vivo (`lancamentos`) ao lado.
--
-- Trocar a fonte não é só apontar pra outra tabela: as duas se sobrepõem. Medido
-- em produção hoje:
--   • 117 dos 168 lançamentos LIQUIDADOS vieram do extrato (têm `origem_ref`) —
--     somar as duas fontes contaria R$ 252 mil duas vezes;
--   • 454 dos 493 lançamentos EM ABERTO também vieram de lá, e os totais batem
--     (R$ 560.130 a receber no livro × R$ 560.378 no extrato) — é o mesmo título
--     em dois lugares;
--   • o extrato tem histórico REAL que o livro não tem: caixa desde 2023-05,
--     enquanto `lancamentos` começa em 2026-02.
--
-- Então a regra é: histórico realizado vem do extrato, o que veio depois vem do
-- livro, e o previsto vem SÓ do livro. É exatamente a régua que a view
-- `contas_saldo` já usa pro saldo da conta (pular o lançamento cujo `origem_ref`
-- aponta pra uma linha realizada do extrato) — aqui ela vira fonte única, pra
-- não existir uma terceira interpretação de "quanto entrou".
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
    or lower(coalesce(e.categoria, '')) like 'transfer%')  as transferencia
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
  (l.transferencia_id is not null or lower(coalesce(l.categoria, '')) like 'transfer%')
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
  (l.transferencia_id is not null or lower(coalesce(l.categoria, '')) like 'transfer%')
from lancamentos l
left join contas_financeiras c on c.id = l.conta_id
where l.situacao = 'em_aberto'
  and l.vencimento is not null;

revoke all on fin_movimentos from anon;
grant select on fin_movimentos to authenticated;

-- ── dashboard_financeiro: mesma fonte única ─────────────────────────────────
-- Mudou a fonte e nada mais da assinatura. A DRE passa a devolver TODA categoria
-- que aparece no período — inclusive as que não estão no template contábil, que
-- antes sumiam do relatório sem aviso (achado "DRE descarta em silêncio"). Quem
-- decide como exibir o que está fora da estrutura é a tela.
create or replace function dashboard_financeiro(p_user_id uuid, p_org_id uuid, p_mes text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_role text; v_mes date; v_fim date; v_dre_ini date;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select role into v_role from organization_members
   where org_id = p_org_id and user_id = p_user_id and arquivado = false;
  if v_role is null or v_role <> 'owner' then raise exception 'Acesso negado'; end if;

  v_mes := (coalesce(nullif(p_mes, ''), to_char(current_date, 'YYYY-MM')) || '-01')::date;
  v_fim := (v_mes + interval '1 month')::date;
  v_dre_ini := (v_mes - interval '5 months')::date;

  with mv as (
    select situacao, data_mov, data_prevista, tipo, valor, categoria
    from fin_movimentos
    where org_id = p_org_id and transferencia = false
  ),
  prod as (select tipo, situacao, valor from producao where org_id = p_org_id and archived = false),
  mid  as (select tipo, situacao, valor from midias   where org_id = p_org_id and archived = false)
  select jsonb_build_object(
    'mes', to_char(v_mes, 'YYYY-MM'),
    'a_receber',          (select coalesce(sum(valor), 0) from mv where situacao = 'previsto'  and tipo = 'receita' and data_prevista >= v_mes and data_prevista < v_fim),
    'a_pagar',            (select coalesce(sum(valor), 0) from mv where situacao = 'previsto'  and tipo = 'despesa' and data_prevista >= v_mes and data_prevista < v_fim),
    'recebido',           (select coalesce(sum(valor), 0) from mv where situacao = 'realizado' and tipo = 'receita' and data_mov >= v_mes and data_mov < v_fim),
    'pago',               (select coalesce(sum(valor), 0) from mv where situacao = 'realizado' and tipo = 'despesa' and data_mov >= v_mes and data_mov < v_fim),
    'a_receber_atrasado', (select coalesce(sum(valor), 0) from mv where situacao = 'previsto'  and tipo = 'receita' and data_prevista < current_date),
    'a_pagar_atrasado',   (select coalesce(sum(valor), 0) from mv where situacao = 'previsto'  and tipo = 'despesa' and data_prevista < current_date),
    'producao_pendente',  (select jsonb_build_object('n', count(*), 'total', coalesce(sum(valor), 0)) from prod where situacao = 'em_aberto'),
    'producao_faturar',   (select jsonb_build_object('n', count(*), 'total', coalesce(sum(valor), 0)) from prod where situacao = 'faturar'),
    'midia_pendente',     (select jsonb_build_object('n', count(*), 'total', coalesce(sum(valor), 0)) from mid where situacao = 'em_aberto'),
    'midia_por_tipo',     coalesce((select jsonb_agg(row_to_json(t)) from (select tipo, count(*) n, coalesce(sum(valor), 0) total from mid where situacao = 'em_aberto' group by tipo order by total desc) t), '[]'),
    'dre_meses', coalesce((select jsonb_agg(to_char(m, 'YYYY-MM')) from generate_series(v_dre_ini, v_mes, interval '1 month') m), '[]'),
    -- valor COM SINAL (receita +, despesa −), por categoria e mês
    'dre_real', coalesce((select jsonb_agg(row_to_json(t)) from (
        select coalesce(nullif(categoria, ''), '(sem categoria)') categoria,
               to_char(date_trunc('month', data_mov), 'YYYY-MM') mes,
               sum(case when tipo = 'despesa' then -valor else valor end) v
        from mv where situacao = 'realizado' and data_mov >= v_dre_ini and data_mov < v_fim
        group by 1, 2) t), '[]'),
    'dre_prev', coalesce((select jsonb_agg(row_to_json(t)) from (
        select coalesce(nullif(categoria, ''), '(sem categoria)') categoria,
               to_char(date_trunc('month', data_prevista), 'YYYY-MM') mes,
               sum(case when tipo = 'despesa' then -valor else valor end) v
        from mv where situacao = 'previsto' and data_prevista >= v_dre_ini and data_prevista < v_fim
        group by 1, 2) t), '[]')
  ) into v;
  return v;
end $$;

revoke execute on function dashboard_financeiro(uuid, uuid, text) from public, anon;
grant execute on function dashboard_financeiro(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
