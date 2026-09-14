-- 297: o resto do sistema para de sortear jornada.
--
-- A 288 deu vigência à jornada e a 289 arrumou as funções de cálculo, mas seis
-- outras continuavam pegando "uma linha qualquer" com `limit 1` sem ordenar.
-- Com duas vigências isso é loteria — e o prêmio errado é a jornada de estágio:
--   · tela do ponto e lembrete mostrariam 10:00–17:30 para quem agora faz 8h;
--   · o gate do dia usaria os dias de semana da jornada velha;
--   · custo/hora e camadas dividiriam o custo por uma capacidade de 6h.
-- Regeneradas a partir da definição VIVA, trocando só a leitura da jornada.

create or replace function horas_custo_hora(p_org uuid)
returns table(user_id uuid, comp date, custo_hora numeric) language plpgsql stable security definer set search_path to 'public' as $$
declare v_over numeric;
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select total_mes into v_over from horas_overhead_mes(p_org);

  return query
  with jornada as (
    select c.id as colaborador_id,
           -- A jornada tem vigência (mig. 288): "limit 1" sorteava entre a atual
           -- e a antiga. O custo/hora é o de HOJE, então é a de hoje que vale.
           coalesce((rh_jornada_de(c.id)).carga_min, 480) as carga_min,
           coalesce((rh_jornada_de(c.id)).dias_semana, '{1,2,3,4,5}'::int[]) as dias_semana
    from rh_colaborador c where c.org_id = p_org
  ),
  comps as (
    select generate_series(
      least(
        coalesce((select min(date_trunc('month', f.competencia))::date from rh_folha f where f.org_id = p_org),
                 date_trunc('month', current_date)::date),
        coalesce((select min(date_trunc('month', af.aberta_em))::date from activity_focus af where af.org_id = p_org),
                 date_trunc('month', current_date)::date)
      ),
      date_trunc('month', current_date)::date,
      interval '1 month')::date as fcomp
  ),
  folha as (
    select c.id as colaborador_id, c.membro_user_id as u, c.beneficios_mensal,
           c.custo_projetado_mensal as proj, coalesce(c.custo_overhead, false) as oh,
           date_trunc('month', f.competencia)::date as fcomp,
           bool_or(f.categoria like '101%') as clt,
           sum(coalesce(f.vencimentos, 0)) as bruto,
           sum(coalesce(f.fgts, 0)) as fgts,
           sum(coalesce(f.inss, 0)) as inss_retido,
           'folha'::text as origem
    from rh_folha f
    join rh_colaborador c on c.id = f.colaborador_id and c.membro_user_id is not null
    where f.org_id = p_org
    group by c.id, c.membro_user_id, c.beneficios_mensal, c.custo_projetado_mensal, c.custo_overhead, 6
  ),
  ficha as (
    select c.id, c.membro_user_id, c.beneficios_mensal,
           c.custo_projetado_mensal, coalesce(c.custo_overhead, false),
           x.fcomp,
           (c.tipo_vinculo = 'clt') as clt,
           coalesce(c.salario_atual, 0) as bruto,
           case when c.tipo_vinculo = 'clt' then round(coalesce(c.salario_atual, 0) * 0.08, 2) else 0 end as fgts,
           0::numeric as inss_retido,
           'ficha'::text as origem
    from rh_colaborador c
    cross join comps x
    where c.org_id = p_org and c.membro_user_id is not null
      and coalesce(c.arquivado, false) = false and c.status = 'ativo'
      and coalesce(c.salario_atual, 0) + coalesce(c.beneficios_mensal, 0) + coalesce(c.custo_projetado_mensal, 0) > 0
      and (c.data_admissao is null or x.fcomp >= date_trunc('month', c.data_admissao)::date)
      and not exists (select 1 from rh_folha f
                      where f.org_id = p_org and f.colaborador_id = c.id
                        and date_trunc('month', f.competencia)::date = x.fcomp)
  ),
  pessoas as (
    select * from folha union all select * from ficha
  ),
  -- MATERIALIZED de propósito: referenciada via join, tem que rodar UMA vez —
  -- inline aqui já custou 7,9s (horas_sessoes por linha).
  sess as materialized (
    select s.user_id as su, date_trunc('month', s.dia)::date as sm, round(sum(s.minutos) / 60.0, 1) as ht
    from (select min(fcomp) as ini from comps) w,
         lateral horas_sessoes(p_org, w.ini, current_date) s
    group by s.user_id, 2
  ),
  uteis as (
    select fo.*, j.carga_min, j.dias_semana,
           (( select count(*)
              from generate_series(fo.fcomp::timestamp, (fo.fcomp + interval '1 month - 1 day')::timestamp, interval '1 day') d
              where extract(isodow from d)::int = any (j.dias_semana)
                and not exists (select 1 from rh_feriado fe where fe.org_id = p_org and fe.data = d::date and fe.abona)
            ) * j.carga_min) / 60.0 as hu,
           coalesce(se.ht, 0) as ht
    from pessoas fo
    join jornada j on j.colaborador_id = fo.colaborador_id
    left join sess se on se.su = fo.u and se.sm = fo.fcomp
  ),
  base as (
    select u.*,
           case when u.ht > 0 then u.ht else u.hu end as hbase,
           case when u.proj is not null then u.proj
                else u.bruto + u.fgts + case when u.clt then round(u.bruto * 0.22, 2) else 0 end end
             + coalesce(u.beneficios_mensal, 0) as custo_mes_sem_guia
    from uteis u
  ),
  tot as (
    select fcomp,
           coalesce(nullif(sum(hbase) filter (where not oh), 0), 1) as hbase_total,
           coalesce(nullif(sum(bruto) filter (where origem = 'folha' and proj is null), 0), 1) as bruto_total_folha,
           sum(inss_retido) as retido_total,
           coalesce(sum(custo_mes_sem_guia) filter (where oh), 0) as pool_pessoas
    from base group by 1
  ),
  guia as (
    select t.fcomp,
           greatest(0, coalesce((
             select sum(l.valor) from lancamentos l
             where l.org_id = p_org and l.origem_tipo = 'folha'
               and l.origem_ref = 'folha:' || t.fcomp || ':inss'
           ), 0) - t.retido_total) as custo_inss
    from tot t
  )
  select b.u, b.fcomp,
         case when not b.oh and b.hbase > 0 then
           round((b.custo_mes_sem_guia
              + case when b.origem = 'folha' and b.proj is null
                     then g.custo_inss * b.bruto / t.bruto_total_folha else 0 end) / b.hbase
              + (coalesce(v_over, 0) + t.pool_pessoas) / t.hbase_total, 2) end
  from base b
  join tot t on t.fcomp = b.fcomp
  join guia g on g.fcomp = b.fcomp;
