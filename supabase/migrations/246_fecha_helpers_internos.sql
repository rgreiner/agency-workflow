-- 246_fecha_helpers_internos.sql
-- Continuação da revisão de 15/08. Três helpers internos estavam publicados na
-- API e respondiam a chamadas ANÔNIMAS (confirmado por HTTP com dados reais):
--
--  · `rh_jornada_de(colaborador)` devolvia a jornada de trabalho de um
--    colaborador — RH é o dado mais sensível do sistema.
--  · `rh_periodo_fechamento(org, competência)` devolvia a janela de fechamento
--    do ponto (26→25).
--  · `doc_root(doc)` devolvia a raiz de um documento.
--
-- E `notify_due_soon()` — o gatilho que INSERE notificações de prazo — podia ser
-- disparado por qualquer um, repetidamente.
--
-- Por que só REVOGAR e não pôr guard no corpo dos três primeiros: eles são
-- chamados por dez funções internas (rh_espelho, rh_recalc_ponto, rh_fechamento,
-- has_doc_access — esta usada em policy de documento). Dentro de uma função
-- SECURITY DEFINER o privilégio avaliado é o do DONO, então revogar não afeta a
-- cadeia interna; já um `if not rh_can(...) then raise` no corpo quebraria as
-- chamadas feitas pelo cron, onde não existe `auth.uid()`. Revogar é a correção
-- cirúrgica: fecha a API pública e deixa a lógica intacta.
--
-- Nenhum dos três é chamado pelo app (conferido em src/). `notify_due_soon` é
-- só do cron, então leva o mesmo par da 244: guard `is_cron()` + revoke.
-- Idempotente.

-- Helpers: saem da API, seguem funcionando por dentro.
revoke execute on function rh_jornada_de(uuid) from anon, authenticated, public;
revoke execute on function rh_periodo_fechamento(uuid, date) from anon, authenticated, public;
revoke execute on function doc_root(uuid) from anon, authenticated, public;

-- Gatilho de notificação: exclusivo do cron.
create or replace function notify_due_soon()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count int := 0; v_tomorrow date;
begin
  if not is_cron() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  v_tomorrow := (now() at time zone 'America/Sao_Paulo')::date + 1;
  insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
  select distinct aa.user_id, w.org_id, 'due_soon', a.id, null::uuid,
         jsonb_build_object('due', a.due_date::text)
  from activity_assignees aa
  join activities a on a.id = aa.activity_id
  join campaigns  c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  where a.archived = false and a.status <> 'concluido' and a.due_date = v_tomorrow
    and not exists (
      select 1 from notifications n
      where n.user_id = aa.user_id and n.activity_id = a.id and n.type = 'due_soon'
        and n.created_at > now() - interval '20 hours'
    );
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke execute on function notify_due_soon() from anon, public;
grant  execute on function notify_due_soon() to authenticated;

notify pgrst, 'reload schema';
