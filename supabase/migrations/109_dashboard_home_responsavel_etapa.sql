-- 109_dashboard_home_responsavel_etapa.sql
-- Corrige o ranking do time: a demanda parada/atrasada é atribuída ao responsável
-- pela ETAPA ATUAL (activity_status_assignees onde status = status atual), não a
-- todos os assignees. Assim uma tarefa parada em "design" conta pro designer, não
-- pra redatora que só responde por "redação" (o caso da Isadora). Só o bloco
-- `equipe` muda; pessoal e financeiro seguem iguais à 108. Idempotente.

create or replace function dashboard_home(p_user_id uuid, p_org_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text; v_finance boolean;
  v_pode_time boolean; v_pode_fin boolean;
  v_ini date := date_trunc('month', current_date)::date;
  v_fim date := (date_trunc('month', current_date) + interval '1 month')::date;
  v_30d timestamptz := (current_date - 29)::timestamptz;
  v_pessoal jsonb; v_equipe jsonb := null; v_fin jsonb := null;
begin
  select role, coalesce(can_finance, false) into v_role, v_finance
    from organization_members where org_id = p_org_id and user_id = p_user_id;
  if v_role is null then raise exception 'Acesso negado'; end if;
  v_pode_time := v_role in ('owner', 'admin');
  v_pode_fin  := v_finance or v_role in ('owner', 'admin');

  -- ── Pessoal (o próprio usuário) ────────────────────────────────────────────
  with my_done as (
    select a.id, a.due_date, a.created_at, max(h.changed_at) as done_at
    from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id and w.org_id = p_org_id
    join activity_assignees aa on aa.activity_id = a.id and aa.user_id = p_user_id
    join activity_history h on h.activity_id = a.id and h.to_status = 'concluido'
      and h.changed_at >= v_ini and h.changed_at < v_fim
    group by a.id, a.due_date, a.created_at
  )
  select jsonb_build_object(
    'concluidas_mes', (select count(*) from my_done),
    'no_prazo_pct', (select case when count(*) = 0 then null else
        round(100.0 * count(*) filter (where due_date is null or done_at::date <= due_date) / count(*)) end from my_done),
    'tempo_medio_dias', (select round(avg(extract(epoch from (done_at - created_at)) / 86400)::numeric, 1) from my_done),
    'interacoes_30d', (
        (select count(*) from activity_history h join activities a on a.id = h.activity_id join campaigns c on c.id = a.campaign_id join workspaces w on w.id = c.workspace_id and w.org_id = p_org_id where h.changed_by = p_user_id and h.changed_at >= v_30d)
      + (select count(*) from activity_field_history fh join activities a on a.id = fh.activity_id join campaigns c on c.id = a.campaign_id join workspaces w on w.id = c.workspace_id and w.org_id = p_org_id where fh.changed_by = p_user_id and fh.changed_at >= v_30d)
      + (select count(*) from activity_comments cm join activities a on a.id = cm.activity_id join campaigns c on c.id = a.campaign_id join workspaces w on w.id = c.workspace_id and w.org_id = p_org_id where cm.user_id = p_user_id and cm.created_at >= v_30d)
      + (select count(*) from activity_comment_reactions r join activity_comments cm on cm.id = r.comment_id join activities a on a.id = cm.activity_id join campaigns c on c.id = a.campaign_id join workspaces w on w.id = c.workspace_id and w.org_id = p_org_id where r.user_id = p_user_id and r.created_at >= v_30d)
    )
  ) into v_pessoal;

  -- ── Equipe (owner/admin) ───────────────────────────────────────────────────
  if v_pode_time then
    with base as (
      select a.id, a.status as status_e, a.status::text as status, a.due_date
      from activities a
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id and w.org_id = p_org_id
      where a.archived = false
    ),
    ativa as (select * from base where status <> 'concluido'),
    funil as (select status, count(*) as n from ativa group by status),
    done_mes as (
      select a.id, a.due_date, max(h.changed_at) as done_at
      from activities a
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id and w.org_id = p_org_id
      join activity_history h on h.activity_id = a.id and h.to_status = 'concluido'
        and h.changed_at >= v_ini and h.changed_at < v_fim
      group by a.id, a.due_date
    ),
    -- Responsável pela ETAPA ATUAL de cada ativa (o "dono" de quem a demanda está esperando).
    resp as (
      select b.id, b.due_date, asa.user_id
      from ativa b
      join activity_status_assignees asa on asa.activity_id = b.id and asa.status = b.status_e
    ),
    carga as (select user_id, count(*) as n from resp group by user_id),
    atrasadas_p as (
      select user_id, count(*) as n from resp
      where due_date is not null and due_date < current_date group by user_id
    ),
    -- Entregas de etapa no mês: a pessoa moveu adiante uma etapa pela qual ELA respondia.
    entregas as (
      select h.changed_by as user_id, count(*) as n
      from activity_history h
      join activities a on a.id = h.activity_id
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id and w.org_id = p_org_id
      join activity_status_assignees asa on asa.activity_id = h.activity_id
        and asa.status = h.from_status and asa.user_id = h.changed_by
      where h.changed_at >= v_ini and h.changed_at < v_fim
      group by h.changed_by
    ),
    pessoas as (
      select p.id, p.full_name, p.avatar_url,
        coalesce(max(e.n), 0)  as entregas,
        coalesce(max(cg.n), 0) as carga,
        coalesce(max(ap.n), 0) as atrasadas
      from profiles p
      left join entregas e     on e.user_id = p.id
      left join carga cg       on cg.user_id = p.id
      left join atrasadas_p ap on ap.user_id = p.id
      where p.id in (select user_id from organization_members where org_id = p_org_id)
      group by p.id, p.full_name, p.avatar_url
      having coalesce(max(e.n), 0) > 0 or coalesce(max(cg.n), 0) > 0
    )
    select jsonb_build_object(
      'em_andamento', (select count(*) from ativa),
      'atrasadas', (select count(*) from ativa where due_date is not null and due_date < current_date),
      'concluidas_mes', (select count(*) from done_mes),
      'sla_prazo_pct', (select case when count(*) = 0 then null else
          round(100.0 * count(*) filter (where due_date is null or done_at::date <= due_date) / count(*)) end from done_mes),
      'funil', coalesce((select jsonb_agg(row_to_json(t)) from (select status, n from funil order by n desc) t), '[]'),
      'pessoas', coalesce((select jsonb_agg(row_to_json(t)) from
        (select id as user_id, full_name, avatar_url, entregas, carga, atrasadas
         from pessoas order by entregas desc, atrasadas desc, carga desc limit 12) t), '[]')
    ) into v_equipe;
  end if;

  -- ── Financeiro (can_finance || owner/admin) ────────────────────────────────
  if v_pode_fin then
    with lanc as (
      select tipo, situacao, vencimento, data_liquidacao, valor, valor_realizado
      from lancamentos where org_id = p_org_id
    )
    select jsonb_build_object(
      'a_receber', (select coalesce(sum(valor), 0) from lanc where tipo = 'entrada' and situacao = 'em_aberto' and vencimento >= v_ini and vencimento < v_fim),
      'a_pagar',   (select coalesce(sum(valor), 0) from lanc where tipo = 'saida'   and situacao = 'em_aberto' and vencimento >= v_ini and vencimento < v_fim),
      'recebido',  (select coalesce(sum(coalesce(valor_realizado, valor)), 0) from lanc where tipo = 'entrada' and situacao in ('recebido','pago') and data_liquidacao >= v_ini and data_liquidacao < v_fim),
      'pago',      (select coalesce(sum(coalesce(valor_realizado, valor)), 0) from lanc where tipo = 'saida'   and situacao in ('recebido','pago') and data_liquidacao >= v_ini and data_liquidacao < v_fim),
      'a_receber_atrasado', (select coalesce(sum(valor), 0) from lanc where tipo = 'entrada' and situacao = 'em_aberto' and vencimento < current_date),
      'a_pagar_atrasado',   (select coalesce(sum(valor), 0) from lanc where tipo = 'saida'   and situacao = 'em_aberto' and vencimento < current_date),
      'saldo', (
        coalesce((select sum(saldo_inicial) from contas_financeiras where org_id = p_org_id and ativo), 0)
        + coalesce((select sum(coalesce(valor_realizado, valor)) from lanc where tipo = 'entrada' and situacao in ('recebido','pago')), 0)
        - coalesce((select sum(coalesce(valor_realizado, valor)) from lanc where tipo = 'saida' and situacao in ('recebido','pago')), 0)
      )
    ) into v_fin;
  end if;

  return jsonb_build_object(
    'pessoal', v_pessoal,
    'equipe', v_equipe,
    'financeiro', v_fin,
    'flags', jsonb_build_object('pode_time', v_pode_time, 'pode_financeiro', v_pode_fin)
  );
end $$;

grant execute on function dashboard_home(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
