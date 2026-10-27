-- 377 — envio do agente que NÃO foi entregue sai do histórico da régua (27/10/2026)
--
-- A Flávia registra o degrau quando a Meta aceita a mensagem; a entrega pode falhar
-- depois (número fixo, janela fechada). As cobranças D+30/D+60 da Opera (26/10) foram
-- para um fixo, falharam e ficaram como "enviadas": a régua só voltaria no D+90.
-- Esta função apaga o registro daquele degrau (só os do próprio agente, dos últimos
-- 3 dias), para a régua propor de novo no próximo número válido.
create or replace function public.fin_desfazer_envio_agente(p_lancamento_id uuid, p_bucket text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_org uuid; v_n int;
begin
  select org_id into v_org from lancamentos where id = p_lancamento_id;
  if v_org is null or not fin_can(v_org) then raise exception 'Título não encontrado'; end if;
  delete from cobranca_avisos
   where lancamento_id = p_lancamento_id and bucket = p_bucket
     and enviado_por = auth.uid() and sent_at > now() - interval '3 days';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'removidos', v_n);
end $$;
revoke execute on function public.fin_desfazer_envio_agente(uuid, text) from public, anon;
grant execute on function public.fin_desfazer_envio_agente(uuid, text) to authenticated;

notify pgrst, 'reload schema';
