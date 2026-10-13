-- 341_reuniao_passo_anotacao.sql
-- Passo da ata pode ir para "Minhas anotações" da Caixa de entrada (13/10/2026):
-- ação do atendimento que não é pauta ("contatar o influenciador", "cobrar as
-- amostras"). O passo guarda o todo; concluir o todo marca o passo feito, e
-- reabrir o todo reabre o passo. Apagar o todo só solta o vínculo.
-- Idempotente.

alter table reuniao_passos add column if not exists todo_id uuid references todos(id) on delete set null;
create index if not exists reuniao_passos_todo_idx on reuniao_passos (todo_id) where todo_id is not null;

-- O todo tem de ser DA PESSOA que vincula (a policy de todos só mostra os próprios).
drop policy if exists reuniao_passos_write on reuniao_passos;
create policy reuniao_passos_write on reuniao_passos for all using (portal_pode_gerir(org_id)) with check (
  portal_pode_gerir(org_id)
  and exists (select 1 from reunioes r where r.id = reuniao_id and r.org_id = reuniao_passos.org_id)
  and (activity_id is null or exists (
    select 1 from activities a join campaigns c on c.id = a.campaign_id
    join reunioes r on r.id = reuniao_passos.reuniao_id
    where a.id = activity_id and c.workspace_id = r.workspace_id))
  and (producao_id is null or exists (
    select 1 from producao p join reunioes r on r.id = reuniao_passos.reuniao_id
    where p.id = producao_id and p.workspace_id = r.workspace_id))
  and (todo_id is null or exists (select 1 from todos t where t.id = todo_id and t.user_id = auth.uid()))
);

-- Concluir/reabrir a anotação espelha no passo. Definer: o passo é da org, o todo
-- é da pessoa; quem marca o próprio todo pode não ser do Atendimento.
create or replace function reuniao_passo_segue_todo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.done is distinct from old.done then
    update reuniao_passos
       set feito_em  = case when new.done then now() else null end,
           feito_por = case when new.done then new.user_id else null end
     where todo_id = new.id;
  end if;
  return new;
end $$;
revoke execute on function reuniao_passo_segue_todo() from public, anon, authenticated;

drop trigger if exists reuniao_passo_segue_todo on todos;
create trigger reuniao_passo_segue_todo after update of done on todos
  for each row execute function reuniao_passo_segue_todo();

-- Portal: passo na lista de anotações também está "em andamento".
create or replace function portal_reuniao(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_pu portal_users; v_row jsonb;
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode='42501'; end if;
  select jsonb_build_object(
    'id', r.id, 'titulo', r.titulo, 'realizada_em', r.realizada_em,
    'participantes', r.participantes, 'resumo', r.resumo,
    'campanha', c.name,
    'passos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'texto', p.texto, 'responsavel', p.responsavel,
        'feito', p.feito_em is not null,
        'em_andamento', p.feito_em is null and (p.activity_id is not null or p.producao_id is not null or p.todo_id is not null)
      ) order by p.ordem, p.created_at)
      from reuniao_passos p where p.reuniao_id = r.id
    ), '[]'::jsonb)
  ) into v_row
  from reunioes r left join campaigns c on c.id = r.campaign_id
  where r.id = p_id and r.workspace_id = v_pu.workspace_id and r.publicada;
  if v_row is null then raise exception 'Ata indisponível'; end if;
  return v_row;
end $$;
revoke execute on function portal_reuniao(uuid) from public, anon, authenticated;
grant execute on function portal_reuniao(uuid) to portal;

notify pgrst, 'reload schema';
