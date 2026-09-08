-- 282_entrega_formato_especificacao_pedido.sql
-- O pedido da mídia chegava com o TEXTO do pedido no nome da tarefa (e da pasta):
-- o modal só tinha "O que é a entrega" e "Especificação", e os dois iam para o
-- título. Decisão do Rafael (08/09/2026): o texto do pedido vira BRIEFING; o nome
-- é curto — DATA - VEÍCULO - FORMATO - JOB. Duas colunas novas:
--   especificacao — dimensões/regras da peça (vai para o briefing e o card,
--                   nunca para o título); `formato` volta a ser o do catálogo.
--   pedido        — o que a criação precisa fazer; vira o briefing da tarefa
--                   aberta pela entrega e fica guardado para o caso de a criação
--                   falhar e alguém reabrir o modal.
-- Idempotente. DROP+CREATE da RPC (1 assinatura por RPC no PostgREST).

alter table midia_entrega add column if not exists especificacao text;
alter table midia_entrega add column if not exists pedido text;

drop view if exists midia_entrega_view;
create view midia_entrega_view with (security_invoker = true) as
select
  e.id, e.org_id, e.workspace_id, e.campaign_id, e.titulo,
  coalesce(v.name, e.veiculo) as veiculo,
  e.veiculo   as veiculo_texto,
  e.veiculo_id,
  v.emails    as veiculo_emails,
  v.telefones as veiculo_telefones,
  e.formato, e.especificacao, e.pedido,
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
  (a.id is not null and e.prazo_envio is not null and a.due_date is not null
     and a.due_date > e.prazo_envio) as conflito_prazo
from midia_entrega e
join workspaces w on w.id = e.workspace_id
left join campaigns c  on c.id = e.campaign_id
left join activities a on a.id = e.activity_id
left join campaigns ac on ac.id = a.campaign_id
left join veiculos v   on v.id = e.veiculo_id;

revoke all on midia_entrega_view from anon;
grant select on midia_entrega_view to authenticated;

drop function if exists public.midia_entrega_salvar(uuid, uuid, text, text, text, date, uuid, uuid, text, uuid);

create or replace function public.midia_entrega_salvar(
  p_id uuid, p_workspace_id uuid, p_titulo text, p_veiculo text, p_formato text,
  p_prazo_envio date, p_activity_id uuid, p_campaign_id uuid, p_observacao text,
  p_veiculo_id uuid, p_especificacao text, p_pedido text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid; v_nome text; v_veiculo text;
begin
  select org_id into v_org from workspaces where id = p_workspace_id;
  if v_org is null then raise exception 'Cliente não encontrado'; end if;
  if not midia_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if coalesce(btrim(p_titulo), '') = '' then raise exception 'A entrega precisa de um nome'; end if;

  if p_veiculo_id is not null then
    select name into v_nome from veiculos where id = p_veiculo_id and org_id = v_org;
    if v_nome is null then raise exception 'Veículo não encontrado no cadastro'; end if;
  end if;
  v_veiculo := coalesce(v_nome, nullif(btrim(coalesce(p_veiculo, '')), ''));

  if p_id is null then
    insert into midia_entrega (org_id, workspace_id, campaign_id, titulo, veiculo, veiculo_id, formato,
                               especificacao, pedido, prazo_envio, activity_id, observacao, created_by)
    values (v_org, p_workspace_id, p_campaign_id, btrim(p_titulo), v_veiculo, p_veiculo_id,
            nullif(btrim(coalesce(p_formato, '')), ''),
            nullif(btrim(coalesce(p_especificacao, '')), ''),
            nullif(btrim(coalesce(p_pedido, '')), ''),
            p_prazo_envio, p_activity_id, nullif(btrim(coalesce(p_observacao, '')), ''), auth.uid())
    returning id into v_id;
  else
    update midia_entrega
       set workspace_id  = p_workspace_id,
           campaign_id   = p_campaign_id,
           titulo        = btrim(p_titulo),
           veiculo       = v_veiculo,
           veiculo_id    = p_veiculo_id,
           formato       = nullif(btrim(coalesce(p_formato, '')), ''),
           especificacao = nullif(btrim(coalesce(p_especificacao, '')), ''),
           pedido        = nullif(btrim(coalesce(p_pedido, '')), ''),
           prazo_envio   = p_prazo_envio,
           activity_id   = p_activity_id,
           observacao    = nullif(btrim(coalesce(p_observacao, '')), '')
     where id = p_id and org_id = v_org
    returning id into v_id;
    if v_id is null then raise exception 'Entrega não encontrada'; end if;
  end if;
  return v_id;
end $$;
revoke execute on function public.midia_entrega_salvar(uuid, uuid, text, text, text, date, uuid, uuid, text, uuid, text, text) from public, anon;
grant  execute on function public.midia_entrega_salvar(uuid, uuid, text, text, text, date, uuid, uuid, text, uuid, text, text) to authenticated;

-- Passivo do teste de 08/09 ("Destaque Story Comil"): o que estava no campo errado
-- vai para o campo certo, e a tarefa ganha o nome curto e o briefing. A pasta do
-- Drive é renomeada pelo botão "Renomear pasta" da tarefa (só com ela vazia).
update midia_entrega
   set formato = 'Stories',
       especificacao = '1080×1920 px (Story para IG)',
       pedido = observacao,
       observacao = null
 where activity_id = '757c52f4-2e3d-4a04-bef1-e5aaf9e6f8ac'
   and formato like '1080x1920px%';

update activities
   set title = '260908 - Facebook - Stories - Quem somos',
       description = $b$<p>Precisamos criar conteúdos para dois destaques da Comil que foram realizados as capas, são eles: "News" e "Quem somos" (Precisamos focar em uma comunicação da Empresa, com fotos da fábrica.)</p><p><strong>Especificação:</strong> Stories · 1080×1920 px (Story para IG)</p>$b$,
       updated_at = now()
 where id = '757c52f4-2e3d-4a04-bef1-e5aaf9e6f8ac'
   and title like '260908 - Facebook - 1080x1920px%';

notify pgrst, 'reload schema';
