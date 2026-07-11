-- 095_dashboard_financeiro_dre.sql
-- Aba Financeiro passa a ler o EXTRATO IMPORTADO (extrato_importado — fonte real de
-- caixa, igual ao Fluxo de caixa), não mais `lancamentos` (que está quase vazio).
-- Ganha uma DRE mensal: receita + despesas por categoria, previsto × realizado, nos
-- últimos 6 meses (o cliente agrupa por grupo). Transferências e "Perdido" ficam de
-- fora. Produção/mídia (o que acelerar) seguem vindo das tabelas do Flow. Só owner.

create or replace function dashboard_financeiro(p_user_id uuid, p_org_id uuid, p_mes text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_role text; v_mes date; v_fim date; v_dre_ini date;
begin
  select role into v_role from organization_members where org_id = p_org_id and user_id = p_user_id;
  if v_role is null or v_role <> 'owner' then raise exception 'Acesso negado'; end if;
  v_mes := (coalesce(nullif(p_mes, ''), to_char(current_date, 'YYYY-MM')) || '-01')::date;
  v_fim := (v_mes + interval '1 month')::date;
  v_dre_ini := (v_mes - interval '5 months')::date;   -- janela de 6 meses

  with ex as (
    select tipo, situacao, categoria, valor, data_mov, data_prevista, venc_original
    from extrato_importado
    where org_id = p_org_id
      and coalesce(origem, '') <> 'Transferência'
      and coalesce(situacao, '') not in ('Transferido', 'Perdido/Desconsiderado')
  ),
  prod as (select tipo, situacao, valor from producao where org_id = p_org_id and archived = false),
  mid  as (select tipo, situacao, valor from midias   where org_id = p_org_id and archived = false)
  select jsonb_build_object(
    'mes', to_char(v_mes, 'YYYY-MM'),
    -- Fluxo do mês (previsto e realizado), do extrato
    'a_receber',          (select coalesce(sum(valor), 0)      from ex where tipo = 'receita' and situacao in ('Em aberto','Atrasado') and coalesce(data_prevista, venc_original) >= v_mes and coalesce(data_prevista, venc_original) < v_fim),
    'a_pagar',            (select coalesce(sum(abs(valor)), 0) from ex where tipo = 'despesa' and situacao in ('Em aberto','Atrasado') and coalesce(data_prevista, venc_original) >= v_mes and coalesce(data_prevista, venc_original) < v_fim),
    'recebido',           (select coalesce(sum(valor), 0)      from ex where tipo = 'receita' and situacao in ('Conciliado','Quitado') and data_mov >= v_mes and data_mov < v_fim),
    'pago',               (select coalesce(sum(abs(valor)), 0) from ex where tipo = 'despesa' and situacao in ('Conciliado','Quitado') and data_mov >= v_mes and data_mov < v_fim),
    'a_receber_atrasado', (select coalesce(sum(valor), 0)      from ex where tipo = 'receita' and situacao in ('Em aberto','Atrasado') and coalesce(data_prevista, venc_original) < current_date),
    'a_pagar_atrasado',   (select coalesce(sum(abs(valor)), 0) from ex where tipo = 'despesa' and situacao in ('Em aberto','Atrasado') and coalesce(data_prevista, venc_original) < current_date),
    -- Acelerar receita (produção/mídia do Flow)
    'producao_pendente', (select jsonb_build_object('n', count(*), 'total', coalesce(sum(valor), 0)) from prod where situacao = 'em_aberto'),
    'producao_faturar',  (select jsonb_build_object('n', count(*), 'total', coalesce(sum(valor), 0)) from prod where situacao = 'faturar'),
    'midia_pendente',    (select jsonb_build_object('n', count(*), 'total', coalesce(sum(valor), 0)) from mid where situacao = 'em_aberto'),
    'midia_por_tipo',    coalesce((select jsonb_agg(row_to_json(t)) from (select tipo, count(*) n, coalesce(sum(valor), 0) total from mid where situacao = 'em_aberto' group by tipo order by total desc) t), '[]'),
    -- DRE mensal (6 meses): receita e despesas por categoria, realizado × previsto
    'dre_meses', coalesce((select jsonb_agg(to_char(m, 'YYYY-MM')) from generate_series(v_dre_ini, v_mes, interval '1 month') m), '[]'),
    'dre_rec_real', coalesce((select jsonb_agg(row_to_json(t)) from (
        select to_char(date_trunc('month', data_mov), 'YYYY-MM') mes, sum(valor) v
        from ex where tipo = 'receita' and situacao in ('Conciliado','Quitado') and data_mov >= v_dre_ini and data_mov < v_fim
        group by 1) t), '[]'),
    'dre_rec_prev', coalesce((select jsonb_agg(row_to_json(t)) from (
        select to_char(date_trunc('month', coalesce(data_prevista, venc_original)), 'YYYY-MM') mes, sum(valor) v
        from ex where tipo = 'receita' and situacao in ('Em aberto','Atrasado') and coalesce(data_prevista, venc_original) >= v_dre_ini and coalesce(data_prevista, venc_original) < v_fim
        group by 1) t), '[]'),
    'dre_desp_real', coalesce((select jsonb_agg(row_to_json(t)) from (
        select coalesce(nullif(categoria, ''), '(sem categoria)') categoria, to_char(date_trunc('month', data_mov), 'YYYY-MM') mes, sum(abs(valor)) v
        from ex where tipo = 'despesa' and situacao in ('Conciliado','Quitado') and data_mov >= v_dre_ini and data_mov < v_fim
        group by 1, 2) t), '[]'),
    'dre_desp_prev', coalesce((select jsonb_agg(row_to_json(t)) from (
        select coalesce(nullif(categoria, ''), '(sem categoria)') categoria, to_char(date_trunc('month', coalesce(data_prevista, venc_original)), 'YYYY-MM') mes, sum(abs(valor)) v
        from ex where tipo = 'despesa' and situacao in ('Em aberto','Atrasado') and coalesce(data_prevista, venc_original) >= v_dre_ini and coalesce(data_prevista, venc_original) < v_fim
        group by 1, 2) t), '[]')
  ) into v;
  return v;
end $$;

grant execute on function dashboard_financeiro(uuid, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
