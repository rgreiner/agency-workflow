-- 338: o painel de Gestão esconde quem não está mais no time (09/10/2026).
--
-- Pedido do Rafael olhando /views/gestao. A aba Operação já filtrava membro
-- arquivado (carga, atrasadas, sem responsável); a de ENGAJAMENTO não: listava
-- `organization_members` inteiro, então 10 pessoas que saíram apareciam no
-- calendário, a maioria com zero — empurrando o time atual para baixo.
--
-- Arquivar o membro é como a casa registra a saída (ver memória de
-- offboarding): é esse o sinal usado aqui, o mesmo das outras telas.
-- Idempotente.

create or replace function dashboard_engajamento(p_user_id uuid, p_org_id uuid, p_days integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v jsonb; v_role text; v_since timestamptz; v_days int;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select role into v_role from organization_members
   where org_id = p_org_id and user_id = p_user_id and arquivado = false;
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
  -- Quem saiu da casa sai do painel: o calendário é para acompanhar o time de
  -- HOJE. O histórico dele continua nas atividades, só não polui a leitura.
  ev_time as (
    select e.* from ev e
     where exists (select 1 from organization_members om
                    where om.org_id = p_org_id and om.user_id = e.uid and om.arquivado = false)
  ),
  daily as (
    select uid, (ts at time zone 'America/Sao_Paulo')::date as day, count(*) as n
    from ev_time group by uid, (ts at time zone 'America/Sao_Paulo')::date
  ),
  tot as (select uid, kind, count(*) as n from ev_time group by uid, kind)
  select jsonb_build_object(
    'since', (current_date - (v_days - 1)),
    'until', current_date,
    'days',  v_days,
    -- Todo membro da org entra; quem não interagiu vem com total 0 (e vai pro fim).
    'users', coalesce((select jsonb_agg(row_to_json(t) order by t.total desc, t.full_name) from (
        select om.user_id, p.full_name, p.avatar_url,
               (select count(*) from ev_time e where e.uid = om.user_id)::int as total,
               coalesce((select jsonb_object_agg(kind, n) from tot tb where tb.uid = om.user_id), '{}'::jsonb) as por_tipo
        from organization_members om
        join profiles p on p.id = om.user_id
        where om.org_id = p_org_id and om.arquivado = false
      ) t), '[]'),
    'daily', coalesce((select jsonb_agg(row_to_json(t)) from
      (select uid as user_id, day, n from daily) t), '[]')
  ) into v;
  return v;
end $$;

notify pgrst, 'reload schema';
