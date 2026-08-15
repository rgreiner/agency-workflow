-- 236_midia_entregas.sql
-- Hub de Mídia, fase 2: a ENTREGA — a peça que a mídia está esperando da
-- criação para poder liberar no veículo.
--
-- A decisão do Rafael (Q4, 14/08) e o porquê de cada parte:
--  · "a tarefa criada pelo atendimento precisa ter relação com o item que a
--    mídia está esperando" → `activity_id` aponta para a tarefa da criação.
--  · "o prazo da tarefa e o prazo da mídia precisam ser SEPARADOS" → o prazo de
--    envio mora AQUI (`prazo_envio`), nunca em `activities.due_date`. São dois
--    compromissos diferentes: a criação entrega a arte, a mídia envia ao
--    veículo. Fundir os dois foi o que sempre fez a data do veículo sumir.
--  · "se houver conflito, elas precisam se conversar" → `conflito_prazo` na
--    view: a criação prometeu para DEPOIS do que a mídia precisa enviar. É
--    calculado, nunca digitado — não existe estado para ficar desatualizado.
--  · "a mídia ter uma lista do que está pendente, a fim de cobrar o time
--    criativo" → é a tela /midia/entregas, alimentada por esta view.
--
-- Idempotente.

create table if not exists midia_entrega (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  -- O cliente. Não exige operação de mídia ativa: entrega avulsa de campanha
  -- pontual também precisa de data-limite.
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  campaign_id   uuid references campaigns(id) on delete set null,
  titulo        text not null,
  veiculo       text,
  formato       text,
  -- PRAZO DA MÍDIA: até quando o material tem que estar no veículo.
  prazo_envio   date,
  -- A tarefa da criação que produz esta peça (opcional: material que vem
  -- pronto do cliente não tem tarefa).
  activity_id   uuid references activities(id) on delete set null,
  situacao      text not null default 'aguardando'
                check (situacao in ('aguardando', 'liberado', 'cancelado')),
  liberado_em   timestamptz,
  liberado_por  uuid references profiles(id),
  observacao    text,
  created_at    timestamptz not null default now(),
  created_by    uuid references profiles(id)
);
create index if not exists midia_entrega_org_idx on midia_entrega (org_id, situacao, prazo_envio);
create index if not exists midia_entrega_ws_idx  on midia_entrega (workspace_id);
create index if not exists midia_entrega_act_idx on midia_entrega (activity_id);

alter table midia_entrega enable row level security;
drop policy if exists midia_entrega_read on midia_entrega;
create policy midia_entrega_read on midia_entrega for select using (midia_can(org_id));

-- ── A view que as duas telas leem ────────────────────────────────────────────
-- ⚠️ `security_invoker = true` é obrigatório (foi a ausência dele que vazou o
-- livro-caixa na migration 181). Com ele, a RLS de midia_entrega e de activities
-- continua valendo para quem consulta.
drop view if exists midia_entrega_view;
create view midia_entrega_view with (security_invoker = true) as
select
  e.id, e.org_id, e.workspace_id, e.campaign_id, e.titulo, e.veiculo, e.formato,
  e.prazo_envio, e.activity_id, e.situacao, e.liberado_em, e.observacao,
  e.created_at,
  w.name  as cliente,
  c.name  as campanha,
  a.title as tarefa_titulo,
  a.status as tarefa_status,
  a.due_date as tarefa_prazo,
  a.archived as tarefa_arquivada,
  a.campaign_id as tarefa_campaign_id,
  ac.workspace_id as tarefa_workspace_id,
  a.preview_url, a.finalizacao_url, a.drive_folder_url,
  -- O conflito: a criação promete DEPOIS do que o veículo exige. Só existe
  -- quando os dois prazos existem — sem prazo não há promessa a comparar.
  (a.id is not null and e.prazo_envio is not null and a.due_date is not null
     and a.due_date > e.prazo_envio) as conflito_prazo
from midia_entrega e
join workspaces w on w.id = e.workspace_id
left join campaigns c  on c.id = e.campaign_id
left join activities a on a.id = e.activity_id
left join campaigns ac on ac.id = a.campaign_id;

revoke all on midia_entrega_view from anon;
grant select on midia_entrega_view to authenticated;

-- ── Escrita ──────────────────────────────────────────────────────────────────
create or replace function midia_entrega_salvar(
  p_id uuid, p_workspace_id uuid, p_titulo text, p_veiculo text, p_formato text,
  p_prazo_envio date, p_activity_id uuid, p_campaign_id uuid, p_observacao text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid;
begin
  select org_id into v_org from workspaces where id = p_workspace_id;
  if v_org is null then raise exception 'Cliente não encontrado'; end if;
  if not midia_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if coalesce(btrim(p_titulo), '') = '' then raise exception 'A entrega precisa de um nome'; end if;

  if p_id is null then
    insert into midia_entrega (org_id, workspace_id, campaign_id, titulo, veiculo, formato,
                               prazo_envio, activity_id, observacao, created_by)
    values (v_org, p_workspace_id, p_campaign_id, btrim(p_titulo),
            nullif(btrim(coalesce(p_veiculo, '')), ''), nullif(btrim(coalesce(p_formato, '')), ''),
            p_prazo_envio, p_activity_id, nullif(btrim(coalesce(p_observacao, '')), ''), auth.uid())
    returning id into v_id;
  else
    update midia_entrega
       set workspace_id = p_workspace_id,
           campaign_id  = p_campaign_id,
           titulo       = btrim(p_titulo),
           veiculo      = nullif(btrim(coalesce(p_veiculo, '')), ''),
           formato      = nullif(btrim(coalesce(p_formato, '')), ''),
           prazo_envio  = p_prazo_envio,
           activity_id  = p_activity_id,
           observacao   = nullif(btrim(coalesce(p_observacao, '')), '')
     where id = p_id and org_id = v_org
    returning id into v_id;
    if v_id is null then raise exception 'Entrega não encontrada'; end if;
  end if;
  return v_id;
end $$;
revoke execute on function midia_entrega_salvar(uuid, uuid, text, text, text, date, uuid, uuid, text) from public, anon;
grant  execute on function midia_entrega_salvar(uuid, uuid, text, text, text, date, uuid, uuid, text) to authenticated;

/** Liberar = o material foi enviado ao veículo. Reversível: erro de clique não
 *  pode exigir recriar a entrega. */
create or replace function midia_entrega_situacao(p_id uuid, p_situacao text)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from midia_entrega where id = p_id;
  if v_org is null then raise exception 'Entrega não encontrada'; end if;
  if not midia_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_situacao not in ('aguardando', 'liberado', 'cancelado') then
    raise exception 'Situação inválida';
  end if;
  update midia_entrega
     set situacao = p_situacao,
         liberado_em  = case when p_situacao = 'liberado' then now() else null end,
         liberado_por = case when p_situacao = 'liberado' then auth.uid() else null end
   where id = p_id;
end $$;
revoke execute on function midia_entrega_situacao(uuid, text) from public, anon;
grant  execute on function midia_entrega_situacao(uuid, text) to authenticated;

create or replace function midia_entrega_excluir(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from midia_entrega where id = p_id;
  if v_org is null then raise exception 'Entrega não encontrada'; end if;
  if not midia_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  delete from midia_entrega where id = p_id;
end $$;
revoke execute on function midia_entrega_excluir(uuid) from public, anon;
grant  execute on function midia_entrega_excluir(uuid) to authenticated;

notify pgrst, 'reload schema';
