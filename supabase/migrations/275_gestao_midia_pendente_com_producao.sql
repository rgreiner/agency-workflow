-- 275_gestao_midia_pendente_com_producao.sql
-- "Mídia a liberar" (painel de Gestão) somava só `midias.valor` — a exibição.
-- A produção da MX (lona/adesivo) fica em `detalhe` e não entrava: uma MX só de
-- produção contava R$ 0,00. Recria dashboard_financeiro igual à 185, mudando
-- apenas o CTE `mid` para somar a produção com a MESMA fórmula da RPC de
-- faturamento (_br_num da 132, quantidade mínima 1). Idempotente.

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
  -- Mídia externa: a produção (lona/adesivo) mora em detalhe, fora de `valor`.
  -- Mesma conta da RPC de faturamento (mig. 186): unit × quantidade (mín. 1).
  -- Sem isto, a MX só de produção entrava como R$ 0,00 em "Mídia a liberar".
  mid  as (select tipo, situacao,
                  coalesce(valor, 0) + round(
                    _br_num(detalhe->>'producao_valor')
                    * greatest(coalesce(nullif(_br_num(detalhe->>'producao_quantidade'), 0), 1), 1), 2) as valor
           from midias where org_id = p_org_id and archived = false)
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
