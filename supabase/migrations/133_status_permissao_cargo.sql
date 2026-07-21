-- 133_status_permissao_cargo.sql
-- Quem move a tarefa precisa ter o status ATUAL no cargo. Regra do Rafael:
-- "atendimento não pode mudar design de posição". A permissão é sobre de ONDE a
-- tarefa sai, não pra onde vai — quem é dono da etapa atual decide quando ela
-- termina.
--
-- Owner/admin passam direto: o Rafael é facilitador e NÃO tem cargo (é o único
-- owner sem position_id). Sem essa exceção ele ficaria travado em tudo.
--
-- Cargo sem allowed_statuses configurado também passa direto — cargo vazio é
-- "ainda não configuraram", não "não pode nada". Travar por omissão pararia a
-- agência. Idempotente.

create or replace function pode_mover_status(p_user_id uuid, p_activity_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id and m.user_id = p_user_id
    left join org_positions op on op.id = m.position_id
    where a.id = p_activity_id
      and (
        m.role in ('owner', 'admin')                       -- facilitador/admin
        or op.id is null                                    -- sem cargo → não trava
        or coalesce(array_length(op.allowed_statuses, 1), 0) = 0  -- cargo não configurado
        or a.status = any(op.allowed_statuses)              -- dono da etapa atual
      )
  );
$$;

grant execute on function pode_mover_status(uuid, uuid) to anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_activity_status(p_user_id uuid, p_activity_id uuid, p_new_status activity_status, p_comment text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_old_status activity_status; v_label text;
begin
  select status into v_old_status from activities where id = p_activity_id;

  if not exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where a.id = p_activity_id and m.user_id = p_user_id
  ) then
    raise exception 'Acesso negado';
  end if;

  -- Trava por cargo no status ATUAL. Mensagem diz o status pra pessoa saber a quem
  -- pedir, em vez de um "acesso negado" seco.
  if not pode_mover_status(p_user_id, p_activity_id) then
    v_label := replace(initcap(replace(v_old_status::text, '_', ' ')), ' Do ', ' do ');
    raise exception 'Seu cargo não permite mover tarefas em %. Peça a quem cuida dessa etapa.', v_label;
  end if;

  update activities set status = p_new_status, updated_at = now() where id = p_activity_id;

  insert into activity_history (activity_id, from_status, to_status, changed_by, comment)
  values (p_activity_id, v_old_status, p_new_status, p_user_id, nullif(p_comment,''));
end;
$function$;

notify pgrst, 'reload schema';
