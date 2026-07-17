-- 111_engajamento_todos_membros.sql
-- Bug: usuário novo não aparecia no relatório de Engajamento.
-- Causa: a lista de usuários saía do PRÓPRIO fluxo de eventos —
--   from (select distinct uid from ev) u
-- Quem tem zero interação não gera linha em `ev`, então sumia da saída. O relatório
-- só sabia dizer "quem interagiu e quanto"; não conseguia mostrar "quem existe e NÃO
-- interagiu" — que é o sinal mais útil (pessoa nova que ainda não engajou, ou alguém
-- que sumiu). Um zero é informação.
-- Correção: a lista passa a sair de organization_members (quadro do time) com LEFT
-- JOIN nos eventos → todo membro aparece, quem não interagiu aparece com 0.
-- Efeito colateral bom: quem saiu da org some do relatório (antes continuava lá se
-- tivesse eventos antigos, porque a lista vinha dos eventos e não do quadro).
-- Só o bloco 'users' muda; ev/daily/tot e o gate (owner) seguem iguais à 093.

create or replace function dashboard_engajamento(p_user_id uuid, p_org_id uuid, p_days int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_role text; v_since timestamptz; v_days int;
begin
  select role into v_role from organization_members where org_id = p_org_id and user_id = p_user_id;
  if v_role is null or v_role <> 'owner' then raise exception 'Acesso negado'; end if;
  v_days := least(greatest(coalesce(p_days, 84), 7), 372);
  v_since := (current_date - (v_days - 1)) ::timestamptz;

  with ev as (
    select h.changed_by as uid, h.changed_at as ts, 'status' as kind
      from activity_history h
      join activities a on a.id = h.activity_id
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id
      where w.org_id = p_org_id and h.changed_at >= v_since and h.changed_by is not null
    union all
    select fh.changed_by, fh.changed_at, 'campo'
      from activity_field_history fh
      join activities a on a.id = fh.activity_id
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id
      where w.org_id = p_org_id and fh.changed_at >= v_since
    union all
    select cm.user_id, cm.created_at, 'comentario'
      from activity_comments cm
      join activities a on a.id = cm.activity_id
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id
      where w.org_id = p_org_id and cm.created_at >= v_since
    union all
    select r.user_id, r.created_at, 'reacao'
      from activity_comment_reactions r
      join activity_comments cm on cm.id = r.comment_id
      join activities a on a.id = cm.activity_id
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id
      where w.org_id = p_org_id and r.created_at >= v_since
  ),
  daily as (
    select uid, (ts at time zone 'America/Sao_Paulo')::date as day, count(*) as n
    from ev group by uid, (ts at time zone 'America/Sao_Paulo')::date
  ),
  tot as (select uid, kind, count(*) as n from ev group by uid, kind)
  select jsonb_build_object(
    'since', (current_date - (v_days - 1)),
    'until', current_date,
    'days',  v_days,
    -- Todo membro da org entra; quem não interagiu vem com total 0 (e vai pro fim).
    'users', coalesce((select jsonb_agg(row_to_json(t) order by t.total desc, t.full_name) from (
        select om.user_id, p.full_name, p.avatar_url,
               (select count(*) from ev e where e.uid = om.user_id)::int as total,
               coalesce((select jsonb_object_agg(kind, n) from tot tb where tb.uid = om.user_id), '{}'::jsonb) as por_tipo
        from organization_members om
        join profiles p on p.id = om.user_id
        where om.org_id = p_org_id
      ) t), '[]'),
    'daily', coalesce((select jsonb_agg(row_to_json(t)) from
      (select uid as user_id, day, n from daily) t), '[]')
  ) into v;
  return v;
end $$;

grant execute on function dashboard_engajamento(uuid, uuid, int) to anon, authenticated;

notify pgrst, 'reload schema';