end $$;

create or replace function horas_custo_camadas(p_org uuid)
returns table(user_id uuid, nome text, comp date, clt boolean, fonte text, overhead boolean, bruto numeric, fgts numeric, encargos numeric, provisoes numeric, beneficios numeric, custo_mes numeric, horas_uteis numeric, horas_tarefas numeric, horas_base numeric, custo_direto_h numeric, overhead_h numeric, custo_hora numeric) language plpgsql stable security definer set search_path to 'public' as $$
declare v_over numeric; v_comp date;
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  select max(competencia) into v_comp from rh_folha where org_id = p_org;
  if v_comp is null then return; end if;
  select total_mes into v_over from horas_overhead_mes(p_org);

  return query
  with folha as (
    select c.id as colaborador_id, c.membro_user_id as uid, c.nome as cnome,
           c.beneficios_mensal as benef, c.custo_projetado_mensal as proj,
           coalesce(c.custo_overhead, false) as oh,
           bool_or(f.categoria like '101%') as eh_clt,
           sum(coalesce(f.vencimentos, 0)) as fbruto,
           sum(coalesce(f.fgts, 0)) as ffgts,
           sum(coalesce(f.inss, 0)) as retido,
           'folha'::text as origem
    from rh_folha f
    join rh_colaborador c on c.id = f.colaborador_id and c.membro_user_id is not null
    where f.org_id = p_org and f.competencia = v_comp
    group by c.id, c.membro_user_id, c.nome, c.beneficios_mensal, c.custo_projetado_mensal, c.custo_overhead
  ),
  ficha as (
    -- Ativo com login, fora da folha da competência: estagiário/terceiro fixo.
    select c.id, c.membro_user_id, c.nome, c.beneficios_mensal, c.custo_projetado_mensal,
           coalesce(c.custo_overhead, false),
           false, coalesce(c.salario_atual, 0), 0::numeric, 0::numeric, 'ficha'::text
    from rh_colaborador c
    where c.org_id = p_org and c.membro_user_id is not null
      and coalesce(c.arquivado, false) = false and c.status = 'ativo'
      and coalesce(c.salario_atual, 0) + coalesce(c.beneficios_mensal, 0) + coalesce(c.custo_projetado_mensal, 0) > 0
      and not exists (select 1 from rh_folha f
                      where f.org_id = p_org and f.competencia = v_comp and f.colaborador_id = c.id)
  ),
  pessoas as (
    select * from folha union all select * from ficha
  ),
  tarefas as (
    select t.user_id as tuid, t.horas_mes from horas_tarefas_mes(p_org) t
  ),
  uteis as (
    select fo.*,
           (( select count(*)
              from generate_series(v_comp::timestamp, (v_comp + interval '1 month - 1 day')::timestamp, interval '1 day') d
              -- Jornada da COMPETÊNCIA, não a de hoje: o mês em que a pessoa
              -- ainda fazia 6h não pode ser medido pela jornada de 8h (mig. 288).
              where extract(isodow from d)::int = any (coalesce(
                  (rh_jornada_em(fo.colaborador_id, (v_comp + interval '1 month - 1 day')::date)).dias_semana,
                  '{1,2,3,4,5}'::int[]))
                and not exists (select 1 from rh_feriado fe where fe.org_id = p_org and fe.data = d::date and fe.abona)
            ) * coalesce(
                  (rh_jornada_em(fo.colaborador_id, (v_comp + interval '1 month - 1 day')::date)).carga_min,
                  480)) / 60.0 as hu,
           coalesce(ta.horas_mes, 0) as ht
    from pessoas fo
    left join tarefas ta on ta.tuid = fo.uid
  ),
  tot as (
    -- Guia INSS: rateia só entre bruto de FOLHA não-projetado (o projetado já é custo total).
    select u.*,
           coalesce(nullif(sum(u.fbruto) filter (where u.origem = 'folha' and u.proj is null) over (), 0), 1) as bruto_total_folha,
           sum(u.retido) over () as retido_total
    from uteis u
  ),
  guia as (
    select t.*, greatest(0, coalesce((
      select sum(l.valor) from lancamentos l
      where l.org_id = p_org and l.origem_tipo = 'folha'
        and l.origem_ref = 'folha:' || v_comp || ':inss'
    ), 0) - t.retido_total) as custo_inss
    from tot t
  ),
  camadas as (
    select g.uid, g.cnome, g.eh_clt, g.oh,
           case when g.proj is not null then 'projetado' else g.origem end as cfonte,
           -- Camadas 1–3: o projetado substitui tudo (é o custo total da pessoa).
           case when g.proj is not null then g.proj else g.fbruto end as cbruto,
           case when g.proj is not null then 0 else g.ffgts end as cfgts,
           case when g.proj is not null or g.origem <> 'folha' then 0
                else round(g.custo_inss * g.fbruto / g.bruto_total_folha, 2) end as cencargos,
           case when g.proj is null and g.eh_clt then round(g.fbruto * 0.22, 2) else 0 end as cprovisoes,
           round(coalesce(g.benef, 0), 2) as cbenef,
           g.hu, g.ht,
           -- Denominador: hora vendável; sem medição vale a jornada útil.
           case when g.ht > 0 then g.ht else g.hu end as hbase
    from guia g
  ),
  pool as (
    -- Overhead total = estrutura + provisão de lucro + pessoas-overhead;
    -- denominador = horas-base de quem PRODUZ.
    select coalesce(v_over, 0)
         + coalesce(sum(c.cbruto + c.cfgts + c.cencargos + c.cprovisoes + c.cbenef) filter (where c.oh), 0) as total,
           coalesce(nullif(sum(c.hbase) filter (where not c.oh), 0), 1) as hbase_total
    from camadas c
  )
  select c.uid, c.cnome, v_comp, c.eh_clt, c.cfonte, c.oh,
         round(c.cbruto, 2), round(c.cfgts, 2), c.cencargos, c.cprovisoes, c.cbenef,
         round(c.cbruto + c.cfgts + c.cencargos + c.cprovisoes + c.cbenef, 2) as custo_mes,
         round(c.hu, 1), round(c.ht, 1), round(c.hbase, 1),
         case when not c.oh and c.hbase > 0
              then round((c.cbruto + c.cfgts + c.cencargos + c.cprovisoes + c.cbenef) / c.hbase, 2) end,
         case when not c.oh then round(p.total / p.hbase_total, 2) end,
         case when not c.oh and c.hbase > 0
              then round((c.cbruto + c.cfgts + c.cencargos + c.cprovisoes + c.cbenef) / c.hbase
                         + p.total / p.hbase_total, 2) end
  from camadas c, pool p
  order by c.cnome;
