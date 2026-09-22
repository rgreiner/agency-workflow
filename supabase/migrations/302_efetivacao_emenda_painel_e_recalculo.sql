-- 302: efeitos colaterais da efetivação (mig. 290) e recálculo automático (22/09/2026).
--
-- 1. Emenda: rh_ponte_abona decidia quem emendou por data_admissao. Depois da
--    efetivação da Luiza Medeiros (estágio → CLT, admissão nova em 14/09), as
--    emendas de Tiradentes (20/04) e Corpus Christi (05/06) — em que ela estava
--    na casa — passaram a cobrar 6h cada: 12h de falta inventada nos espelhos de
--    abril e junho. Mesma armadilha que a 291 fechou no rh_no_vinculo.
--    (rh_ferias_pontes continua com a admissão de propósito: a emenda desconta
--    FÉRIAS CLT, e férias CLT contam do contrato.)
-- 2. Painel de RH: tempo médio de casa, faixas, quadro mensal e entradas usavam
--    a admissão — a efetivada sumia do quadro de fev–ago e contava como
--    contratação em setembro.
-- 2b. Fechamento ao vivo: somava as horas de HOJE como extra pendente de quem já
--    tinha batido — 8 pessoas "com pendência" na tela, 4 de verdade (22/09).
-- 3. Recálculo automático. A 301 deixou o recálculo certo, mas ele só roda
--    quando alguém chama. A fila de aprovação lê o status GRAVADO; então tudo o
--    que muda a carga de dias JÁ BATIDOS precisa recalcular esses dias — senão
--    a extra fica invisível (caso Luiza Boschirolli: o aviso de 21/08 foi
--    cadastrado em 27/08). Gatilhos para: dados da ficha que mexem na carga,
--    feriado e emenda (inclusive exceções).

-- ── 1. Emenda: entrada na casa ─────────────────────────────────────────────
create or replace function rh_ponte_abona(p_colaborador uuid, p_data date)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from rh_ferias_ponte pt
      join rh_colaborador c on c.id = p_colaborador and c.org_id = pt.org_id
     where p_data between pt.inicio and pt.fim
       -- Quem entrou depois da ponte não emendou nada. Entrada na CASA, não o
       -- contrato atual: a efetivada estava aqui na emenda e não passa a dever.
       and coalesce(c.data_entrada_casa, c.data_admissao) is not null
       and coalesce(c.data_entrada_casa, c.data_admissao) <= pt.inicio
       and not exists (select 1 from rh_ferias_ponte_excecao e
                        where e.ponte_id = pt.id and e.colaborador_id = p_colaborador)
  );
$$;

