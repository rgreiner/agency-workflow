-- 122_promover_previstos_conta_azul.sql
-- Os "a receber / a pagar" do Conta Azul vivem só em extrato_importado e nunca viravam
-- lançamento — então a conciliação bancária não os encontrava (só achava os lançamentos
-- criados no Flow). Esta RPC promove os PREVISTOS (situação 'Em aberto'/'Atrasado') a
-- lançamentos 'em_aberto', virando candidatos da conciliação. Os já liquidados
-- (Conciliado/Quitado) são história e não entram. Dedup por import_ref (chave estável da
-- linha do extrato) → re-rodar não duplica. Idempotente.

create or replace function promover_extrato_previstos(p_user_id uuid, p_org_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_count int := 0;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  with novos as (
    insert into lancamentos (
      org_id, tipo, origem_tipo, origem_ref, contato_nome, descricao, valor,
      vencimento, competencia, situacao, conta_id, categoria, centro_custo, created_by
    )
    select
      e.org_id,
      case when e.tipo = 'despesa' then 'saida' else 'entrada' end,
      'conta_azul', e.import_ref,
      nullif(e.contato,''), nullif(e.descricao,''),
      abs(coalesce(e.valor, 0)),
      coalesce(e.venc_original, e.data_prevista, e.data_mov),
      coalesce(e.competencia, e.data_mov),
      'em_aberto',
      (select c.id from contas_financeiras c where c.org_id = e.org_id and c.nome = e.conta limit 1),
      nullif(e.categoria,''), nullif(e.centro_custo,''),
      p_user_id
    from extrato_importado e
    where e.org_id = p_org_id
      and e.situacao in ('Em aberto', 'Atrasado')
      and coalesce(e.valor, 0) <> 0
      and not exists (
        select 1 from lancamentos l where l.org_id = e.org_id and l.origem_ref = e.import_ref
      )
    returning 1
  )
  select count(*) into v_count from novos;
  return jsonb_build_object('inserted', v_count);
end; $$;

grant execute on function promover_extrato_previstos(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