end $$;

create or replace function rh_ponto_estado()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid; v_colab uuid; v_org uuid; v_hoje date;
  v_marc text[]; v_j record; v_foco timestamptz;
begin
  v_uid := auth.uid();
  if v_uid is null then return null; end if;

  select id, org_id into v_colab, v_org
  from rh_colaborador
  where membro_user_id = v_uid and status = 'ativo'
  limit 1;
  if v_colab is null then return null; end if;  -- sem ficha vinculada → sem lembrete

  v_hoje := (now() at time zone 'America/Sao_Paulo')::date;

  select coalesce(array_agg(to_char(m.hora, 'HH24:MI') order by m.seq), '{}')
    into v_marc
  from rh_ponto p
  join rh_marcacao m on m.ponto_id = p.id
  where p.colaborador_id = v_colab and p.data = v_hoje;

  -- Jornada em vigor HOJE (mig. 288) — antes, "limit 1" podia devolver a
  -- vigência antiga e a tela mostrava o horário de estagiária para uma CLT.
  select entrada, intervalo_ini, intervalo_fim, saida, flex_min into v_j
  from rh_jornada_de(v_colab);

  -- primeiro sinal de trabalho de hoje (abertura de tarefa)
  select min(aberta_em) into v_foco
  from activity_focus
  where user_id = v_uid
    and aberta_em >= (v_hoje::timestamp at time zone 'America/Sao_Paulo');

  return jsonb_build_object(
    'colaborador_id', v_colab,
    'dia', v_hoje,
    'marcacoes', to_jsonb(v_marc),
    'jornada', jsonb_build_object(
      'entrada',       to_char(coalesce(v_j.entrada,       time '08:30'), 'HH24:MI'),
      'intervalo_ini', to_char(coalesce(v_j.intervalo_ini, time '12:00'), 'HH24:MI'),
      'intervalo_fim', to_char(coalesce(v_j.intervalo_fim, time '13:30'), 'HH24:MI'),
      'saida',         to_char(coalesce(v_j.saida,         time '18:00'), 'HH24:MI'),
      'flex_min',      coalesce(v_j.flex_min, 30)),
    'primeiro_foco', to_char(v_foco at time zone 'America/Sao_Paulo', 'HH24:MI'),
    'agora', to_char(now() at time zone 'America/Sao_Paulo', 'HH24:MI'),
    -- Dias PASSADOS com marcação ímpar: alguém esqueceu de bater a saída e o
    -- dia não fecha nenhum par — o recálculo credita ZERO minuto (mig. 275).
    -- Hoje nunca entra: ímpar agora só quer dizer "está trabalhando".
    'dias_incompletos', coalesce((
      select jsonb_agg(jsonb_build_object('data', d.data, 'marcacoes', d.n) order by d.data desc)
        from (
          select p.data, count(m.id) as n
            from rh_ponto p
            join rh_marcacao m on m.ponto_id = p.id
           where p.colaborador_id = v_colab
             and p.data < v_hoje
             and p.data >= v_hoje - 30
             -- Dia importado do Pontomais é congelado (mig. 206): a apuração
             -- deles já creditou as horas, não há o que ajustar aqui.
             and p.origem is null
           group by p.data
          having count(m.id) % 2 = 1
        ) d), '[]'::jsonb));
