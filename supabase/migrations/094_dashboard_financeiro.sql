-- 094_dashboard_financeiro.sql
-- Aba Financeiro do Dashboard gerencial (só owner): dados macro de aprovação/
-- operação/financeiro do mês — fluxo (a receber/a pagar/realizado), o que acelerar
-- pra faturar (produção pendente/ a faturar, mídia a liberar) e composição de
-- despesas por categoria (o cliente agrupa por grupo p/ o %). Idempotente.

create or replace function dashboard_financeiro(p_user_id uuid, p_org_id uuid, p_mes text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_role text; v_ini date; v_fim date;
begin
  select role into v_role from organization_members where org_id = p_org_id and user_id = p_user_id;
  if v_role is null or v_role <> 'owner' then raise exception 'Acesso negado'; end if;
  v_ini := (coalesce(nullif(p_mes, ''), to_char(current_date, 'YYYY-MM')) || '-01')::date;
  v_fim := (v_ini + interval '1 month')::date;

  with lanc as (
    select tipo, situacao, vencimento, data_liquidacao, valor, valor_realizado, categoria
    from lancamentos where org_id = p_org_id
  ),
  prod as (select tipo, situacao, valor from producao where org_id = p_org_id and archived = false),
  mid  as (select tipo, situacao, valor from midias   where org_id = p_org_id and archived = false)
  select jsonb_build_object(
    'mes', to_char(v_ini, 'YYYY-MM'),
    'a_receber',           (select coalesce(sum(valor), 0) from lanc where tipo = 'entrada' and situacao = 'em_aberto' and vencimento >= v_ini and vencimento < v_fim),
    'a_pagar',             (select coalesce(sum(valor), 0) from lanc where tipo = 'saida'   and situacao = 'em_aberto' and vencimento >= v_ini and vencimento < v_fim),
    'recebido',            (select coalesce(sum(coalesce(valor_realizado, valor)), 0) from lanc where tipo = 'entrada' and situacao in ('recebido','pago') and data_liquidacao >= v_ini and data_liquidacao < v_fim),
    'pago',                (select coalesce(sum(coalesce(valor_realizado, valor)), 0) from lanc where tipo = 'saida'   and situacao in ('recebido','pago') and data_liquidacao >= v_ini and data_liquidacao < v_fim),
    'a_receber_atrasado',  (select coalesce(sum(valor), 0) from lanc where tipo = 'entrada' and situacao = 'em_aberto' and vencimento < current_date),
    'a_pagar_atrasado',    (select coalesce(sum(valor), 0) from lanc where tipo = 'saida'   and situacao = 'em_aberto' and vencimento < current_date),
    'producao_pendente',   (select jsonb_build_object('n', count(*), 'total', coalesce(sum(valor), 0)) from prod where situacao = 'em_aberto'),
    'producao_faturar',    (select jsonb_build_object('n', count(*), 'total', coalesce(sum(valor), 0)) from prod where situacao = 'faturar'),
    'producao_por_tipo',   coalesce((select jsonb_agg(row_to_json(t)) from (select tipo, count(*) n, coalesce(sum(valor), 0) total from prod where situacao = 'em_aberto' group by tipo order by total desc) t), '[]'),
    'midia_pendente',      (select jsonb_build_object('n', count(*), 'total', coalesce(sum(valor), 0)) from mid where situacao = 'em_aberto'),
    'midia_por_tipo',      coalesce((select jsonb_agg(row_to_json(t)) from (select tipo, count(*) n, coalesce(sum(valor), 0) total from mid where situacao = 'em_aberto' group by tipo order by total desc) t), '[]'),
    'despesas_categoria',  coalesce((select jsonb_agg(row_to_json(t)) from (
        select coalesce(nullif(categoria, ''), '(sem categoria)') as categoria, coalesce(sum(coalesce(valor_realizado, valor)), 0) as total
        from lanc where tipo = 'saida' and situacao in ('recebido','pago') and data_liquidacao >= v_ini and data_liquidacao < v_fim
        group by categoria) t), '[]')
  ) into v;
  return v;
end $$;

grant execute on function dashboard_financeiro(uuid, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