-- ── 2. Painel de RH: tempo de casa ─────────────────────────────────────────
create or replace function rh_dashboard(p_org uuid, p_meses integer DEFAULT 12, p_ate date DEFAULT NULL::date)
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
         -- Tempo de CASA (mig. 302): a efetivada de estágio para CLT tem admissão
         -- nova, mas está aqui desde a entrada — quadro, faixas e entradas idem.
         round(avg(current_date - coalesce(data_entrada_casa, data_admissao)) filter (where status = 'ativo') / 30.44, 1)
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
                  and coalesce(c.data_entrada_casa, c.data_admissao) <= (m.mes + interval '1 month - 1 day')::date
                  and (c.data_demissao is null or c.data_demissao > (m.mes + interval '1 month - 1 day')::date)
             )) order by m.mes)
        from generate_series(v_ini, v_fim, interval '1 month') m(mes)), '[]'::jsonb),
    'tempo_casa_faixas', coalesce((
      select jsonb_object_agg(f.faixa, f.n) from (
        select case when current_date - coalesce(data_entrada_casa, data_admissao) < 365 then 'ate_1_ano'
                    when current_date - coalesce(data_entrada_casa, data_admissao) < 730 then 'de_1_a_2'
                    when current_date - coalesce(data_entrada_casa, data_admissao) < 1825 then 'de_2_a_5'
                    else 'mais_de_5' end as faixa, count(*) as n
          from rh_colaborador
         where org_id = p_org and not arquivado and status = 'ativo' and coalesce(data_entrada_casa, data_admissao) is not null
         group by 1) f), '{}'::jsonb),
    -- Agrega numa subquery antes do jsonb_agg: agregação dentro de agregação
    -- é erro no Postgres ("aggregate function calls cannot be nested").
    'entradas', coalesce((
      select jsonb_agg(jsonb_build_object('mes', e.mes, 'n', e.n) order by e.mes)
        from (select to_char(date_trunc('month', coalesce(data_entrada_casa, data_admissao)), 'YYYY-MM') as mes, count(*) as n
                from rh_colaborador
               where org_id = p_org and not arquivado
                 and coalesce(data_entrada_casa, data_admissao) >= v_ini and coalesce(data_entrada_casa, data_admissao) < v_fim_x
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

-- ── 2b. Fechamento: o dia de hoje não é extra pendente ─────────────────────
create or replace function rh_fechamento_linha_calc(p_colaborador_id uuid, p_ini date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  c record; j rh_jornada; d date;
  v_hn int := 0; v_h50 int := 0; v_h100 int := 0; v_falta int := 0; v_pend int := 0; v_edit timestamptz;
  v_carga int; v_trab int; v_esp boolean; v_ab boolean; v_100 boolean; v_extra int;
  v_status text; v_upd timestamptz; v_dias int := 0; v_esperados int := 0;
  v_abono int; v_aviso int; v_origem text; v_i_norm int; v_i_deb int; v_i_falt int; v_i_50 int; v_i_100 int;
  v_tol int; v_saldo int;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select co.org_id, co.id, co.nome, co.cpf, co.cargo, co.bate_ponto, co.entra_fechamento, co.data_demissao
    into c from rh_colaborador co where co.id = p_colaborador_id;
  if c.id is null then raise exception 'Colaborador não encontrado'; end if;

  -- Jornada por DIA (mig. 288): o fechamento do mês da promoção cobra 6h
  -- antes da virada e 8h depois, em vez de 8h no ciclo inteiro.
  j := rh_jornada_em(c.id, p_fim);
  v_tol := coalesce(j.tolerancia_min, 10);

  d := p_ini;
  while d <= p_fim loop
    -- Dia em curso fica fora, como no espelho (mig. 230): a jornada ainda está
    -- acontecendo. Antes as horas de HOJE entravam como "extra pendente" de
    -- todo mundo que já tinha batido o ponto — pendência que ninguém consegue
    -- aprovar e que enchia o aviso da tela de fechamento (mig. 302).
    exit when d >= v_hoje;
    j := rh_jornada_em(c.id, d);
    v_tol := coalesce(j.tolerancia_min, 10);
    v_carga := coalesce(j.carga_min, 480);
    v_esp := coalesce(c.bate_ponto, true) and rh_no_vinculo(c.id, d) and d < (now() at time zone 'America/Sao_Paulo')::date
             and (extract(isodow from d)::int = any (coalesce(j.dias_semana, array[1,2,3,4,5])));
    select f.abona, f.extra_100 into v_ab, v_100 from rh_feriado f where f.org_id = c.org_id and f.data = d;
    if found and coalesce(v_ab, true) then v_esp := false; end if;
    if not found then v_100 := false; end if;
    if v_esp and rh_ponte_abona(c.id, d) then v_esp := false; end if;
    -- Aviso prévio reduz a carga antes do abono (mig. 262).
    if v_esp then
      v_aviso := coalesce(rh_aviso_reducao_min(c.id, d, v_carga), 0);
      if v_aviso > 0 then
        v_carga := greatest(0, v_carga - v_aviso);
        if v_carga = 0 then v_esp := false; end if;
      end if;
    end if;
    v_abono := 0;
    if v_esp then
      v_abono := rh_abono_min(c.id, d, v_carga);
      if v_abono > 0 then
        v_carga := greatest(0, v_carga - v_abono);
        if v_carga = 0 then v_esp := false; end if;
      end if;
    end if;

    select p.minutos, p.extra_status, p.updated_at, p.origem,
           p.imp_normais_min, p.imp_debito_min, p.imp_faltantes_min, p.imp_he50_min, p.imp_he100_min
      into v_trab, v_status, v_upd, v_origem, v_i_norm, v_i_deb, v_i_falt, v_i_50, v_i_100
    from rh_ponto p where p.colaborador_id = c.id and p.data = d;
    if not found then v_trab := 0; v_status := null; v_upd := null; else v_dias := v_dias + 1; end if;
    v_trab := coalesce(v_trab, 0);
    if v_upd is not null and (v_edit is null or v_upd > v_edit) then v_edit := v_upd; end if;

    if v_origem = 'pontomais' then
      if v_esp then v_esperados := v_esperados + 1; end if;
      v_hn    := v_hn + coalesce(v_i_norm, 0);
      v_falta := v_falta + greatest(0, coalesce(v_i_deb, v_i_falt, 0));
      v_h50   := v_h50 + coalesce(v_i_50, 0);
      v_h100  := v_h100 + coalesce(v_i_100, 0);
    elsif v_esp then
      v_esperados := v_esperados + 1;
      v_saldo := rh_saldo_tolerado(v_trab, v_carga, v_tol);
      v_hn := v_hn + v_carga + least(0, v_saldo);
      v_extra := greatest(0, v_saldo);
      if v_extra > 0 then
        if v_status = 'aprovado' then
          if v_100 then v_h100 := v_h100 + v_extra; else v_h50 := v_h50 + v_extra; end if;
        elsif v_status = 'rejeitado' then
          null;
        else v_pend := v_pend + v_extra; end if;
      elsif v_saldo < 0 then
        v_falta := v_falta + (-v_saldo);
      end if;
    elsif v_trab > 0 then
      if not coalesce(c.bate_ponto, true) then
        v_hn := v_hn + v_trab;
      elsif v_status = 'aprovado' then
        if v_100 then v_h100 := v_h100 + v_trab; else v_h50 := v_h50 + v_trab; end if;
      elsif v_status = 'rejeitado' then
        null;
      else v_pend := v_pend + v_trab; end if;
    end if;

    d := d + 1;
  end loop;

  return jsonb_build_object(
    'colaborador_id', c.id, 'nome', c.nome, 'cpf', c.cpf, 'cargo', c.cargo,
    'hn_min', v_hn, 'he50_min', v_h50, 'he100_min', v_h100, 'faltas_min', v_falta,
    'total_min', v_hn + v_h50 + v_h100 - v_falta,
    'quitacao_min', v_h50 + v_h100 - v_falta,
    'pendente_min', v_pend, 'editado_em', v_edit,
    'dias_com_ponto', v_dias, 'dias_esperados', v_esperados,
    'entra_fechamento', coalesce(c.entra_fechamento, true), 'data_demissao', c.data_demissao);
end $$;

-- ── 3. Recálculo automático dos dias já batidos ────────────────────────────
-- Helper interno: recalcula os dias vivos (origem nula) de uma pessoa ou da
-- org inteira num intervalo. O dia importado nunca é tocado (a própria
-- rh_recalc_ponto recusa).
create or replace function rh_recalc_dias(p_org uuid, p_colaborador uuid, p_ini date, p_fim date)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare r record; v_n int := 0;
begin
  for r in
    select p.id from rh_ponto p
     where p.org_id = p_org and p.origem is null
       and (p_colaborador is null or p.colaborador_id = p_colaborador)
       and (p_ini is null or p.data >= p_ini)
       and (p_fim is null or p.data <= p_fim)
  loop
    perform rh_recalc_ponto(r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function rh_recalc_dias(uuid, uuid, date, date) from public, anon, authenticated;

-- Ficha: aviso prévio, admissão/entrada/demissão (vínculo) e bate_ponto mudam
-- a carga do dia. O WHEN é obrigatório: a ficha regrava todas as colunas a
-- cada "Salvar", e sem ele todo salvamento recalcularia a pessoa inteira.
create or replace function rh_trg_colaborador_recalc()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform rh_recalc_dias(new.org_id, new.id, null, null);
  return null;
end $$;
revoke execute on function rh_trg_colaborador_recalc() from public, anon, authenticated;

drop trigger if exists rh_colaborador_recalc_carga on rh_colaborador;
create trigger rh_colaborador_recalc_carga
after update of aviso_previo_modo, aviso_previo_ini, aviso_previo_fim,
                data_admissao, data_entrada_casa, data_demissao, bate_ponto
on rh_colaborador for each row
when (old.aviso_previo_modo is distinct from new.aviso_previo_modo
   or old.aviso_previo_ini  is distinct from new.aviso_previo_ini
   or old.aviso_previo_fim  is distinct from new.aviso_previo_fim
   or old.data_admissao     is distinct from new.data_admissao
   or old.data_entrada_casa is distinct from new.data_entrada_casa
   or old.data_demissao     is distinct from new.data_demissao
   or old.bate_ponto        is distinct from new.bate_ponto)
execute function rh_trg_colaborador_recalc();

-- Feriado cadastrado, alterado ou removido depois do dia: recalcula a org na data.
create or replace function rh_trg_feriado_recalc()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform rh_recalc_dias(old.org_id, null, old.data, old.data); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform rh_recalc_dias(new.org_id, null, new.data, new.data); end if;
  return null;
end $$;
revoke execute on function rh_trg_feriado_recalc() from public, anon, authenticated;

drop trigger if exists rh_feriado_recalc on rh_feriado;
create trigger rh_feriado_recalc after insert or update or delete on rh_feriado
for each row execute function rh_trg_feriado_recalc();

-- Emenda: o intervalo inteiro, antigo e novo.
create or replace function rh_trg_ponte_recalc()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform rh_recalc_dias(old.org_id, null, old.inicio, old.fim); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform rh_recalc_dias(new.org_id, null, new.inicio, new.fim); end if;
  return null;
end $$;
revoke execute on function rh_trg_ponte_recalc() from public, anon, authenticated;

drop trigger if exists rh_ferias_ponte_recalc on rh_ferias_ponte;
create trigger rh_ferias_ponte_recalc after insert or update or delete on rh_ferias_ponte
for each row execute function rh_trg_ponte_recalc();

-- Exceção (quem trabalhou na emenda): só a pessoa, só no intervalo da emenda.
-- Emenda apagada leva as exceções em cascata — aí o gatilho da própria emenda
-- já recalcula a org, e esta volta sem fazer nada.
create or replace function rh_trg_ponte_excecao_recalc()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_ponte uuid; v_colab uuid; pt rh_ferias_ponte;
begin
  v_ponte := case when tg_op = 'DELETE' then old.ponte_id else new.ponte_id end;
  v_colab := case when tg_op = 'DELETE' then old.colaborador_id else new.colaborador_id end;
  select * into pt from rh_ferias_ponte where id = v_ponte;
  if pt.id is not null then
    perform rh_recalc_dias(pt.org_id, v_colab, pt.inicio, pt.fim);
  end if;
  return null;
end $$;
revoke execute on function rh_trg_ponte_excecao_recalc() from public, anon, authenticated;

drop trigger if exists rh_ferias_ponte_excecao_recalc on rh_ferias_ponte_excecao;
create trigger rh_ferias_ponte_excecao_recalc after insert or update or delete on rh_ferias_ponte_excecao
for each row execute function rh_trg_ponte_excecao_recalc();

notify pgrst, 'reload schema';
