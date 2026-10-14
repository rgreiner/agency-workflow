-- 344_portal_nova_demanda.sql
-- "Solicitar nova demanda" no portal (14/10/2026, decisão do Rafael): o pedido do
-- cliente entra como TAREFA EM BRIEFING no cliente dele — substitui a regra de
-- 23/07 em que a solicitação só caía na caixa do atendimento.
--   • campanha: a que o cliente escolher; sem escolha, "Solicitações do cliente"
--     (criada na primeira vez);
--   • título no padrão da casa: AAMMDD - <o que o cliente escreveu>;
--   • briefing = o texto do cliente, ESCAPADO (vira HTML no editor interno);
--   • responsável: quem da EQUIPE do cliente atende briefing; sem ninguém lá,
--     quem tem o cargo de briefing na agência; sem ninguém ativo, o dono;
--   • prazo fica vazio: a data que o cliente deseja vai no briefing, o
--     atendimento é quem combina a entrega.
-- O registro em Solicitações continua (com a tarefa ligada) e o atendimento é
-- avisado com link direto para a tarefa.
-- Idempotente.

create or replace function portal_campanhas()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pu portal_users;
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode='42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.name) order by c.name)
      from campaigns c
     where c.workspace_id = v_pu.workspace_id and not c.archived
       and c.name <> 'Solicitações do cliente'
  ), '[]'::jsonb);
end $$;

-- Texto do cliente vira HTML seguro (o briefing interno renderiza HTML).
create or replace function portal_html_escapado(p text) returns text
language sql immutable as $$
  select replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

create or replace function portal_solicitar_demanda(
  p_titulo text, p_mensagem text, p_campanha uuid, p_data_desejada date, p_anexos jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pu portal_users; v_camp uuid; v_act uuid; v_entry uuid; v_slug text;
  v_titulo text; v_desc text; v_paragrafos text;
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode='42501'; end if;
  if v_pu.interno_user_id is not null then raise exception 'Modo visualização: só o cliente pede demanda'; end if;
  if coalesce(btrim(p_titulo), '') = '' then raise exception 'Título vazio'; end if;
  if coalesce(btrim(p_mensagem), '') = '' then raise exception 'Mensagem vazia'; end if;

  -- Campanha: só uma do PRÓPRIO cliente; sem escolha, a caixa de solicitações.
  if p_campanha is not null then
    select id into v_camp from campaigns
     where id = p_campanha and workspace_id = v_pu.workspace_id and not archived;
  end if;
  if v_camp is null then
    select id into v_camp from campaigns
     where workspace_id = v_pu.workspace_id and name = 'Solicitações do cliente' and not archived
     limit 1;
    if v_camp is null then
      insert into campaigns (workspace_id, name, description)
      values (v_pu.workspace_id, 'Solicitações do cliente', 'Pedidos feitos pelo cliente no portal.')
      returning id into v_camp;
    end if;
  end if;

  v_titulo := to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYMMDD') || ' - ' || left(btrim(p_titulo), 160);

  select string_agg('<p>' || portal_html_escapado(l) || '</p>', '')
    into v_paragrafos
    from unnest(string_to_array(replace(btrim(p_mensagem), E'\r', ''), E'\n')) as l
   where btrim(l) <> '';
  v_desc := '<h3>Pedido do cliente (portal)</h3>'
         || '<p><strong>' || portal_html_escapado(v_pu.nome) || '</strong> · '
         || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || '</p>'
         || coalesce(v_paragrafos, '')
         || case when p_data_desejada is not null
              then '<p><strong>Data desejada pelo cliente:</strong> ' || to_char(p_data_desejada, 'DD/MM/YYYY') || '</p>' else '' end
         || case when jsonb_array_length(coalesce(p_anexos, '[]'::jsonb)) > 0
              then '<p><em>' || jsonb_array_length(p_anexos) || ' anexo(s) do cliente em Solicitações.</em></p>' else '' end;

  insert into activities (campaign_id, title, description, status, created_by)
  values (v_camp, v_titulo, v_desc, 'briefing', null)
  returning id into v_act;

  -- Responsável: quem da equipe do cliente atende briefing (membro ativo).
  insert into activity_assignees (activity_id, user_id)
  select distinct v_act, m.user_id
    from workspaces w
    join organization_members m on m.org_id = w.org_id and m.user_id = any(coalesce(w.equipe, '{}'::uuid[]))
    join org_positions pos on pos.id = m.position_id
   where w.id = v_pu.workspace_id and not m.arquivado
     and 'briefing' = any(pos.allowed_statuses)
  on conflict do nothing;

  -- Equipe do cliente sem ninguém de briefing (o comum: equipe = Design+Redação)?
  -- Vai para quem tem o cargo que cuida de briefing na agência.
  if not exists (select 1 from activity_assignees where activity_id = v_act) then
    insert into activity_assignees (activity_id, user_id)
    select distinct v_act, m.user_id
      from organization_members m
      join org_positions pos on pos.id = m.position_id
     where m.org_id = v_pu.org_id and not m.arquivado
       and 'briefing' = any(pos.allowed_statuses)
    on conflict do nothing;
  end if;

  -- Ninguém ativo com esse cargo (14/10: o Atendimento estava vago)? Dono da conta.
  if not exists (select 1 from activity_assignees where activity_id = v_act) then
    insert into activity_assignees (activity_id, user_id)
    select v_act, m.user_id from organization_members m
     where m.org_id = v_pu.org_id and m.role = 'owner' and not m.arquivado
    on conflict do nothing;
  end if;

  insert into activity_history (activity_id, changed_by, to_status, comment)
  values (v_act, null, 'briefing', 'Pedido do cliente pelo portal (' || v_pu.nome || ')');

  insert into portal_entries (org_id, workspace_id, portal_user_id, kind, activity_id, titulo, mensagem, anexos)
  values (v_pu.org_id, v_pu.workspace_id, v_pu.id, 'solicitacao', v_act, btrim(p_titulo), btrim(p_mensagem),
          coalesce(p_anexos, '[]'::jsonb))
  returning id into v_entry;

  select slug into v_slug from organizations where id = v_pu.org_id;
  perform portal_notificar(
    v_pu.org_id, 'briefing'::text, 'portal_solicitacao', v_act,
    jsonb_build_object('cliente', v_pu.nome, 'entry_id', v_entry, 'titulo', btrim(p_titulo),
                       'preview', left(btrim(p_mensagem), 140),
                       'anexos', jsonb_array_length(coalesce(p_anexos, '[]'::jsonb)),
                       'href', '/' || v_slug || '/workspaces/' || v_pu.workspace_id
                               || '/campaigns/' || v_camp || '/activities/' || v_act));

  return jsonb_build_object('ok', true, 'activity_id', v_act, 'entry_id', v_entry,
                            'org_id', v_pu.org_id, 'workspace_id', v_pu.workspace_id);
end $$;

revoke execute on function portal_campanhas() from public, anon, authenticated;
grant  execute on function portal_campanhas() to portal;
revoke execute on function portal_html_escapado(text) from public, anon, authenticated, portal;
revoke execute on function portal_solicitar_demanda(text, text, uuid, date, jsonb) from public, anon, authenticated;
grant  execute on function portal_solicitar_demanda(text, text, uuid, date, jsonb) to portal;

notify pgrst, 'reload schema';
