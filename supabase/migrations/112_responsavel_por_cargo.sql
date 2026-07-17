-- 112_responsavel_por_cargo.sql
-- "De quem é essa tarefa AGORA?" passa a cruzar o CARGO da pessoa com o status atual
-- (org_positions.allowed_statuses) — a mesma regra que a Caixa de entrada já usa desde
-- a 024/068. Se a tarefa está em design, ela não é atraso da redatora: a etapa dela
-- já passou.
--
-- POR QUE MUDAR: a 109 tentou isso via activity_status_assignees (responsável por
-- etapa, marcado por tarefa). Diagnóstico em produção: 0 de 128 tarefas ativas têm
-- esse campo preenchido — a tabela está vazia, ninguém nunca usou. Ou seja, o ranking
-- da 109 calcula em cima de nada e devolve zero pra todo mundo. Já o caminho por cargo
-- TEM dado: 125/128 tarefas com responsável e 9/10 membros com cargo.
--
-- A REGRA (2 níveis, decidida com o Rafael sobre o dado):
--   1) resp_direto — quem está NA tarefa e cujo cargo cobre o status atual;
--   2) resp_cargo  — se ninguém na tarefa cobre a etapa, quem TEM o cargo assume,
--      mesmo sem estar na tarefa. Sem isso 10 das 21 atrasadas ficariam órfãs
--      (tarefa em design sem designer associado) — trocaríamos número inflado por
--      ponto cego. O nível 2 só entra quando o 1 está vazio: senão as 4 atrasadas
--      de design contariam pros 2 designers (8 cobranças p/ 4 tarefas).
--
-- Quem está SEM CARGO não é responsável por etapa nenhuma e some do ranking — é dado,
-- não código: definir o cargo em Configurações → Membros.
-- Idempotente. Gate (owner) e demais blocos seguem iguais.

