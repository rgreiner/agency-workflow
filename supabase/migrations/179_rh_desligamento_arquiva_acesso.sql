-- 179_rh_desligamento_arquiva_acesso.sql
-- Desligar no RH corta o acesso sozinho. Antes eram dois passos manuais (marcar
-- "Desligado" na ficha E arquivar em Membros) e o segundo era fácil de esquecer —
-- a pessoa saía da agência e continuava com login, aparecendo em filtros e
-- recebendo etapa. O RH é onde a saída realmente acontece, então é ele que dispara.
--
-- Gatilho em rh_colaborador: status vira 'desligado' (ou a ficha é arquivada) →
--   1. solta as atividades ATIVAS da pessoa (senão ficariam com um arquivado, que
--      é justamente o estado invisível que a 177/178 vieram corrigir);
--   2. arquiva o vínculo em organization_members (arquivado_em = data_demissao).
--
-- 'afastado' NÃO corta acesso (licença/férias — a pessoa volta).
-- A volta para 'ativo' NÃO devolve acesso sozinha: reativar é uma concessão de
-- acesso e continua sendo ato explícito em Configurações → Membros.
-- Owner nunca é arquivado automaticamente. Idempotente.

create or replace function rh_sync_desligamento()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_membro record; v_soltas int := 0;
begin
  if new.membro_user_id is null then return new; end if;

  -- Só age na TRANSIÇÃO para desligado/arquivado (não a cada save da ficha).
  if not (
    (new.status = 'desligado' and coalesce(old.status, '') is distinct from 'desligado')
    or (coalesce(new.arquivado, false) and not coalesce(old.arquivado, false))
  ) then return new; end if;

  select id, user_id, role into v_membro
  from organization_members
  where org_id = new.org_id and user_id = new.membro_user_id
    and arquivado = false and role <> 'owner'
  limit 1;
  if v_membro.id is null then return new; end if;

  -- 1) Solta as ativas: sem dono é um estado visível (card + filtro); com um
  --    arquivado como responsável, a atividade some de todo lugar.
  with alvo as (
    select aa.ctid
    from activity_assignees aa
    join activities a on a.id = aa.activity_id
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    where aa.user_id = v_membro.user_id and w.org_id = new.org_id
      and a.archived = false and a.status::text <> 'concluido'
  )
  delete from activity_assignees aa using alvo where aa.ctid = alvo.ctid;
  get diagnostics v_soltas = row_count;

  -- 2) Arquiva o vínculo (perde acesso via is_org_member/rh_can/horas_can).
  update organization_members
  set arquivado = true,
      arquivado_em = coalesce(new.data_demissao::timestamptz, now()),
      arquivado_por = auth.uid()
  where id = v_membro.id;

  raise notice 'RH: % desligado(a) — acesso arquivado, % atividade(s) soltas', new.nome, v_soltas;
  return new;
end $$;

drop trigger if exists rh_colaborador_desligamento on rh_colaborador;
create trigger rh_colaborador_desligamento
  after update on rh_colaborador
  for each row execute function rh_sync_desligamento();

-- Prévia p/ a ficha avisar ANTES de salvar o desligamento (quantas atividades
-- serão soltas e se a pessoa ainda tem acesso).
create or replace function rh_impacto_desligamento(p_colaborador_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare c rh_colaborador; v_ativas int := 0; v_tem_acesso boolean := false;
begin
  select * into c from rh_colaborador where id = p_colaborador_id;
  if c.id is null then raise exception 'Colaborador não encontrado'; end if;
  if not rh_can(c.org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if c.membro_user_id is null then
    return jsonb_build_object('tem_acesso', false, 'ativas', 0);
  end if;

  select exists (
    select 1 from organization_members
    where org_id = c.org_id and user_id = c.membro_user_id and arquivado = false and role <> 'owner'
  ) into v_tem_acesso;

  select count(*) into v_ativas
  from activity_assignees aa
  join activities a on a.id = aa.activity_id
  join campaigns cp on cp.id = a.campaign_id
  join workspaces w on w.id = cp.workspace_id
  where aa.user_id = c.membro_user_id and w.org_id = c.org_id
    and a.archived = false and a.status::text <> 'concluido';

  return jsonb_build_object('tem_acesso', v_tem_acesso, 'ativas', coalesce(v_ativas, 0));
end $$;
revoke execute on function rh_impacto_desligamento(uuid) from public;
grant execute on function rh_impacto_desligamento(uuid) to authenticated;

notify pgrst, 'reload schema';
