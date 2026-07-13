-- 108_dashboard_home.sql
-- Home em camadas gated por permissão (1 RPC, gating no servidor = defense-in-depth):
--   pessoal    → sempre (só o próprio usuário): concluídas no mês, % no prazo,
--                tempo médio de ciclo, interações (30d).
--   equipe     → só owner/admin: KPIs do time + funil + ranking de desempenho por pessoa.
--   financeiro → só can_finance || owner/admin: a receber/a pagar/recebido/pago/saldo do mês.
-- Idempotente. PostgREST estrito com overload: 1 assinatura por RPC.

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
      select a.id, a.status::text as status, a.due_date
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
    team_done as (
      select aa.user_id, dm.id, dm.due_date, dm.done_at
      from done_mes dm join activity_assignees aa on aa.activity_id = dm.id
    ),
    carga as (
      select aa.user_id, count(*) as n from ativa b join activity_assignees aa on aa.activity_id = b.id group by aa.user_id
    ),
    pessoas as (
      select p.id, p.full_name, p.avatar_url,
        count(td.id) as concluidas,
        case when count(td.id) = 0 then null else
          round(100.0 * count(td.id) filter (where td.due_date is null or td.done_at::date <= td.due_date) / count(td.id)) end as no_prazo_pct,
        coalesce(max(cg.n), 0) as carga
      from profiles p
      left join team_done td on td.user_id = p.id
      left join carga cg on cg.user_id = p.id
      where p.id in (select user_id from organization_members where org_id = p_org_id)
      group by p.id, p.full_name, p.avatar_url
      having count(td.id) > 0 or coalesce(max(cg.n), 0) > 0
    )
    select jsonb_build_object(
      'em_andamento', (select count(*) from ativa),
      'atrasadas', (select count(*) from ativa where due_date is not null and due_date < current_date),
      'concluidas_mes', (select count(*) from done_mes),
      'sla_prazo_pct', (select case when count(*) = 0 then null else
          round(100.0 * count(*) filter (where due_date is null or done_at::date <= due_date) / count(*)) end from done_mes),
      'funil', coalesce((select jsonb_agg(row_to_json(t)) from (select status, n from funil order by n desc) t), '[]'),
      'pessoas', coalesce((select jsonb_agg(row_to_json(t)) from
        (select id as user_id, full_name, avatar_url, concluidas, no_prazo_pct, carga
         from pessoas order by concluidas desc, carga desc limit 12) t), '[]')
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
