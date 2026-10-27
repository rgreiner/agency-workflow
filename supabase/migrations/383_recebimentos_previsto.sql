-- 383 — recebimentos comparados ganham o PREVISTO do mês (27/10/2026)
--
-- Linha pontilhada no gráfico da mesa: recebido até hoje + o que vence até o fim do
-- mês e está em aberto (por dia de vencimento). O atraso não entra: já venceu e não
-- veio. Mesma assinatura da 382 (create or replace, grants mantidos).

create or replace function public.fin_recebimentos_comparados(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_hoje date := fin_hoje();
  v_ini date := date_trunc('month', v_hoje)::date;
  v_fim date := (date_trunc('month', v_hoje) + interval '1 month - 1 day')::date;
  v_ini_ant date := (v_ini - interval '1 year')::date;
  v_fim_ant date := (date_trunc('month', v_ini_ant) + interval '1 month - 1 day')::date;
  v_tem_lanc boolean;
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select exists (select 1 from lancamentos where org_id = p_org and tipo = 'entrada' and situacao = 'recebido'
                  and data_liquidacao between v_ini_ant and v_fim_ant) into v_tem_lanc;
  return jsonb_build_object(
    'mes', to_char(v_ini, 'YYYY-MM'), 'mes_anterior', to_char(v_ini_ant, 'YYYY-MM'),
    'dias', extract(day from v_fim)::int, 'hoje_dia', extract(day from v_hoje)::int,
    'fonte_anterior', case when v_tem_lanc then 'lancamentos' else 'conta_azul' end,
    'atual', coalesce((
      select jsonb_agg(jsonb_build_object('dia', d, 'valor', round(v, 2)) order by d) from (
        select extract(day from l.data_liquidacao)::int d, sum(l.valor) v from lancamentos l
         where l.org_id = p_org and l.tipo = 'entrada' and l.situacao = 'recebido' and l.transferencia_id is null
           and l.data_liquidacao between v_ini and v_hoje group by 1) x), '[]'::jsonb),
    -- previsto: o que vence de hoje até o fim do mês e ainda está em aberto (o atraso fica de fora)
    'a_vencer', coalesce((
      select jsonb_agg(jsonb_build_object('dia', d, 'valor', round(v, 2)) order by d) from (
        select extract(day from l.vencimento)::int d, sum(l.valor) v from lancamentos l
         where l.org_id = p_org and l.tipo = 'entrada' and l.situacao = 'em_aberto' and l.transferencia_id is null
           and l.vencimento between v_hoje and v_fim group by 1) x), '[]'::jsonb),
    'anterior', coalesce((
      select jsonb_agg(jsonb_build_object('dia', d, 'valor', round(v, 2)) order by d) from (
        select extract(day from l.data_liquidacao)::int d, sum(l.valor) v from lancamentos l
         where v_tem_lanc and l.org_id = p_org and l.tipo = 'entrada' and l.situacao = 'recebido' and l.transferencia_id is null
           and l.data_liquidacao between v_ini_ant and v_fim_ant group by 1
        union all
        select extract(day from e.data_mov)::int, sum(e.valor) from extrato_importado e
         where not v_tem_lanc and e.org_id = p_org and e.tipo = 'receita' and e.situacao in ('Quitado', 'Conciliado')
           and e.data_mov between v_ini_ant and v_fim_ant group by 1) x), '[]'::jsonb)
  );
end $$;
revoke execute on function public.fin_recebimentos_comparados(uuid) from public, anon;
grant execute on function public.fin_recebimentos_comparados(uuid) to authenticated;

notify pgrst, 'reload schema';
