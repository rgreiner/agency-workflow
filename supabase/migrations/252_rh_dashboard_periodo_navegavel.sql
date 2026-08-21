-- 252_rh_dashboard_periodo_navegavel.sql
-- Painel de RH: período navegável. A RPC ganha `p_ate` (último mês do período;
-- null = mês corrente) e TODA consulta passa a ter limite superior — até aqui era
-- "de v_ini até agora", o que bastava porque o fim era sempre hoje.
--
-- Dois blocos ignoravam o período e passam a respeitá-lo (senão navegar não muda
-- nada neles):
--   · Folha: série e "por pessoa" restritas à janela (última competência <= fim).
--   · Prazo: concluídas NO PERÍODO (data em que entrou num status 'done', pelo
--     histórico), ARQUIVADAS INCLUÍDAS — o time arquiva as concluídas em lote
--     (ver memória), então excluí-las zeraria qualquer mês passado. Até aqui o
--     card somava o histórico inteiro e só das não arquivadas.
-- Quadro "hoje" (ativos, tempo de casa, faixas) continua sendo hoje — é foto
-- atual, o rótulo do card diz isso. Avaliação continua todos os ciclos (é
-- comparação ao longo do tempo).
--
-- Assinatura muda (uuid,int) → (uuid,int,date default null): DROP da antiga antes,
-- senão viram 2 overloads e o PostgREST recusa a chamada. Chamada antiga
-- {p_org, p_meses} continua válida pelo default. Idempotente.

drop function if exists rh_dashboard(uuid, int);

