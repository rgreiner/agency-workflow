-- 248_midia_agenda_ciclo.sql
-- A tela de trabalhar da mídia: agenda do mês + cobertura por cliente.
--
-- O pedido do time (17/08): "o que impede o 'esqueci de olhar a pauta' é ver a
-- listagem do que foi feito e ter percepção de conclusão e avanço — mesmo sendo
-- recorrência de todo mês, ajuda a não esquecer nenhum cliente, nenhuma demanda".
--
-- O painel de hoje mostra o que está PENDENTE. Some o que foi feito, e com isso
-- some a noção de ciclo: a rotina mensal concluída volta com prazo do mês que
-- vem e desaparece do mês corrente — não dá para responder "fechei tudo de
-- agosto?" nem "faltou algum cliente?".
--
-- ⚠️ A pegadinha do histórico: as conclusões de agosto (50) estão nas tarefas
-- ANTIGAS do balde, porque a migração criou tarefas novas no meio do mês. Somar
-- só a tarefa nova mostraria agosto quase vazio — e a mídia concluiria que o
-- Flow perdeu o trabalho dela. Por isso as duas RPCs contam o histórico da
-- tarefa atual UNIDO ao da origem (`origem_activity_id`, migration 243).
--
-- Idempotente.

/**
 * Cobertura do período: uma linha por cliente × rotina, com quantas vezes a
 * rotina deveria acontecer e quantas aconteceram de fato.
 *
 * `esperado` é o que dá a régua do avanço: mensal é 1 por mês; semanal são
 * tantas quantas o dia da semana couber no período (agosto tem 4 quintas, não
 * "1 otimização"). Sem isso, 1 de 4 otimizações feitas apareceria como 100%.
 */
create or replace function midia_cobertura(p_org uuid, p_ini date, p_fim date)
returns table (
  workspace_id uuid, cliente text, rotina_id uuid, rotina text, frequencia text,
  activity_id uuid, prazo date, status text,
  esperado int, feitas int, ultima_conclusao timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not midia_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return query
  with vinculo as (
    select cr.id, cr.rotina_id, cr.activity_id, cr.origem_activity_id,
           mc.workspace_id, w.name as cliente,
           r.nome as rotina, r.frequencia, r.dia_semana, r.ordem,
           a.due_date, a.status
      from midia_cliente_rotina cr
      join midia_cliente mc on mc.id = cr.midia_cliente_id
      join workspaces w     on w.id = mc.workspace_id
      join midia_rotina r   on r.id = cr.rotina_id
      left join activities a on a.id = cr.activity_id
     where cr.org_id = p_org and cr.ativo
  ),
  conclusoes as (
    -- Conta a tarefa atual E a de origem: quem migrou no meio do mês não perde
    -- o que já tinha fechado antes da virada.
    select v.id as vinculo_id, count(*) as feitas, max(h.changed_at) as ultima
      from vinculo v
      join activity_history h
        on h.activity_id in (v.activity_id, v.origem_activity_id)
     where h.to_status = 'concluido'
       and h.changed_at >= p_ini::timestamptz
       and h.changed_at <  (p_fim + 1)::timestamptz
     group by v.id
  )
  select v.workspace_id, v.cliente, v.rotina_id, v.rotina, v.frequencia,
         v.activity_id, v.due_date, v.status,
         case
           when v.frequencia = 'weekly' and v.dia_semana is not null then
             (select count(*)::int from generate_series(p_ini, p_fim, interval '1 day') d
               where extract(dow from d) = v.dia_semana)
           when v.frequencia = 'weekly' then
             greatest(1, ((p_fim - p_ini + 1) / 7))
           when v.frequencia = 'biweekly' then
             greatest(1, ((p_fim - p_ini + 1) / 14))
           else 1
         end as esperado,
         coalesce(c.feitas, 0)::int as feitas,
         c.ultima
    from vinculo v
    left join conclusoes c on c.vinculo_id = v.id
   order by v.cliente, v.ordem;
end $$;
revoke execute on function midia_cobertura(uuid, date, date) from anon, public;
grant  execute on function midia_cobertura(uuid, date, date) to authenticated;

/**
 * Eventos do período para a visão de agenda: o que está marcado e o que já foi
 * feito, na data em que aconteceu.
 *
 * Tipos: 'prazo' (a rotina vence), 'feito' (conclusão registrada),
 * 'entrega' (data-limite do veículo), 'pedido' (tarefa da fila com prazo).
 */
create or replace function midia_agenda(p_org uuid, p_ini date, p_fim date)
returns table (
  dia date, tipo text, titulo text, cliente text,
  activity_id uuid, workspace_id uuid, campaign_id uuid, frequencia text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not midia_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return query
  with vinculo as (
    select cr.activity_id, cr.origem_activity_id, mc.workspace_id, w.name as cliente,
           r.nome as rotina, r.frequencia, a.due_date, a.campaign_id
      from midia_cliente_rotina cr
      join midia_cliente mc on mc.id = cr.midia_cliente_id
      join workspaces w     on w.id = mc.workspace_id
      join midia_rotina r   on r.id = cr.rotina_id
      left join activities a on a.id = cr.activity_id
     where cr.org_id = p_org and cr.ativo
  )
  -- 1. o prazo atual da rotina, quando cai no período
  select v.due_date, 'prazo', v.rotina, v.cliente, v.activity_id, v.workspace_id, v.campaign_id, v.frequencia
    from vinculo v
   where v.due_date between p_ini and p_fim
  union all
  -- 2. cada conclusão, na data em que aconteceu (atual + origem migrada)
  select (h.changed_at at time zone 'America/Sao_Paulo')::date, 'feito', v.rotina, v.cliente,
         v.activity_id, v.workspace_id, v.campaign_id, v.frequencia
    from vinculo v
    join activity_history h on h.activity_id in (v.activity_id, v.origem_activity_id)
   where h.to_status = 'concluido'
     and h.changed_at >= p_ini::timestamptz and h.changed_at < (p_fim + 1)::timestamptz
  union all
  -- 3. entregas de mídia (prazo do veículo)
  select e.prazo_envio, 'entrega', e.titulo, w.name, e.activity_id, e.workspace_id, e.campaign_id, null
    from midia_entrega e
    join workspaces w on w.id = e.workspace_id
   where e.org_id = p_org and e.situacao = 'aguardando'
     and e.prazo_envio between p_ini and p_fim
  union all
  -- 4. pedidos do time: tarefa em status de mídia, fora das campanhas de operação
  select a.due_date, 'pedido', a.title, w.name, a.id, w.id, a.campaign_id, null
    from activities a
    join campaigns c  on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    left join midia_cliente mc on mc.campaign_id = a.campaign_id
   where w.org_id = p_org and a.archived = false and mc.id is null
     and a.due_date between p_ini and p_fim
     and a.status in (
       select distinct s from org_positions p, unnest(p.allowed_statuses) s
        where p.org_id = p_org and p.op_midia_hub
     )
     and a.status <> 'concluido';
end $$;
revoke execute on function midia_agenda(uuid, date, date) from anon, public;
grant  execute on function midia_agenda(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
