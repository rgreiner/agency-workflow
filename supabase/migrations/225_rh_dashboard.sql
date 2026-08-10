-- 225_rh_dashboard.sql
-- Módulo RH — Fase 5: dashboard analítico ("sair do achismo").
--
-- O que o dado de PRODUÇÃO permitia em 10/08/2026 (medido antes de desenhar):
--   · quadro/tempo de casa → 11 ativos, admissões desde 01/2023 · COMPLETO
--   · turnover             → 1 desligamento só · número honesto, sem tendência
--   · folha                → 1 competência (07/2026) · custo atual sim,
--                            EVOLUÇÃO impossível; a tela pede mais importação
--   · ponto                → 6 meses · ok, marcando o que veio do Pontomais
--   · retrabalho/prazo     → 1821 transições · por ETAPA
--   · avaliação            → zero · nasce vazio até o 1º ciclo encerrar
--
-- ⚠️ Retrabalho é medido por ETAPA, nunca por pessoa: `activity_history.changed_by`
-- é quem DEVOLVEU a tarefa (o revisor), não quem errou. Ranquear pessoa com esse
-- dado seria acusar o revisor — e brigar com dado ambíguo. A pergunta que o dado
-- responde de verdade é "onde o fluxo trava", não "quem é o culpado".
--
-- ⚠️ Mês do Pontomais tem régua PRÓPRIA (mig. 206) — as horas dele vêm de imp_*
-- e não são comparáveis dia a dia com o cálculo do Flow. O retorno marca
-- `importado` para a tela poder avisar em vez de somar alhos com bugalhos.
--
-- Idempotente.

create or replace function rh_dashboard(p_org uuid, p_meses int default 12)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_ini date; v_fim date; v_meses int; v_ativos int;
  v_quadro jsonb; v_folha jsonb; v_ponto jsonb; v_fluxo jsonb; v_aval jsonb;
  v_comp_folha date; v_qtd_comp int; v_desl int; v_med numeric;
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  v_meses := greatest(1, least(coalesce(p_meses, 12), 36));
  v_fim   := date_trunc('month', current_date)::date;
  v_ini   := (v_fim - make_interval(months => v_meses - 1))::date;

  -- ── Quadro: headcount mês a mês, tempo de casa, entradas e saídas ─────────
  select count(*) filter (where status = 'ativo'),
         round(avg(current_date - data_admissao) filter (where status = 'ativo') / 30.44, 1)
    into v_ativos, v_med
    from rh_colaborador where org_id = p_org and not arquivado;

  select count(*) into v_desl from rh_colaborador
   where org_id = p_org and data_demissao between v_ini and current_date;

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
                 and data_admissao between v_ini and current_date
               group by 1) e), '[]'::jsonb),
    'saidas', coalesce((
      select jsonb_agg(jsonb_build_object('mes', s.mes, 'n', s.n) order by s.mes)
        from (select to_char(date_trunc('month', data_demissao), 'YYYY-MM') as mes, count(*) as n
                from rh_colaborador
               where org_id = p_org and data_demissao between v_ini and current_date
               group by 1) s), '[]'::jsonb),
    'desligamentos_periodo', v_desl,
    -- Turnover = saídas ÷ quadro. Com pouca saída o número oscila muito; a tela
    -- mostra a contagem junto para não fingir precisão que não existe.
    'turnover_pct', case when v_ativos > 0 then round(v_desl::numeric * 100 / v_ativos, 1) else null end);

  -- ── Folha: custo da última competência importada ──────────────────────────
  select count(distinct competencia), max(competencia) into v_qtd_comp, v_comp_folha
    from rh_folha where org_id = p_org;

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
                from rh_folha where org_id = p_org group by competencia) f), '[]'::jsonb),
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
       where p.org_id = p_org and p.data >= v_ini
       group by date_trunc('month', p.data)
    ) x), '[]'::jsonb);

  -- ── Fluxo: onde o trabalho VOLTA e o cumprimento de prazo ─────────────────
  v_fluxo := jsonb_build_object(
    -- Volta de etapa = destino com ordem MENOR que a origem no cadastro de status.
    -- activities não tem org_id: a org vem por campaign → workspace.
    'retrabalho', coalesce((
      select jsonb_agg(jsonb_build_object(
               'de', sa.label, 'para', sb.label, 'n', h.n) order by h.n desc)
        from (
          select ah.from_status, ah.to_status, count(*) as n
            from activity_history ah
            join activities a on a.id = ah.activity_id
            join campaigns cp on cp.id = a.campaign_id
            join workspaces w on w.id = cp.workspace_id
           where w.org_id = p_org and ah.from_status is not null
             and ah.changed_at >= v_ini
           group by 1, 2
        ) h
        join org_status sa on sa.org_id = p_org and sa.valor = h.from_status
        join org_status sb on sb.org_id = p_org and sb.valor = h.to_status
       where sb.ordem < sa.ordem), '[]'::jsonb),
    -- Prazo: a data de conclusão vem do HISTÓRICO (quando entrou no status
    -- concluído), não de `updated_at`. Medido em produção, `updated_at` acusava
    -- 41 atrasadas contra 30 reais — 27% de inflação, porque qualquer edição
    -- posterior à entrega empurrava a data para frente. `updated_at` fica só de
    -- reserva para atividade anterior ao histórico (que começa em 06/2026).
    'prazo', (
      select jsonb_build_object(
        'concluidas', count(*),
        'no_prazo',  count(*) filter (where c.due_date is null or c.fim <= c.due_date),
        'atrasadas', count(*) filter (where c.due_date is not null and c.fim > c.due_date))
        from (
          select a.due_date,
                 coalesce((select max(h.changed_at)::date from activity_history h
                            where h.activity_id = a.id and h.to_status = a.status),
                          a.updated_at::date) as fim
            from activities a
            join campaigns cp on cp.id = a.campaign_id
            join workspaces w on w.id = cp.workspace_id
            join org_status s on s.org_id = p_org and s.valor = a.status and s.grupo = 'done'
           where w.org_id = p_org and not coalesce(a.archived, false)
        ) c));

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
    'de', v_ini, 'ate', current_date,
    'quadro', v_quadro, 'folha', v_folha, 'ponto', v_ponto,
    'fluxo', v_fluxo, 'avaliacao', v_aval);
end $$;
revoke execute on function rh_dashboard(uuid, int) from public, anon;
grant  execute on function rh_dashboard(uuid, int) to authenticated;

notify pgrst, 'reload schema';