end $$;

create or replace function rh_ponto_gate()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid; v_colab uuid; v_org uuid; v_hoje date; v_agora time;
  v_obrig boolean; v_dias int[]; v_n int; v_abona boolean; v_bate boolean;
  v_ult time; v_decorrido int; v_teve_almoco boolean; v_falta int;
begin
  v_uid := auth.uid();
  if v_uid is null then return jsonb_build_object('exige', false); end if;

  select id, org_id, bate_ponto into v_colab, v_org, v_bate
    from rh_colaborador
   where membro_user_id = v_uid and status = 'ativo' and coalesce(arquivado, false) = false
   limit 1;
  if v_colab is null then return jsonb_build_object('exige', false); end if;
  if not coalesce(v_bate, true) then
    return jsonb_build_object('exige', false, 'colaborador_id', v_colab);
  end if;

  select coalesce(ponto_obrigatorio, false) into v_obrig from org_settings where org_id = v_org;
  if not coalesce(v_obrig, false) then
    return jsonb_build_object('exige', false, 'colaborador_id', v_colab);
  end if;

  v_hoje  := (now() at time zone 'America/Sao_Paulo')::date;
  v_agora := (now() at time zone 'America/Sao_Paulo')::time;

  select coalesce((rh_jornada_de(v_colab)).dias_semana, array[1,2,3,4,5]) into v_dias;
  if not (extract(isodow from v_hoje)::int = any (v_dias)) then
    return jsonb_build_object('exige', false, 'colaborador_id', v_colab);
  end if;

  select abona into v_abona from rh_feriado where org_id = v_org and data = v_hoje;
  if found and coalesce(v_abona, true) then
    return jsonb_build_object('exige', false, 'colaborador_id', v_colab);
  end if;
  if rh_ponte_abona(v_colab, v_hoje) then
    return jsonb_build_object('exige', false, 'colaborador_id', v_colab);
  end if;

  -- Estado do dia, lido da fonte real das batidas (nunca da coluna `entrada`,
  -- que é resumo e só existe com par fechado — foi o bug da 216).
  select count(*), max(m.hora) into v_n, v_ult
    from rh_marcacao m
    join rh_ponto p on p.id = m.ponto_id
   where p.colaborador_id = v_colab and p.data = v_hoje;

  -- Ímpar = dentro. Nada a pedir.
  if v_n > 0 and v_n % 2 = 1 then
    return jsonb_build_object('exige', false, 'colaborador_id', v_colab, 'estado', 'dentro');
  end if;

  -- Nenhuma marcação: o dia nem começou.
  if v_n = 0 then
    return jsonb_build_object('exige', true, 'colaborador_id', v_colab, 'estado', 'sem_ponto');
  end if;

  -- Fora. Se o almoço do dia ainda não aconteceu e este intervalo não fechou
  -- 1h, avisa em vez de barrar.
  select exists (
    select 1 from (
      select m.hora, m.seq,
             lead(m.hora) over (order by m.seq) as prox,
             row_number() over (order by m.seq) as rn
        from rh_marcacao m
        join rh_ponto p on p.id = m.ponto_id
       where p.colaborador_id = v_colab and p.data = v_hoje
    ) x
     where x.rn % 2 = 0 and x.prox is not null
       and rh_min_do_dia(x.prox) - rh_min_do_dia(x.hora) >= 60
  ) into v_teve_almoco;

  v_decorrido := greatest(0, rh_min_do_dia(v_agora) - rh_min_do_dia(v_ult));

  if not v_teve_almoco and v_decorrido < 60 then
    v_falta := 60 - v_decorrido;
    return jsonb_build_object(
      'exige', false, 'colaborador_id', v_colab, 'estado', 'intervalo',
      'intervalo_min', v_decorrido, 'falta_para_1h', v_falta);
  end if;

  return jsonb_build_object('exige', true, 'colaborador_id', v_colab, 'estado', 'fora',
                            'intervalo_min', v_decorrido);
