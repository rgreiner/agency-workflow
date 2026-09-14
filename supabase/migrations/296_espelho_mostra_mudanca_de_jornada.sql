-- 296: o espelho conta quando a jornada mudou no meio do período.
--
-- Desde a 288 cada dia já é calculado pela jornada que valia nele, mas o
-- cabeçalho do espelho mostra só a do último dia. No ciclo da efetivação
-- (26/08–25/09, 6h até o dia 13 e 8h a partir do 14) isso faz o documento
-- dizer "8h/dia" sobre um mês em que metade era 6h — e é este documento que a
-- pessoa assina. Agora ele leva junto as vigências do período.

create or replace function rh_espelho(p_org_id uuid, p_colaborador_id uuid, p_competencia date, p_ini date DEFAULT NULL::date, p_fim date DEFAULT NULL::date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_ini date; v_fim date; v_dias jsonb := '[]'::jsonb; d date;
  c record; j rh_jornada; p rh_ponto; v_marc jsonb; v_fer record; v_just record;
  v_saldo_dia int; v_abono int; v_aviso int; v_tol int; v_absorvido int;
  v_log jsonb; v_por text; v_esp boolean; v_carga int;
  v_hn int := 0; v_falta int := 0; v_ex int := 0;
  v_vigencias jsonb;
begin
  if not (rh_can(p_org_id) or rh_is_self(p_colaborador_id)) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select ini, fim into v_ini, v_fim from rh_periodo_fechamento(p_org_id, p_competencia);
  v_ini := coalesce(p_ini, v_ini);
  v_fim := coalesce(p_fim, v_fim);
  select id, nome, cargo, cpf, bate_ponto into c from rh_colaborador where id = p_colaborador_id and org_id = p_org_id;
  if c.id is null then raise exception 'Colaborador não encontrado'; end if;
  -- A jornada agora é lida DENTRO do loop: no ciclo em que a pessoa mudou de
  -- jornada (estágio 6h → CLT 8h), cada dia usa a que valia nele (mig. 288).
  j := rh_jornada_em(p_colaborador_id, v_fim);
  v_tol := coalesce(j.tolerancia_min, 10);

  d := v_ini;
  while d <= v_fim loop
    j := rh_jornada_em(p_colaborador_id, d);
    v_tol := coalesce(j.tolerancia_min, 10);
    select * into p from rh_ponto where colaborador_id = p_colaborador_id and data = d;

    select coalesce(jsonb_agg(to_char(hora, 'HH24:MI') order by seq), '[]'::jsonb)
      into v_marc from rh_marcacao where ponto_id = p.id;

    select nome, tipo, abona, carga_min into v_fer from rh_feriado where org_id = p_org_id and data = d;

    select x.tipo, x.descricao, x.status, x.decidido_em,
           (select pr.full_name from profiles pr where pr.id = x.decidido_por) as decidido_por_nome,
           x.doc_id, x.ausencia_ini, x.ausencia_fim
      into v_just
      from rh_justificativa x
     where x.colaborador_id = p_colaborador_id and d between x.data_ini and x.data_fim
     order by x.created_at desc limit 1;

    select coalesce(jsonb_agg(jsonb_build_object(
             'acao', l.acao, 'antes', l.antes, 'depois', l.depois, 'motivo', l.motivo, 'em', l.em,
             'por', (select pr.full_name from profiles pr where pr.id = l.por)) order by l.em desc), '[]'::jsonb)
      into v_log from rh_ponto_log l where l.ponto_id = p.id;

    select pr.full_name into v_por from profiles pr where pr.id = p.ajuste_por;

    v_esp := coalesce(c.bate_ponto, true) and rh_no_vinculo(c.id, d) and d < (now() at time zone 'America/Sao_Paulo')::date
             and (extract(isodow from d)::int = any (coalesce(j.dias_semana, array[1,2,3,4,5])));
    v_carga := coalesce(j.carga_min, 480);
    if v_fer.nome is not null or v_fer.tipo is not null then
      v_carga := coalesce(v_fer.carga_min, case when coalesce(v_fer.abona, true) then 0 else v_carga end);
      if v_carga = 0 then v_esp := false; end if;
    end if;
    if v_esp and rh_ponte_abona(p_colaborador_id, d) then
      v_carga := 0; v_esp := false;
    end if;

    -- Aviso prévio reduz a carga antes do abono (mig. 262).
    v_aviso := 0;
    if v_esp then
      v_aviso := coalesce(rh_aviso_reducao_min(p_colaborador_id, d, v_carga), 0);
      if v_aviso > 0 then
        v_carga := greatest(0, v_carga - v_aviso);
        if v_carga = 0 then v_esp := false; end if;
      end if;
    end if;

    v_abono := 0;
    if v_esp then
      v_abono := rh_abono_min(p_colaborador_id, d, v_carga);
      if v_abono > 0 then
        v_carga := greatest(0, v_carga - v_abono);
        if v_carga = 0 then v_esp := false; end if;
      end if;
    end if;

    if p.origem = 'pontomais' then
      v_saldo_dia := coalesce(p.saldo_min, 0);
    elsif v_esp then
      v_saldo_dia := rh_saldo_tolerado(coalesce(p.minutos, 0), v_carga, v_tol);
    else
      v_saldo_dia := coalesce(p.saldo_min, 0);
    end if;

    v_absorvido := case when v_esp and p.origem is null and v_saldo_dia = 0
                        then coalesce(p.minutos, 0) - v_carga else 0 end;

    if p.origem = 'pontomais' then
      v_hn    := v_hn + coalesce(p.imp_normais_min, 0);
      v_falta := v_falta + greatest(0, coalesce(p.imp_debito_min, p.imp_faltantes_min, 0));
      v_ex    := v_ex + coalesce(p.imp_he50_min, 0) + coalesce(p.imp_he100_min, 0);
    elsif v_esp then
      v_hn    := v_hn + v_carga + least(0, v_saldo_dia);
      v_falta := v_falta + greatest(0, -v_saldo_dia);
      if p.extra_status is distinct from 'rejeitado' then
        v_ex := v_ex + greatest(0, v_saldo_dia);
      end if;
    elsif not coalesce(c.bate_ponto, true) then
      v_hn := v_hn + coalesce(p.minutos, 0);
    else
      if p.extra_status is distinct from 'rejeitado' then
        v_ex := v_ex + coalesce(p.minutos, 0);
      end if;
    end if;

    v_dias := v_dias || jsonb_build_object(
      'data', d, 'dow', extract(isodow from d)::int,
      'esperado_min', case when v_esp then v_carga else 0 end, 'abono_min', v_abono,
      'aviso_min', v_aviso,
      'marcacoes', v_marc,
      'minutos', coalesce(p.minutos, 0), 'saldo_min', v_saldo_dia,
      'tolerado_min', v_absorvido,
      'intervalo_maior_min', p.intervalo_maior_min, 'intervalo_ok', p.intervalo_ok,
      'extra_status', p.extra_status, 'origem', p.origem, 'motivo', p.motivo,
      'feriado', case when v_fer.tipo is null then null else
        jsonb_build_object('nome', v_fer.nome, 'tipo', v_fer.tipo, 'carga_min', v_fer.carga_min) end,
      'justificativa', case when v_just.status is null then null else
        jsonb_build_object('tipo', v_just.tipo, 'descricao', v_just.descricao, 'status', v_just.status,
          'decidido_por', v_just.decidido_por_nome, 'decidido_em', v_just.decidido_em,
          'doc_id', v_just.doc_id,
          'ausencia_ini', v_just.ausencia_ini, 'ausencia_fim', v_just.ausencia_fim) end,
      'ajuste', case when p.ajuste_em is null then null else
        jsonb_build_object('de', p.ajuste_de, 'por', v_por, 'em', p.ajuste_em) end,
      'log', v_log);

    d := d + 1;
  end loop;

  -- Jornadas que valeram DENTRO do período. Num ciclo em que a pessoa mudou de
  -- vínculo (6h → 8h no dia 14), o cabeçalho sozinho diria 8h para o mês todo —
  -- e é este documento que ela assina.
  select coalesce(jsonb_agg(jsonb_build_object(
           'de', greatest(x.vigencia_ini, v_ini), 'carga_min', x.carga_min,
           'entrada', x.entrada, 'saida', x.saida) order by x.vigencia_ini), '[]'::jsonb)
    into v_vigencias
    from rh_jornada x
   where x.colaborador_id = p_colaborador_id
     and x.vigencia_ini <= v_fim
     and x.vigencia_ini > (select max(y.vigencia_ini) from rh_jornada y
                            where y.colaborador_id = p_colaborador_id and y.vigencia_ini <= v_ini);

  return jsonb_build_object(
    'colaborador', jsonb_build_object('id', c.id, 'nome', c.nome, 'cargo', c.cargo, 'cpf', c.cpf, 'bate_ponto', coalesce(c.bate_ponto, true)),
    'jornada', jsonb_build_object('carga_min', j.carga_min, 'entrada', j.entrada, 'saida', j.saida,
                                  'intervalo_min', j.intervalo_min, 'dias_semana', j.dias_semana,
                                  'tolerancia_min', v_tol,
                                  'mudou_no_periodo', jsonb_array_length(v_vigencias) > 0,
                                  'carga_ini', (rh_jornada_em(p_colaborador_id, v_ini)).carga_min,
                                  'vigencias', v_vigencias),
    'ini', v_ini, 'fim', v_fim, 'competencia', to_char(p_competencia, 'YYYY-MM'),
    'resumo', jsonb_build_object('hn_min', v_hn, 'faltas_min', v_falta, 'extra_min', v_ex,
                                 'saldo_min', v_ex - v_falta,
                                 'ate', least(v_fim, (now() at time zone 'America/Sao_Paulo')::date - 1)),
    'dias', v_dias);
end $$;

notify pgrst, 'reload schema';
