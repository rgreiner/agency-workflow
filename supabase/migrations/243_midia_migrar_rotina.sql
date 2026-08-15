-- 243_midia_migrar_rotina.sql
-- Migração assistida do cliente-balde: copia uma tarefa recorrente de lá para o
-- cliente REAL, preservando prazo, recorrência e responsáveis — e deixando a
-- original INTACTA (decisão do Rafael: nada sai da pauta até ele validar).
--
-- `origem_activity_id` é o que impede o pior cenário desta operação: clicar
-- duas vezes e a mídia acordar com a rotina em dobro. Ele também guarda o
-- rastro — daqui a três meses dá para saber de onde cada tarefa veio.
--
-- O título passa a ser o do CATÁLOGO ("Geração de boletos"), sem o `[Cliente]`
-- do balde: o cliente agora é o workspace, não um prefixo no texto.
-- Idempotente.

alter table midia_cliente_rotina add column if not exists origem_activity_id uuid
  references activities(id) on delete set null;
create unique index if not exists midia_cliente_rotina_origem_uk
  on midia_cliente_rotina (origem_activity_id) where origem_activity_id is not null;

create or replace function midia_migrar_rotina(
  p_origem uuid, p_workspace uuid, p_rotina uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid;
  v_mc    uuid;
  v_camp  uuid;
  v_ano   int := extract(year from (now() at time zone 'America/Sao_Paulo'))::int;
  v_orig  activities%rowtype;
  v_rot   midia_rotina%rowtype;
  v_novo  uuid;
begin
  select org_id into v_org from workspaces where id = p_workspace;
  if v_org is null then raise exception 'Cliente não encontrado'; end if;
  if not midia_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  select * into v_orig from activities where id = p_origem;
  if v_orig.id is null then raise exception 'Tarefa de origem não encontrada'; end if;

  select * into v_rot from midia_rotina where id = p_rotina and org_id = v_org;
  if v_rot.id is null then raise exception 'Rotina não encontrada no catálogo'; end if;

  -- Já migrada? Devolve o que existe em vez de duplicar (o botão pode ter sido
  -- clicado duas vezes, ou a tela recarregada no meio).
  select activity_id into v_novo from midia_cliente_rotina where origem_activity_id = p_origem;
  if v_novo is not null then return v_novo; end if;

  -- Operação do cliente (cria se for o primeiro).
  select id, campaign_id into v_mc, v_camp
    from midia_cliente where workspace_id = p_workspace and ano = v_ano;
  if v_mc is null then
    v_mc := midia_ativar_cliente(p_workspace, v_ano);
    select campaign_id into v_camp from midia_cliente where id = v_mc;
  end if;
  if v_camp is null then raise exception 'Cliente sem campanha de operação'; end if;

  -- Uma tarefa viva da MESMA rotina já existe neste cliente? Então não é
  -- migração, é duplicata: a pessoa criou a rotina à mão antes de migrar.
  if exists (
    select 1 from midia_cliente_rotina cr
    join activities a on a.id = cr.activity_id
    where cr.midia_cliente_id = v_mc and cr.rotina_id = p_rotina
      and cr.ativo and a.archived = false
  ) then
    raise exception 'Este cliente já tem a rotina "%" ativa. Desligue-a antes de migrar.', v_rot.nome;
  end if;

  -- A cópia: prazo, recorrência e status vêm da ORIGINAL (o ciclo dela está
  -- correndo há meses e recomeçar do zero perderia a data combinada).
  insert into activities (
    campaign_id, title, description, status, due_date, start_date,
    recurrence, recurrence_remaining, recurrence_reset_status,
    priority, complexity, estimated_hours, created_by
  ) values (
    v_camp, v_rot.nome,
    trim(coalesce(v_rot.descricao, '') ||
         case when coalesce(v_orig.description, '') <> ''
              then E'\n\n' || v_orig.description else '' end),
    v_orig.status, v_orig.due_date, v_orig.start_date,
    coalesce(v_orig.recurrence, v_rot.frequencia),
    v_orig.recurrence_remaining,
    coalesce(v_orig.recurrence_reset_status, v_rot.status_retorno),
    v_orig.priority, v_orig.complexity, v_orig.estimated_hours, auth.uid()
  ) returning id into v_novo;

  -- Quem cuidava continua cuidando.
  insert into activity_assignees (activity_id, user_id)
  select v_novo, aa.user_id from activity_assignees aa where aa.activity_id = p_origem
  on conflict do nothing;

  insert into midia_cliente_rotina (org_id, midia_cliente_id, rotina_id, activity_id, origem_activity_id, created_by)
  values (v_org, v_mc, p_rotina, v_novo, p_origem, auth.uid())
  on conflict (midia_cliente_id, rotina_id) do update
    set activity_id = excluded.activity_id,
        origem_activity_id = excluded.origem_activity_id,
        ativo = true;

  return v_novo;
end $$;
revoke execute on function midia_migrar_rotina(uuid, uuid, uuid) from public, anon;
grant  execute on function midia_migrar_rotina(uuid, uuid, uuid) to authenticated;

/** Arquiva a tarefa de origem — passo SEPARADO, para o Rafael rodar só depois
 *  de conferir que a cópia ficou boa. Migrar nunca arquiva sozinho. */
create or replace function midia_arquivar_origem(p_origem uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select w.org_id into v_org
    from activities a join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
   where a.id = p_origem;
  if v_org is null then raise exception 'Tarefa não encontrada'; end if;
  if not midia_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if not exists (select 1 from midia_cliente_rotina where origem_activity_id = p_origem) then
    raise exception 'Esta tarefa ainda não foi migrada.';
  end if;
  update activities set archived = true, archived_at = now(), updated_at = now()
   where id = p_origem;
end $$;
revoke execute on function midia_arquivar_origem(uuid) from public, anon;
grant  execute on function midia_arquivar_origem(uuid) to authenticated;

notify pgrst, 'reload schema';