create or replace function rh_dashboard(p_org uuid, p_meses int default 12, p_ate date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_ini date; v_fim date; v_fim_x date; v_meses int; v_ativos int;
  v_quadro jsonb; v_folha jsonb; v_ponto jsonb; v_fluxo jsonb; v_aval jsonb;
  v_comp_folha date; v_qtd_comp int; v_desl int; v_med numeric;
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  v_meses := greatest(1, least(coalesce(p_meses, 12), 36));
  -- Fim do período = mês pedido (p_ate), nunca depois do mês corrente; v_fim_x é
  -- o limite EXCLUSIVO (1º dia do mês seguinte) usado em toda consulta.
  v_fim   := least(date_trunc('month', coalesce(p_ate, current_date))::date,
                   date_trunc('month', current_date)::date);
  v_ini   := (v_fim - make_interval(months => v_meses - 1))::date;
  v_fim_x := (v_fim + interval '1 month')::date;

  -- ── Quadro: headcount mês a mês, tempo de casa, entradas e saídas ─────────
  select count(*) filter (where status = 'ativo'),
         round(avg(current_date - data_admissao) filter (where status = 'ativo') / 30.44, 1)
    into v_ativos, v_med
    from rh_colaborador where org_id = p_org and not arquivado;

  select count(*) into v_desl from rh_colaborador
   where org_id = p_org and data_demissao >= v_ini and data_demissao < v_fim_x;

  v_quadro := jsonb_build_object(
    'ativos', v_ativos,
    'tempo_casa_meses', v_med,
    -- Headcount no fim de cada mês: admitido até lá e ainda não desligado.
    'serie', coalesce((
      select jsonb_agg(jsonb_build_object('mes', to_char(m.mes, 'YYYY-MM'), 'n', (
               select count(*) from rh_colaborador c
                where c.org_id = p_org and not c.arquivado
                  and c.data_admissao <= (m.mes + interval '1 month - 1 day')::date
                  and (c.data_demissao is null or c.data_demissao > (m.mes + interval '1 month - 1 day')::date)
             )) order by m.mes)
        from generate_series(v_ini, v_fim, interval '1 month') m(mes)), '[]'::jsonb),
    'tempo_casa_faixas', coalesce((
      select jsonb_object_agg(f.faixa, f.n) from (
        select case when current_date - data_admissao < 365 then 'ate_1_ano'
                    when current_date - data_admissao < 730 then 'de_1_a_2'
                    when current_date - data_admissao < 1825 then 'de_2_a_5'
                    else 'mais_de_5' end as faixa, count(*) as n
          from rh_colaborador
         where org_id = p_org and not arquivado and status = 'ativo' and data_admissao is not null
         group by 1) f), '{}'::jsonb),
    -- Agrega numa subquery antes do jsonb_agg: agregação dentro de agregação
    -- é erro no Postgres ("aggregate function calls cannot be nested").
    'entradas', coalesce((
      select jsonb_agg(jsonb_build_object('mes', e.mes, 'n', e.n) order by e.mes)
        from (select to_char(date_trunc('month', data_admissao), 'YYYY-MM') as mes, count(*) as n
                from rh_colaborador
               where org_id = p_org and not arquivado
                 and data_admissao >= v_ini and data_admissao < v_fim_x
               group by 1) e), '[]'::jsonb),
    'saidas', coalesce((
      select jsonb_agg(jsonb_build_object('mes', s.mes, 'n', s.n) order by s.mes)
        from (select to_char(date_trunc('month', data_demissao), 'YYYY-MM') as mes, count(*) as n
                from rh_colaborador
               where org_id = p_org and data_demissao >= v_ini and data_demissao < v_fim_x
               group by 1) s), '[]'::jsonb),
    'desligamentos_periodo', v_desl,
    -- Turnover = saídas ÷ quadro. Com pouca saída o número oscila muito; a tela
    -- mostra a contagem junto para não fingir precisão que não existe.
    'turnover_pct', case when v_ativos > 0 then round(v_desl::numeric * 100 / v_ativos, 1) else null end);

  -- ── Folha: custo da última competência importada ──────────────────────────
  select count(distinct competencia), max(competencia) into v_qtd_comp, v_comp_folha
    from rh_folha where org_id = p_org and competencia >= v_ini and competencia < v_fim_x;

  v_folha := jsonb_build_object(
    'competencias', v_qtd_comp,
    'competencia', v_comp_folha,
    -- Evolução exige 2+ competências. Com uma só, a tela pede a importação em
    -- vez de desenhar uma linha de um ponto.
    'tem_evolucao', v_qtd_comp >= 2,
    'serie', coalesce((
      select jsonb_agg(jsonb_build_object(
               'mes', f.mes, 'liquido', f.liquido, 'encargos', f.encargos, 'pessoas', f.pessoas)
             order by f.comp)
        from (select competencia as comp, to_char(competencia, 'YYYY-MM') as mes,
                     round(sum(liquido)::numeric, 2) as liquido,
                     round(sum(coalesce(inss, 0) + coalesce(fgts, 0))::numeric, 2) as encargos,
                     count(*) as pessoas
                from rh_folha where org_id = p_org and competencia >= v_ini and competencia < v_fim_x
               group by competencia) f), '[]'::jsonb),
    'por_pessoa', coalesce((
      select jsonb_agg(jsonb_build_object('nome', nome, 'cargo', cargo,
               'liquido', round(liquido::numeric, 2), 'tratamento', tratamento)
             order by liquido desc nulls last)
        from rh_folha where org_id = p_org and competencia = v_comp_folha), '[]'::jsonb));

  -- ── Ponto: horas e extras por mês (marcando o histórico congelado) ────────
  v_ponto := coalesce((
    select jsonb_agg(x.j order by x.mes desc) from (
      select date_trunc('month', p.data) as mes, jsonb_build_object(
        'mes', to_char(date_trunc('month', p.data), 'YYYY-MM'),
        'dias', count(*),
        'horas', round(sum(coalesce(p.minutos, 0))::numeric / 60, 1),
        'extras_aprovadas_h', round(sum(case when p.extra_status = 'aprovado'
                                             then greatest(0, coalesce(p.saldo_min, 0)) else 0 end)::numeric / 60, 1),
        'extras_pendentes_h', round(sum(case when p.extra_status = 'pendente'
                                             then greatest(0, coalesce(p.saldo_min, 0)) else 0 end)::numeric / 60, 1),
        -- Mês do Pontomais: régua deles, não some com a do Flow.
        'importado', bool_or(p.origem is not null)) as j
        from rh_ponto p
       where p.org_id = p_org and p.data >= v_ini and p.data < v_fim_x
       group by date_trunc('month', p.data)
    ) x), '[]'::jsonb);

  -- ── Fluxo: onde o trabalho VOLTA, de quem é, e o cumprimento de prazo ─────
  -- Volta de etapa = destino com ordem MENOR que a origem no cadastro de status.
  -- activities não tem org_id: a org vem por campaign → workspace.
  -- Reabertura automática de recorrência (recur_activity, mig. 054) grava
  -- concluido → status de retorno com comentário fixo "Recorrência: …" — fora.
  with volta as (
    select ah.id, ah.activity_id, ah.to_status, ah.changed_at,
           sa.label as de, sb.label as para, sa.bg as cor_de, sb.ordem as ordem_para
      from activity_history ah
      join activities a  on a.id  = ah.activity_id
      join campaigns cp  on cp.id = a.campaign_id
      join workspaces w  on w.id  = cp.workspace_id
      join org_status sa on sa.org_id = p_org and sa.valor = ah.from_status
      join org_status sb on sb.org_id = p_org and sb.valor = ah.to_status
     where w.org_id = p_org and ah.from_status is not null
       and ah.changed_at >= v_ini and ah.changed_at < v_fim_x
       and sb.ordem < sa.ordem
       and coalesce(ah.comment, '') not like 'Recorrência:%'
  ),
  -- Nível 1: quem estava na tarefa (já na data da volta) e cujo cargo cobre a
  -- etapa de destino.
  direto as (
    select v.id, aa.user_id
      from volta v
      join activity_assignees aa on aa.activity_id = v.activity_id and aa.assigned_at <= v.changed_at
      join organization_members om on om.user_id = aa.user_id and om.org_id = p_org
      join org_positions pos on pos.id = om.position_id
     where v.to_status = any(pos.allowed_statuses)
  ),
  -- Quem ENTREGOU a etapa de destino por último: moveu a tarefa pra frente a
  -- partir dela, antes da volta, tendo o cargo que cobre essa etapa.
  entregou as (
    select distinct on (v.id) v.id, h.changed_by as user_id
      from volta v
      join activity_history h on h.activity_id = v.activity_id
                             and h.from_status = v.to_status and h.changed_at < v.changed_at
      join org_status s2 on s2.org_id = p_org and s2.valor = h.to_status
      join organization_members om on om.user_id = h.changed_by and om.org_id = p_org
      join org_positions pos on pos.id = om.position_id
     where s2.ordem > v.ordem_para and v.to_status = any(pos.allowed_statuses)
     order by v.id, h.changed_at desc
  ),
  -- Nível 1 desempatado: 2+ pessoas cobrem a etapa → fica só quem entregou,
  -- se estiver entre elas; senão conta para todas.
  n1 as (
    select d.id, d.user_id
      from direto d
      left join entregou e on e.id = d.id
     where e.user_id is null
        or e.user_id = d.user_id
        or not exists (select 1 from direto d2 where d2.id = d.id and d2.user_id = e.user_id)
  ),
  dono as (
    select id, user_id from n1
    union all
    -- Nível 2: ninguém na tarefa cobre a etapa → quem a entregou por último.
    select e.id, e.user_id from entregou e
     where not exists (select 1 from direto d where d.id = e.id)
  ),
  pessoa_par as (
    select d.user_id, v.de, v.para, v.cor_de, count(*) as n
      from dono d join volta v on v.id = d.id
     group by 1, 2, 3, 4
  ),
  pessoa as (
    select pp.user_id, p.full_name, p.avatar_url, pos.name as cargo, sum(pp.n) as n,
           jsonb_agg(jsonb_build_object('de', pp.de, 'para', pp.para, 'cor', pp.cor_de, 'n', pp.n)
                     order by pp.n desc) as pares
      from pessoa_par pp
      join profiles p on p.id = pp.user_id
      left join organization_members om on om.user_id = pp.user_id and om.org_id = p_org
      left join org_positions pos on pos.id = om.position_id
     group by 1, 2, 3, 4
  ),
  orfa as (
    select v.para, count(*) as n from volta v
     where not exists (select 1 from dono d where d.id = v.id)
     group by 1
  )
  select jsonb_build_object(
    'retrabalho', coalesce((
      select jsonb_agg(jsonb_build_object('de', h.de, 'para', h.para, 'n', h.n) order by h.n desc)
        from (select de, para, count(*) as n from volta group by 1, 2) h), '[]'::jsonb),
    'retrabalho_pessoa', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', ps.user_id, 'nome', ps.full_name, 'avatar_url', ps.avatar_url,
               'cargo', ps.cargo, 'n', ps.n, 'pares', ps.pares)
             order by ps.n desc, ps.full_name)
        from pessoa ps), '[]'::jsonb),
    'retrabalho_sem_dono', jsonb_build_object(
      'n', (select coalesce(sum(n), 0) from orfa),
      'etapas', coalesce((select jsonb_agg(jsonb_build_object('para', o.para, 'n', o.n) order by o.n desc)
                            from orfa o), '[]'::jsonb)))
    into v_fluxo;

  -- Prazo: concluídas NO PERÍODO — a data de conclusão vem do HISTÓRICO (quando
  -- entrou num status 'done'), não de `updated_at`: medido em produção, `updated_at`
  -- acusava 41 atrasadas contra 30 reais, porque qualquer edição posterior à
  -- entrega empurrava a data. `updated_at` fica só de reserva para atividade
  -- concluída antes do histórico existir (06/2026). Arquivadas ENTRAM: o time
  -- arquiva as concluídas em lote, excluí-las zeraria qualquer mês passado.
  v_fluxo := v_fluxo || jsonb_build_object('prazo', (
      select jsonb_build_object(
        'concluidas', count(*),
        'no_prazo',  count(*) filter (where c.due_date is null or c.fim <= c.due_date),
        'atrasadas', count(*) filter (where c.due_date is not null and c.fim > c.due_date))
        from (
          select a.due_date,
                 coalesce((select max(h.changed_at)::date
                             from activity_history h
                             join org_status sd on sd.org_id = p_org and sd.valor = h.to_status and sd.grupo = 'done'
                            where h.activity_id = a.id),
                          case when s.grupo = 'done' then a.updated_at::date end) as fim
            from activities a
            join campaigns cp on cp.id = a.campaign_id
            join workspaces w on w.id = cp.workspace_id
            left join org_status s on s.org_id = p_org and s.valor = a.status
           where w.org_id = p_org
        ) c
       where c.fim >= v_ini and c.fim < v_fim_x));

  -- ── Avaliação: média por ciclo encerrado (fase 4) ─────────────────────────
  v_aval := coalesce((
    select jsonb_agg(jsonb_build_object(
             'ciclo_id', ci.id, 'ciclo', ci.nome,
             'encerrado_em', ci.encerrado_em,
             -- Só respostas de terceiros: autoavaliação puxaria a média da casa.
             'media', (select round(avg(rp.nota)::numeric, 2) from rh_aval_resposta rp
                        where rp.ciclo_id = ci.id and rp.nota is not null and rp.relacao <> 'auto'),
             'respostas', (select count(*) from rh_aval_resposta rp
                            where rp.ciclo_id = ci.id and rp.nota is not null and rp.relacao <> 'auto'))
           order by ci.encerrado_em)
      from rh_aval_ciclo ci
     where ci.org_id = p_org and ci.status = 'encerrado'), '[]'::jsonb);

  return jsonb_build_object(
    'de', v_ini, 'ate', least(current_date, v_fim_x - 1),
    'quadro', v_quadro, 'folha', v_folha, 'ponto', v_ponto,
    'fluxo', v_fluxo, 'avaliacao', v_aval);
end $$;
revoke execute on function rh_dashboard(uuid, int, date) from public, anon;
grant  execute on function rh_dashboard(uuid, int, date) to authenticated;

notify pgrst, 'reload schema';