end $$;

create or replace function rh_ponto_recentes(p_colaborador uuid, p_limite integer DEFAULT 15)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_out jsonb := '[]'::jsonb; r record; v_esp int; v_saldo int; j rh_jornada; v_tol int;
begin
  if not (rh_is_self(p_colaborador) or rh_can((select org_id from rh_colaborador where id = p_colaborador))) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;


  for r in
    select p.*, (select coalesce(jsonb_agg(to_char(m.hora, 'HH24:MI') order by m.seq), '[]'::jsonb)
                   from rh_marcacao m where m.ponto_id = p.id) as marcacoes
      from rh_ponto p
     where p.colaborador_id = p_colaborador
     order by p.data desc
     limit greatest(1, coalesce(p_limite, 15))
  loop
    -- Tolerância do DIA, como no espelho: as duas telas contam igual.
    j := rh_jornada_em(p_colaborador, r.data);
    v_tol := coalesce(j.tolerancia_min, 10);
    v_esp := rh_esperado_min(p_colaborador, r.data);
    if r.data >= (now() at time zone 'America/Sao_Paulo')::date then
      -- Dia em curso não tem saldo: a jornada ainda está acontecendo, e abrir
      -- a manhã com -8:00 fez todo mundo achar que já devia (Rafael, 11/08).
      -- `esperado_min` continua indo para a tela mostrar PROGRESSO ("3h30 de 8h").
      v_saldo := 0;
    elsif r.origem = 'pontomais' then
      v_saldo := coalesce(r.saldo_min, 0);
    elsif v_esp > 0 then
      -- Mesma tolerância do espelho: as duas telas contam o dia igual.
      v_saldo := rh_saldo_tolerado(coalesce(r.minutos, 0), v_esp, v_tol);
    else
      v_saldo := coalesce(r.saldo_min, 0);
    end if;

    v_out := v_out || jsonb_build_object(
      'data', r.data, 'entrada', r.entrada, 'intervalo_ini', r.intervalo_ini,
      'intervalo_fim', r.intervalo_fim, 'saida', r.saida,
      'minutos', coalesce(r.minutos, 0), 'saldo_min', v_saldo, 'esperado_min', v_esp,
      'tolerado_min', case when r.origem is null and v_esp > 0 and v_saldo = 0
                          then coalesce(r.minutos, 0) - v_esp else 0 end,
      'acima_10h', coalesce(r.acima_10h, false), 'extra_status', r.extra_status,
      'ajuste_de', r.ajuste_de, 'ajuste_em', r.ajuste_em,
      'intervalo_maior_min', r.intervalo_maior_min, 'intervalo_ok', r.intervalo_ok,
      'marcacoes', r.marcacoes);
  end loop;
  return v_out;