-- ── Gestão: atrasadas / paradas / carga pelo responsável da ETAPA ATUAL ──────
create or replace function dashboard_gestao(p_user_id uuid, p_org_id uuid, p_ws uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_role text;
begin
  select role into v_role from organization_members where org_id = p_org_id and user_id = p_user_id;
  if v_role is null or v_role <> 'owner' then raise exception 'Acesso negado'; end if;

  with base as (
    select a.id, a.title, a.status as status_e, a.status::text as status, a.due_date,
           a.estimated_hours, a.created_at, a.campaign_id,
           w.id as ws_id, w.name as ws_name, c.name as camp_name
    from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    where w.org_id = p_org_id and a.archived = false
      and (p_ws is null or cardinality(p_ws) = 0 or w.id = any(p_ws))
  ),
  ativa as (select * from base where status <> 'concluido'),
  resp_direto as (
    select b.id, aa.user_id
    from ativa b
    join activity_assignees aa on aa.activity_id = b.id
    join organization_members om on om.user_id = aa.user_id and om.org_id = p_org_id
    join org_positions pos on pos.id = om.position_id
    where b.status_e = any(pos.allowed_statuses)
  ),
  resp_cargo as (
    select b.id, om.user_id
    from ativa b
    join organization_members om on om.org_id = p_org_id
    join org_positions pos on pos.id = om.position_id
    where b.status_e = any(pos.allowed_statuses)
      and not exists (select 1 from resp_direto r where r.id = b.id)
  ),
  dono as (select id, user_id from resp_direto union select id, user_id from resp_cargo),
  asg as (select id as activity_id, array_agg(user_id) as uids from dono group by id),
  last_move as (
    select b.id, coalesce(max(h.changed_at), b.created_at) as last_at
    from ativa b left join activity_history h on h.activity_id = b.id
    group by b.id, b.created_at
  ),
  assign_qtd as (
    select b.id, count(aa.user_id) as n
    from ativa b left join activity_assignees aa on aa.activity_id = b.id
    group by b.id
  ),
  atrasadas as (
    select b.id, b.title, b.ws_id, b.campaign_id, b.ws_name, b.camp_name, b.status, b.due_date,
           coalesce(a.uids, '{}'::uuid[]) as assignees,
           (current_date - b.due_date::date) as dias
    from ativa b left join asg a on a.activity_id = b.id
    where b.due_date is not null and b.due_date::date < current_date
  ),
  sem_resp  as (select b.* from ativa b join assign_qtd s on s.id = b.id where s.n = 0),
  sem_prazo as (select b.* from ativa b where b.due_date is null),
  paradas as (
    select b.id, b.title, b.ws_id, b.campaign_id, b.ws_name, b.camp_name, b.status,
           coalesce(a.uids, '{}'::uuid[]) as assignees,
           extract(day from now() - lm.last_at)::int as dias
    from ativa b
    join last_move lm on lm.id = b.id
    left join asg a on a.activity_id = b.id
    where lm.last_at < now() - interval '7 days'
  ),
  carga as (
    select d.user_id, p.full_name, p.avatar_url,
           count(*) as ativas, coalesce(sum(b.estimated_hours), 0)::numeric as horas
    from dono d
    join ativa b on b.id = d.id
    join profiles p on p.id = d.user_id
    group by d.user_id, p.full_name, p.avatar_url
  ),
  funil as (select status, count(*) as n from ativa group by status)
  select jsonb_build_object(
    'total_ativas',     (select count(*) from ativa),
    'n_atrasadas',      (select count(*) from atrasadas),
    'n_sem_responsavel',(select count(*) from sem_resp),
    'n_sem_prazo',      (select count(*) from sem_prazo),
    'n_paradas',        (select count(*) from paradas),
    'atrasadas', coalesce((select jsonb_agg(row_to_json(t)) from
      (select id, title, ws_id, campaign_id, ws_name, camp_name, status, assignees, dias from atrasadas order by dias desc limit 60) t), '[]'),
    'sem_responsavel', coalesce((select jsonb_agg(row_to_json(t)) from
      (select id, title, ws_id, campaign_id, ws_name, camp_name, status from sem_resp order by ws_name, title limit 60) t), '[]'),
    'paradas', coalesce((select jsonb_agg(row_to_json(t)) from
      (select id, title, ws_id, campaign_id, ws_name, camp_name, status, assignees, dias from paradas order by dias desc limit 60) t), '[]'),
    'carga', coalesce((select jsonb_agg(row_to_json(t)) from
      (select user_id, full_name, avatar_url, ativas, horas from carga order by ativas desc, horas desc) t), '[]'),
    'funil', coalesce((select jsonb_agg(row_to_json(t)) from
      (select status, n from funil) t), '[]')
  ) into v;
  return v;
end $$;

-- ── Home: mesmo cruzamento (conserta a 109, que lia a tabela vazia) ──────────
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
    resp_direto as (
      select b.id, b.due_date, aa.user_id
      from ativa b
      join activity_assignees aa on aa.activity_id = b.id
      join organization_members om on om.user_id = aa.user_id and om.org_id = p_org_id
      join org_positions pos on pos.id = om.position_id
      where b.status_e = any(pos.allowed_statuses)
    ),
    resp_cargo as (
      select b.id, b.due_date, om.user_id
      from ativa b
      join organization_members om on om.org_id = p_org_id
      join org_positions pos on pos.id = om.position_id
      where b.status_e = any(pos.allowed_statuses)
        and not exists (select 1 from resp_direto r where r.id = b.id)
    ),
    dono as (select id, due_date, user_id from resp_direto union select id, due_date, user_id from resp_cargo),
    carga as (select user_id, count(*) as n from dono group by user_id),
    atrasadas_p as (
      select user_id, count(*) as n from dono
      where due_date is not null and due_date::date < current_date group by user_id
    ),
    -- Entregou = moveu adiante uma etapa pela qual ELA responde (pelo cargo).
    entregas as (
      select h.changed_by as user_id, count(*) as n
      from activity_history h
      join activities a on a.id = h.activity_id
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id and w.org_id = p_org_id
      join organization_members om on om.user_id = h.changed_by and om.org_id = p_org_id
      join org_positions pos on pos.id = om.position_id
      where h.changed_at >= v_ini and h.changed_at < v_fim
        and h.from_status is not null and h.from_status = any(pos.allowed_statuses)
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
      'atrasadas', (select count(*) from ativa where due_date is not null and due_date::date < current_date),
      'concluidas_mes', (select count(*) from done_mes),
      'sla_prazo_pct', (select case when count(*) = 0 then null else
          round(100.0 * count(*) filter (where due_date is null or done_at::date <= due_date) / count(*)) end from done_mes),
      'funil', coalesce((select jsonb_agg(row_to_json(t)) from (select status, n from funil order by n desc) t), '[]'),
      'pessoas', coalesce((select jsonb_agg(row_to_json(t)) from
        (select id as user_id, full_name, avatar_url, entregas, carga, atrasadas
         from pessoas order by entregas desc, atrasadas desc, carga desc limit 12) t), '[]')
    ) into v_equipe;
  end if;

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
    'pessoal', v_pessoal, 'equipe', v_equipe, 'financeiro', v_fin,
    'flags', jsonb_build_object('pode_time', v_pode_time, 'pode_financeiro', v_pode_fin)
  );
end $$;

grant execute on function dashboard_gestao(uuid, uuid, uuid[]) to anon, authenticated;
grant execute on function dashboard_home(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
