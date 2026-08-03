-- 195_portal_ciclo_aprovacao.sql
-- Auditoria 02/08, Portal #1 (alta, verificado): "Segunda rodada de aprovação é
-- impossível — a primeira decisão vale para sempre".
--
-- 168:256 recusa quando existe QUALQUER decisão da atividade. O comentário diz
-- "uma decisão por ciclo", mas o filtro é por atividade inteira. O fluxo que
-- quebra é o normal: cliente pede ajuste → agência corrige e devolve para
-- aprovação → cliente vê "Este trabalho já foi respondido" e nunca aprova a
-- versão corrigida. `portal_aprovacao` tem o mesmo problema na leitura: mostra a
-- decisão da rodada passada como se fosse desta.
--
-- Ciclo = desde a última vez que a atividade ENTROU em 'aprovacao_cliente'
-- (activity_history.to_status). Sem histórico — atividade criada já nesse status,
-- 1ª rodada — cai em '-infinity' e o comportamento é o de hoje: uma decisão só.
--
-- Idempotente.

-- Quando começou a rodada atual de aprovação desta atividade.
create or replace function portal_ciclo_desde(p_activity_id uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select coalesce(
    (select max(h.changed_at) from activity_history h
      where h.activity_id = p_activity_id and h.to_status = 'aprovacao_cliente'),
    '-infinity'::timestamptz)
$$;

-- Defaults IDÊNTICOS aos da versão viva: `create or replace` não deixa remover
-- default de parâmetro existente (e trocar a assinatura quebraria o PostgREST,
-- que resolve RPC por nome de argumento).
create or replace function portal_registrar_decisao(
  p_activity_id uuid, p_decisao text, p_mensagem text default null::text, p_pecas jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_pu portal_users; v_act activities; v_entry uuid; v_kind text; v_desde timestamptz;
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode='42501'; end if;
  if p_decisao not in ('aprovado','ajuste') then raise exception 'Decisão inválida'; end if;
  v_kind := case when p_decisao = 'aprovado' then 'aprovacao' else 'ajuste' end;

  -- Pedido de ajuste PRECISA dizer o que ajustar (no aceite a mensagem é opcional).
  if v_kind = 'ajuste' and coalesce(btrim(p_mensagem),'') = ''
     and coalesce(jsonb_array_length(p_pecas), 0) = 0 then
    raise exception 'Descreva o ajuste';
  end if;

  select a.* into v_act
  from activities a join campaigns c on c.id = a.campaign_id
  where a.id = p_activity_id and c.workspace_id = v_pu.workspace_id
    and a.status = 'aprovacao_cliente' and not a.archived and not c.archived;
  if v_act.id is null then raise exception 'Trabalho indisponível'; end if;

  -- Uma decisão por CICLO: já respondeu nesta rodada, não sobrescreve em silêncio.
  -- Decisão de rodada anterior não conta — a peça mudou desde então.
  v_desde := portal_ciclo_desde(v_act.id);
  if exists (
    select 1 from portal_entries
    where activity_id = v_act.id and kind in ('aprovacao','ajuste') and created_at >= v_desde
  ) then
    raise exception 'Este trabalho já foi respondido';
  end if;

  insert into portal_entries (org_id, workspace_id, portal_user_id, kind, activity_id, mensagem, pecas)
  values (v_pu.org_id, v_pu.workspace_id, v_pu.id, v_kind, v_act.id,
          coalesce(btrim(p_mensagem), case when v_kind='aprovacao' then 'Aprovado pelo cliente.' else '' end),
          coalesce(p_pecas,'[]'::jsonb))
  returning id into v_entry;

  perform portal_notificar(
    v_pu.org_id, 'aprovacao_cliente'::text,
    case when v_kind='aprovacao' then 'portal_aprovado' else 'portal_ajuste' end,
    v_act.id,
    jsonb_build_object('cliente', v_pu.nome, 'entry_id', v_entry,
                       'preview', left(coalesce(btrim(p_mensagem),''), 140),
                       'pecas', coalesce(jsonb_array_length(p_pecas), 0))
  );
  return jsonb_build_object('ok', true, 'entry_id', v_entry, 'kind', v_kind);
end $$;

-- Leitura da tela: a decisão que ela mostra tem que ser a DESTA rodada, senão o
-- cliente abre a tela da versão corrigida e lê a resposta que deu na anterior.
create or replace function portal_aprovacao(p_activity_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_pu portal_users; v_row jsonb;
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode='42501'; end if;

  select jsonb_build_object(
    'id', a.id, 'titulo', a.title, 'campanha', c.name,
    'pasta_ref', a.drive_folder_id,
    'decisao', (
      select jsonb_build_object('kind', e.kind, 'mensagem', e.mensagem, 'em', e.created_at)
      from portal_entries e
      where e.activity_id = a.id and e.kind in ('aprovacao','ajuste')
        and e.created_at >= portal_ciclo_desde(a.id)
      order by e.created_at desc limit 1
    )
  ) into v_row
  from activities a join campaigns c on c.id = a.campaign_id
  where a.id = p_activity_id and c.workspace_id = v_pu.workspace_id
    and a.status = 'aprovacao_cliente' and not a.archived and not c.archived;

  if v_row is null then raise exception 'Trabalho indisponível'; end if;
  return v_row;
end $$;

-- O portal fala por token `portal` (migration 152), não por `authenticated`.
revoke execute on function portal_ciclo_desde(uuid) from public, anon;
grant  execute on function portal_ciclo_desde(uuid) to portal, authenticated;

notify pgrst, 'reload schema';
