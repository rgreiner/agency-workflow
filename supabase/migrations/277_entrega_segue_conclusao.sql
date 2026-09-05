-- 277_entrega_segue_conclusao.sql
-- Concluir a tarefa dá a entrega por enviada. Decisão do Rafael (04/09/2026):
-- "concluído sai da visão de trabalho da mídia". Sem isto, a entrega ficava
-- 'aguardando' com a tarefa já concluída — aparecia na fila, no cadastro e no
-- digest como pendência de uma peça que já saiu. É o inverso do gesto de 01/09
-- ("Enviei ao veículo" conclui a tarefa); os dois juntos fecham o ciclo nos dois
-- sentidos. Reabrir a entrega continua possível no cadastro (volta a 'aguardando').
-- Idempotente. Trigger, não RPC: vale para todo caminho que muda o status.

create or replace function public.midia_entrega_segue_conclusao()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid;
  v_concl text;
begin
  if new.status is not distinct from old.status then return new; end if;

  select w.org_id into v_org
    from campaigns c join workspaces w on w.id = c.workspace_id
   where c.id = new.campaign_id;
  select valor into v_concl from org_status
   where org_id = v_org and papel = 'conclusao' limit 1;

  if new.status::text = coalesce(v_concl, 'concluido') then
    update midia_entrega
       set situacao     = 'liberado',
           liberado_em  = now(),
           -- quem concluiu assume o envio; sem perfil (cron/portal) fica nulo
           liberado_por = (select p.id from profiles p where p.id = auth.uid())
     where activity_id = new.id and situacao = 'aguardando';
  end if;
  return new;
end $$;

drop trigger if exists trg_midia_entrega_segue_conclusao on activities;
create trigger trg_midia_entrega_segue_conclusao
  after update of status on activities
  for each row execute function public.midia_entrega_segue_conclusao();

-- Passivo: entrega ainda 'aguardando' cuja tarefa já está concluída.
update midia_entrega e
   set situacao    = 'liberado',
       liberado_em = coalesce(
         (select max(h.changed_at) from activity_history h
           where h.activity_id = e.activity_id and h.to_status::text = 'concluido'),
         now())
  from activities a
 where a.id = e.activity_id
   and e.situacao = 'aguardando'
   and a.status::text = 'concluido';

notify pgrst, 'reload schema';
