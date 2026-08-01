-- 178_membro_arquivado.sql
-- Offboarding sem perder a pessoa: ARQUIVAR o membro em vez de excluir.
--
-- Excluir apagava o vínculo e a pessoa sumia de tudo que passa por
-- organization_members — inclusive das MÉTRICAS do trabalho que ela entregou
-- (o histórico continua no banco, mas sem ninguém a quem atribuir). Arquivado
-- mantém o vínculo (cargo, papel, quando saiu) e tira só o acesso e o operacional.
--
-- O corte de acesso é feito nos 3 helpers que TODO o resto usa — is_org_member
-- (27 policies RLS), rh_can e horas_can — em vez de nas ~124 RPCs que checam
-- membership: um ponto só, sem risco de esquecer alguma e deixar porta aberta.
-- Idempotente.

alter table organization_members add column if not exists arquivado     boolean not null default false;
alter table organization_members add column if not exists arquivado_em  timestamptz;
alter table organization_members add column if not exists arquivado_por uuid references profiles(id);

create index if not exists organization_members_ativos_idx
  on organization_members (org_id, user_id) where arquivado = false;

-- ── Portões de acesso: arquivado não entra ──────────────────────────────────
create or replace function is_org_member(org uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from organization_members
    where org_id = org and user_id = auth.uid() and arquivado = false
  );
$$;

create or replace function rh_can(p_org uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from organization_members
    where org_id = p_org and user_id = auth.uid() and arquivado = false
      and (role in ('owner','admin') or can_rh)
  );
$$;

create or replace function horas_can(p_org uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select rh_can(p_org) or exists (
    select 1 from organization_members
    where org_id = p_org and user_id = auth.uid() and arquivado = false
      and role in ('owner','admin')
  );
$$;

-- ── Arquivar / desarquivar, com destino das atividades ativas ───────────────
-- Mesma régua do remove_member (177): transfere ou solta as ATIVAS; concluídas
-- e arquivadas ficam com a pessoa — são o registro do que ela entregou.
create or replace function arquivar_membro(
  p_org_id uuid, p_member_id uuid, p_arquivar boolean default true,
  p_transferir_para uuid default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid; v_transferidas int := 0; v_soltas int := 0;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = auth.uid() and role in ('owner','admin') and arquivado = false
  ) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  select user_id into v_uid from organization_members where id = p_member_id and org_id = p_org_id;
  if v_uid is null then raise exception 'Membro não encontrado'; end if;
  if v_uid = auth.uid() then raise exception 'Você não pode arquivar a si mesmo'; end if;
  if exists (select 1 from organization_members where id = p_member_id and role = 'owner') then
    raise exception 'O proprietário não pode ser arquivado';
  end if;

  -- Desarquivar: devolve o acesso e pronto (as atividades não voltam sozinhas).
  if not p_arquivar then
    update organization_members set arquivado = false, arquivado_em = null, arquivado_por = null
    where id = p_member_id and org_id = p_org_id;
    return jsonb_build_object('arquivado', false, 'transferidas', 0, 'soltas', 0);
  end if;

  if p_transferir_para is not null and not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_transferir_para and arquivado = false
  ) then raise exception 'A pessoa que vai receber as atividades não é membro ativo desta organização'; end if;

  create temp table _av on commit drop as
  select aa.activity_id
  from activity_assignees aa
  join activities a on a.id = aa.activity_id
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  where aa.user_id = v_uid and w.org_id = p_org_id
    and a.archived = false and a.status::text <> 'concluido';

  if p_transferir_para is not null then
    insert into activity_assignees (activity_id, user_id)
    select v.activity_id, p_transferir_para from _av v
    on conflict do nothing;
    get diagnostics v_transferidas = row_count;
  end if;

  delete from activity_assignees aa using _av v
  where aa.activity_id = v.activity_id and aa.user_id = v_uid;
  get diagnostics v_soltas = row_count;

  update organization_members
  set arquivado = true, arquivado_em = now(), arquivado_por = auth.uid()
  where id = p_member_id and org_id = p_org_id;

  return jsonb_build_object('arquivado', true, 'transferidas', v_transferidas, 'soltas', v_soltas);
end $$;
revoke execute on function arquivar_membro(uuid, uuid, boolean, uuid) from public;
grant execute on function arquivar_membro(uuid, uuid, boolean, uuid) to authenticated;

-- ── org_membro_carga: ignora arquivado na checagem de quem pergunta ─────────
create or replace function org_membro_carga(p_org_id uuid, p_member_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid; v_ativas int; v_atrasadas int; v_so_dela int;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = auth.uid() and role in ('owner','admin') and arquivado = false
  ) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  select user_id into v_uid from organization_members where id = p_member_id and org_id = p_org_id;
  if v_uid is null then raise exception 'Membro não encontrado'; end if;

  select count(*),
         count(*) filter (where a.due_date is not null and a.due_date::date < current_date),
         count(*) filter (where (select count(*) from activity_assignees x where x.activity_id = a.id) = 1)
    into v_ativas, v_atrasadas, v_so_dela
  from activity_assignees aa
  join activities a on a.id = aa.activity_id
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  where aa.user_id = v_uid and w.org_id = p_org_id
    and a.archived = false and a.status::text <> 'concluido';

  return jsonb_build_object(
    'user_id', v_uid, 'ativas', coalesce(v_ativas, 0),
    'atrasadas', coalesce(v_atrasadas, 0), 'so_dela', coalesce(v_so_dela, 0));
end $$;
revoke execute on function org_membro_carga(uuid, uuid) from public;
grant execute on function org_membro_carga(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
CREATE OR REPLACE FUNCTION public.dashboard_gestao(p_user_id uuid, p_org_id uuid, p_ws uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb; v_role text;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select role into v_role from organization_members where org_id = p_org_id and user_id = p_user_id and arquivado = false;
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
    join organization_members om on om.user_id = aa.user_id and om.org_id = p_org_id and om.arquivado = false
    join org_positions pos on pos.id = om.position_id
    where b.status_e = any(pos.allowed_statuses)
  ),
  resp_cargo as (
    select b.id, om.user_id
    from ativa b
    join organization_members om on om.org_id = p_org_id and om.arquivado = false
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
end $function$;

notify pgrst, 'reload schema';
