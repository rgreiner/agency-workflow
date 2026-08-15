-- 241_digest_entregas_midia.sql
-- A entrega tinha data-limite de veículo e não avisava ninguém: só aparecia
-- para quem abrisse a tela. Perder prazo de veículo é perder inserção paga —
-- é o item com a pior razão risco ÷ aviso do sistema.
--
-- Entra no digest que já existe (8h30), numa seção própria. Diferença de
-- modelo: tarefa tem responsável (activity_assignees), entrega NÃO — ela é da
-- mídia. Então o destinatário é quem opera o Hub (`op_midia_hub`, ver-tudo ou
-- owner/admin), a mesma régua de `midia_can`, mas avaliada aqui por user_id
-- (dentro do cron não há sessão, logo não há `auth.uid()`).
--
-- O digest existente NÃO muda de forma: quem não é da mídia recebe o mesmo
-- e-mail de sempre; quem é, ganha uma seção a mais. E quem só tem entregas
-- (nenhuma tarefa própria vencendo) passa a receber — antes ficava de fora.
--
-- Idempotente.

create or replace function digest_payload()
returns jsonb language sql stable security definer set search_path = public as $$
  with today as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  tasks as (
    select aa.user_id, a.id, a.title, a.due_date::text as due,
           c.name as campaign, w.name as cliente, o.slug as org_slug,
           case when a.due_date <  (select d from today) then 'atrasadas'
                when a.due_date =  (select d from today) then 'hoje'
                else 'proximas' end as bucket
    from activity_assignees aa
    join activities a  on a.id = aa.activity_id
    join campaigns  c  on c.id = a.campaign_id
    join workspaces w  on w.id = c.workspace_id
    join organizations o on o.id = w.org_id
    where a.archived = false and a.status <> 'concluido' and a.due_date is not null
      and a.due_date <= (select d from today) + 7
  ),
  agg as (
    select t.user_id, max(t.org_slug) as org_slug,
      jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'due',t.due,'campaign',t.campaign,'cliente',t.cliente) order by t.due)
        filter (where t.bucket='atrasadas') as atrasadas,
      jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'due',t.due,'campaign',t.campaign,'cliente',t.cliente) order by t.due)
        filter (where t.bucket='hoje')      as hoje,
      jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'due',t.due,'campaign',t.campaign,'cliente',t.cliente) order by t.due)
        filter (where t.bucket='proximas')  as proximas
    from tasks t
    group by t.user_id
  ),
  -- Quem opera o Hub de Mídia em cada org (régua do midia_can, sem auth.uid()).
  gente_midia as (
    select m.user_id, m.org_id, o.slug as org_slug
      from organization_members m
      join organizations o on o.id = m.org_id
      left join org_positions p on p.id = m.position_id
     where m.arquivado = false
       and (m.role in ('owner','admin') or coalesce(p.op_ver_tudo,false) or coalesce(p.op_midia_hub,false))
  ),
  entregas as (
    select e.org_id, e.id, e.titulo, e.prazo_envio::text as prazo,
           e.veiculo, w.name as cliente,
           -- Sem tarefa vinculada, o material não depende da criação.
           (a.id is not null and a.status not in (
              select s.valor from org_status s
               where s.org_id = e.org_id
                 and (s.papel = 'conclusao' or s.valor in ('validacao_midia','midia','social','implantacao_digital','implantacao_off'))
            )) as com_criacao
      from midia_entrega e
      join workspaces w on w.id = e.workspace_id
      left join activities a on a.id = e.activity_id
     where e.situacao = 'aguardando'
       and e.prazo_envio is not null
       and e.prazo_envio <= (select d from today) + 7
  ),
  entregas_agg as (
    select g.user_id, max(g.org_slug) as org_slug,
      jsonb_agg(jsonb_build_object(
        'id', e.id, 'titulo', e.titulo, 'prazo', e.prazo, 'cliente', e.cliente,
        'veiculo', e.veiculo, 'com_criacao', e.com_criacao
      ) order by e.prazo) as entregas
    from gente_midia g
    join entregas e on e.org_id = g.org_id
    group by g.user_id
  ),
  pessoas as (
    select coalesce(a.user_id, ea.user_id) as user_id,
           coalesce(a.org_slug, ea.org_slug) as org_slug,
           a.atrasadas, a.hoje, a.proximas, ea.entregas
      from agg a
      full outer join entregas_agg ea on ea.user_id = a.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'email', p.email, 'name', p.full_name, 'org_slug', x.org_slug,
           'atrasadas', coalesce(x.atrasadas, '[]'::jsonb),
           'hoje',      coalesce(x.hoje,      '[]'::jsonb),
           'proximas',  coalesce(x.proximas,  '[]'::jsonb),
           'entregas',  coalesce(x.entregas,  '[]'::jsonb)
         )), '[]'::jsonb)
  from pessoas x
  join profiles p on p.id = x.user_id
  where p.email is not null
    and coalesce((select up.digest_enabled from user_prefs up where up.user_id = x.user_id), true)
    and (x.atrasadas is not null or x.hoje is not null or x.proximas is not null or x.entregas is not null);
$$;

notify pgrst, 'reload schema';
