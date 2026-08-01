-- 177_remover_membro_carga.sql
-- Remover membro sem deixar atividade órfã. Hoje remove_member só apaga o vínculo
-- em organization_members; as linhas de activity_assignees ficam (a FK aponta pra
-- profiles, não pra membership), então a atividade segue "atribuída" a quem não
-- está mais na org: não aparece em "Sem responsável" (a contagem vê a linha), não
-- entra em resp_direto (que exige membership) e some dos filtros por pessoa.
-- Medido em 01/08/2026: 11 atividades ativas nessa situação.
--
--   • org_membro_carga  → prévia p/ a tela avisar quantas atividades estão com a pessoa
--   • remove_member     → ganha p_transferir_para: transfere as ativas antes de remover;
--                         nulo = solta as atribuições (a atividade fica SEM responsável,
--                         visível no card e no filtro, em vez de apontar pra um fantasma).
-- Idempotente.

-- ── Prévia: o que está com a pessoa nesta org ────────────────────────────────
create or replace function org_membro_carga(p_org_id uuid, p_member_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid; v_ativas int; v_atrasadas int; v_so_dela int;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = auth.uid() and role in ('owner','admin')
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

-- ── Remoção com destino das atividades ──────────────────────────────────────
-- PostgREST é estrito com overload: derruba a assinatura de 3 args antes.
drop function if exists remove_member(uuid, uuid, uuid);

create or replace function remove_member(
  p_user_id uuid, p_org_id uuid, p_member_id uuid, p_transferir_para uuid default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid; v_transferidas int := 0; v_soltas int := 0;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin')
  ) then raise exception 'Acesso negado'; end if;

  select user_id into v_uid from organization_members where id = p_member_id and org_id = p_org_id;
  if v_uid is null then raise exception 'Membro não encontrado'; end if;

  -- Destino tem que ser membro DESTA org (senão só trocaríamos de fantasma).
  if p_transferir_para is not null and not exists (
    select 1 from organization_members where org_id = p_org_id and user_id = p_transferir_para
  ) then raise exception 'A pessoa que vai receber as atividades não é membro desta organização'; end if;

  -- Atividades ativas da org que estão com a pessoa.
  create temp table _mv on commit drop as
  select aa.activity_id
  from activity_assignees aa
  join activities a on a.id = aa.activity_id
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  where aa.user_id = v_uid and w.org_id = p_org_id
    and a.archived = false and a.status::text <> 'concluido';

  if p_transferir_para is not null then
    insert into activity_assignees (activity_id, user_id)
    select m.activity_id, p_transferir_para from _mv m
    on conflict do nothing;
    get diagnostics v_transferidas = row_count;
  end if;

  -- Solta a atribuição antiga (com destino: já foi transferida; sem destino: a
  -- atividade fica SEM responsável — estado honesto e visível, não um fantasma).
  delete from activity_assignees aa
  using _mv m where aa.activity_id = m.activity_id and aa.user_id = v_uid;
  get diagnostics v_soltas = row_count;

  delete from organization_members where id = p_member_id and org_id = p_org_id;

  return jsonb_build_object('transferidas', v_transferidas, 'soltas', v_soltas);
end $$;
revoke execute on function remove_member(uuid, uuid, uuid, uuid) from public;
grant execute on function remove_member(uuid, uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
