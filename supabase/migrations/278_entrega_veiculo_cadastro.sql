-- 278_entrega_veiculo_cadastro.sql
-- Passo 2 do Hub de Mídia (artefato, 04/09): veículo da entrega é CADASTRO, não
-- texto. `veiculos` (mig. 038/062) já tem e-mails e telefones e é o que o
-- comercial usa em PI/MX. A entrega passa a apontar para lá; o texto antigo fica
-- como fallback nas entregas já criadas — e, quando há cadastro, a coluna de
-- texto recebe o nome canônico, para o digest (241) e quem mais lê a coluna
-- continuarem certos sem mudar.
-- Idempotente. DROP+CREATE da RPC: parâmetro novo com DEFAULT viraria overload
-- e o PostgREST recusa (1 assinatura por RPC).

alter table midia_entrega
  add column if not exists veiculo_id uuid references veiculos(id) on delete set null;
create index if not exists midia_entrega_veiculo_idx on midia_entrega (veiculo_id);

-- Passivo: texto que bate exatamente com UM veículo ativo do cadastro ganha o vínculo.
update midia_entrega e
   set veiculo_id = v.id
  from veiculos v
 where e.veiculo_id is null
   and e.veiculo is not null
   and v.org_id = e.org_id and v.archived = false
   and lower(btrim(v.name)) = lower(btrim(e.veiculo))
   and (select count(*) from veiculos v2
         where v2.org_id = e.org_id and v2.archived = false
           and lower(btrim(v2.name)) = lower(btrim(e.veiculo))) = 1;

-- ── View: nome canônico vence o texto; contato do cadastro vem junto ─────────
drop view if exists midia_entrega_view;
create view midia_entrega_view with (security_invoker = true) as
select
  e.id, e.org_id, e.workspace_id, e.campaign_id, e.titulo,
  coalesce(v.name, e.veiculo) as veiculo,
  e.veiculo   as veiculo_texto,
  e.veiculo_id,
  v.emails    as veiculo_emails,
  v.telefones as veiculo_telefones,
  e.formato,
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

-- ── Escrita: ganha p_veiculo_id ──────────────────────────────────────────────
drop function if exists public.midia_entrega_salvar(uuid, uuid, text, text, text, date, uuid, uuid, text);

create or replace function public.midia_entrega_salvar(
  p_id uuid, p_workspace_id uuid, p_titulo text, p_veiculo text, p_formato text,
  p_prazo_envio date, p_activity_id uuid, p_campaign_id uuid, p_observacao text,
  p_veiculo_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid; v_nome text; v_veiculo text;
begin
  select org_id into v_org from workspaces where id = p_workspace_id;
  if v_org is null then raise exception 'Cliente não encontrado'; end if;
  if not midia_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if coalesce(btrim(p_titulo), '') = '' then raise exception 'A entrega precisa de um nome'; end if;

  -- Veículo do cadastro tem que ser da org; o texto recebe o nome canônico.
  if p_veiculo_id is not null then
    select name into v_nome from veiculos where id = p_veiculo_id and org_id = v_org;
    if v_nome is null then raise exception 'Veículo não encontrado no cadastro'; end if;
  end if;
  v_veiculo := coalesce(v_nome, nullif(btrim(coalesce(p_veiculo, '')), ''));

  if p_id is null then
    insert into midia_entrega (org_id, workspace_id, campaign_id, titulo, veiculo, veiculo_id, formato,
                               prazo_envio, activity_id, observacao, created_by)
    values (v_org, p_workspace_id, p_campaign_id, btrim(p_titulo), v_veiculo, p_veiculo_id,
            nullif(btrim(coalesce(p_formato, '')), ''),
            p_prazo_envio, p_activity_id, nullif(btrim(coalesce(p_observacao, '')), ''), auth.uid())
    returning id into v_id;
  else
    update midia_entrega
       set workspace_id = p_workspace_id,
           campaign_id  = p_campaign_id,
           titulo       = btrim(p_titulo),
           veiculo      = v_veiculo,
           veiculo_id   = p_veiculo_id,
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
revoke execute on function public.midia_entrega_salvar(uuid, uuid, text, text, text, date, uuid, uuid, text, uuid) from public, anon;
grant  execute on function public.midia_entrega_salvar(uuid, uuid, text, text, text, date, uuid, uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
