-- 307_reuniao_passo_orcamento_feito.sql
-- Passo da ata (mig. 306) ganha dois desfechos além da tarefa (29/09/2026):
--   • producao_id → o passo vira/liga um ORÇAMENTO (tabela producao, tipo orcamento);
--   • feito_em    → consulta ou combinado que não é trabalho de pauta: só marcar feito.
-- Portal: "Feito" quando feito_em; "Em andamento" com tarefa ou orçamento.
-- Idempotente.

alter table reuniao_passos add column if not exists producao_id uuid references producao(id) on delete set null;
alter table reuniao_passos add column if not exists feito_em timestamptz;
alter table reuniao_passos add column if not exists feito_por uuid references auth.users(id) on delete set null;
create index if not exists reuniao_passos_producao_idx on reuniao_passos (producao_id) where producao_id is not null;

-- Mesma trava da tarefa: orçamento tem de ser do MESMO cliente da ata.
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
);

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
        'em_andamento', p.feito_em is null and (p.activity_id is not null or p.producao_id is not null)
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

-- Contador do painel: passo do cliente já feito não conta como pendente.
create or replace function portal_reunioes()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_pu portal_users;
begin
  v_pu := portal_atual();
  if v_pu.id is null then raise exception 'Acesso negado' using errcode='42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'titulo', r.titulo, 'realizada_em', r.realizada_em,
      'passos_cliente', (select count(*) from reuniao_passos p
                         where p.reuniao_id = r.id and p.responsavel = 'cliente' and p.feito_em is null)
    ) order by r.realizada_em desc, r.created_at desc)
    from reunioes r
    where r.workspace_id = v_pu.workspace_id and r.publicada
  ), '[]'::jsonb);
end $$;
revoke execute on function portal_reunioes() from public, anon, authenticated;
grant execute on function portal_reunioes() to portal;

notify pgrst, 'reload schema';
