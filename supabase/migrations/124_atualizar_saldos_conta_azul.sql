-- 124_atualizar_saldos_conta_azul.sql
-- O seed (075) só preenche saldo_inicial quando está zerado — não sobrescreve. Então,
-- depois do 1º import, reimportar o Conta Azul não atualizava os saldos. Esta RPC FORÇA a
-- atualização: saldo_inicial = soma assinada dos realizados (Conciliado/Quitado/Transferido)
-- por conta, do extrato atual. Uso pontual na virada (corte). Idempotente.

create or replace function atualizar_saldos_conta_azul(p_user_id uuid, p_org_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_count int := 0;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  with saldos as (
    select conta as nome,
           round(sum(case when situacao in ('Conciliado','Quitado','Transferido')
                          then (case when tipo = 'receita' then abs(valor)
                                     when tipo = 'despesa' then -abs(valor) else 0 end)
                          else 0 end), 2) as saldo
    from extrato_importado
    where org_id = p_org_id and conta is not null and conta <> ''
    group by conta
  )
  update contas_financeiras c
     set saldo_inicial = s.saldo, updated_at = now()
    from saldos s
   where c.org_id = p_org_id and lower(c.nome) = lower(s.nome);
  get diagnostics v_count = row_count;

  return jsonb_build_object('contas_atualizadas', v_count);
end $$;

grant execute on function atualizar_saldos_conta_azul(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