end $$;

create or replace function rh_push_lembrete_entrada()
returns table(user_id uuid, entrada text, org_slug text) language plpgsql security definer set search_path to 'public' as $$
declare
  v_hoje date; v_agora time;
begin
  if not is_cron() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  v_hoje  := (now() at time zone 'America/Sao_Paulo')::date;
  v_agora := (now() at time zone 'America/Sao_Paulo')::time;
  if extract(isodow from v_hoje) >= 6 then return; end if;  -- fim de semana não cobra

  return query
  with alvo as (
    select c.id as colab, c.membro_user_id as uid, c.org_id,
           coalesce(j.entrada, time '08:30') as hora_entrada
    from rh_colaborador c
    left join lateral (select (rh_jornada_de(c.id)).entrada) j(entrada) on true
    where c.status = 'ativo' and c.membro_user_id is not null
  ),
  pend as (
    select a.colab, a.uid, a.org_id, a.hora_entrada
    from alvo a
    -- janela: 10 min antes até 40 min depois da entrada — passou disso, cobrar
    -- de manhã inteira vira ruído (e o PontoPrompt/Gate cobrem quem abrir o app)
    where v_agora >= a.hora_entrada - interval '10 minutes'
      and v_agora <= a.hora_entrada + interval '40 minutes'
      -- só cobra quem PODE receber (tem aparelho inscrito)
      and exists (select 1 from push_subscriptions ps where ps.user_id = a.uid)
      -- já bateu hoje → nada a cobrar
      and not exists (
        select 1 from rh_ponto p join rh_marcacao m on m.ponto_id = p.id
        where p.colaborador_id = a.colab and p.data = v_hoje)
      -- feriado que abona não espera ponto
      and not exists (
        select 1 from rh_feriado f
        where f.org_id = a.org_id and f.data = v_hoje and f.abona)
      -- férias/atestado/falta registrada (qualquer justificativa não-rejeitada)
      and not exists (
        select 1 from rh_justificativa jx
        where jx.colaborador_id = a.colab and jx.status <> 'rejeitado'
          and jx.data_ini <= v_hoje and jx.data_fim >= v_hoje)
      -- 1 lembrete por dia
      and not exists (
        select 1 from push_lembrete_log l
        where l.colaborador_id = a.colab and l.dia = v_hoje and l.tipo = 'entrada')
  ),
  ins as (
    insert into push_lembrete_log (colaborador_id, dia, tipo)
    select pend.colab, v_hoje, 'entrada' from pend
    on conflict do nothing
    returning colaborador_id
  )
  select pend.uid, to_char(pend.hora_entrada, 'HH24:MI'), o.slug
  from pend
  join ins on ins.colaborador_id = pend.colab
  join organizations o on o.id = pend.org_id;
end $$;

notify pgrst, 'reload schema';
