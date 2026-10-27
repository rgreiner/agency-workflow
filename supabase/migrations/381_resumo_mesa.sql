-- 381 — números do caixa para a mesa da Flávia ("modo TV", 27/10/2026)
--
-- Em atraso a receber de clientes (com contato; o histórico da Conta Azul sem
-- contato fica de fora), recebido hoje, e a semana: a receber × a pagar nos próximos
-- 7 dias. Só totais — nada de título por título. Gate = fin_can.
create or replace function public.fin_resumo_mesa(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_hoje date := fin_hoje();
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'atraso_n',        count(*) filter (where l.tipo = 'entrada' and l.situacao = 'em_aberto' and l.vencimento < v_hoje and l.contato_tipo = 'cliente'),
      'atraso_valor',    coalesce(sum(l.valor) filter (where l.tipo = 'entrada' and l.situacao = 'em_aberto' and l.vencimento < v_hoje and l.contato_tipo = 'cliente'), 0),
      'recebido_hoje',   coalesce(sum(l.valor) filter (where l.tipo = 'entrada' and l.situacao = 'recebido' and l.data_liquidacao = v_hoje), 0),
      'receber_7d',      coalesce(sum(l.valor) filter (where l.tipo = 'entrada' and l.situacao = 'em_aberto' and l.vencimento between v_hoje and v_hoje + 7), 0),
      'pagar_7d',        coalesce(sum(l.valor) filter (where l.tipo = 'saida' and l.situacao = 'em_aberto' and l.vencimento between v_hoje and v_hoje + 7), 0),
      'pagar_atraso',    coalesce(sum(l.valor) filter (where l.tipo = 'saida' and l.situacao = 'em_aberto' and l.vencimento < v_hoje and l.vencimento >= v_hoje - 60), 0))
      from lancamentos l
     where l.org_id = p_org and l.transferencia_id is null
  );
end $$;
revoke execute on function public.fin_resumo_mesa(uuid) from public, anon;
grant execute on function public.fin_resumo_mesa(uuid) to authenticated;

notify pgrst, 'reload schema';
