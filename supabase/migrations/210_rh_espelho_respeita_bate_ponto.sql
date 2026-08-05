-- 210_rh_espelho_respeita_bate_ponto.sql
-- Continuação da 209: o flag por pessoa passa a valer no espelho e no
-- fechamento. Sem isto o toggle mudaria só a trava de acesso, e o sócio
-- continuaria colecionando falta no relatório que vai para a contabilidade.
--
-- Quem não bate ponto fica sem CARGA ESPERADA no dia. Consequências, todas
-- desejadas: não gera falta, não entra na contagem de dias esperados e o que
-- ele porventura registrar aparece como está — sem ser medido contra uma
-- jornada que não é dele.
--
-- O espelho passa a devolver `colaborador.bate_ponto` para a tela poder dizer
-- por que a coluna de saldo está vazia, em vez de parecer defeito.
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public.rh_espelho(p_org_id uuid, p_colaborador_id uuid, p_competencia date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ini date; v_fim date; v_dias jsonb := '[]'::jsonb; d date;
  c record; j rh_jornada; p rh_ponto; v_marc jsonb; v_fer record; v_just record;
  v_saldo_dia int;
  v_log jsonb; v_por text; v_esp boolean; v_carga int;
  v_hn int := 0; v_falta int := 0; v_ex int := 0;
begin
  if not (rh_can(p_org_id) or rh_is_self(p_colaborador_id)) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select ini, fim into v_ini, v_fim from rh_periodo_fechamento(p_org_id, p_competencia);
  select id, nome, cargo, cpf, bate_ponto into c from rh_colaborador where id = p_colaborador_id and org_id = p_org_id;
  if c.id is null then raise exception 'Colaborador não encontrado'; end if;
  j := rh_jornada_de(p_colaborador_id);

  d := v_ini;
  while d <= v_fim loop
    select * into p from rh_ponto where colaborador_id = p_colaborador_id and data = d;

    select coalesce(jsonb_agg(to_char(hora, 'HH24:MI') order by seq), '[]'::jsonb)
      into v_marc from rh_marcacao where ponto_id = p.id;

    select nome, tipo, abona, carga_min into v_fer from rh_feriado where org_id = p_org_id and data = d;

    select x.tipo, x.descricao, x.status, x.decidido_em,
           (select pr.full_name from profiles pr where pr.id = x.decidido_por) as decidido_por_nome
      into v_just
      from rh_justificativa x
     where x.colaborador_id = p_colaborador_id and d between x.data_ini and x.data_fim
     order by x.created_at desc limit 1;

    select coalesce(jsonb_agg(jsonb_build_object(
             'acao', l.acao, 'antes', l.antes, 'depois', l.depois, 'motivo', l.motivo, 'em', l.em,
             'por', (select pr.full_name from profiles pr where pr.id = l.por)) order by l.em desc), '[]'::jsonb)
      into v_log from rh_ponto_log l where l.ponto_id = p.id;

    select pr.full_name into v_por from profiles pr where pr.id = p.ajuste_por;

    -- Dia esperado (para marcar falta): dia de jornada e não abonado por feriado.
    -- Quem não bate ponto não tem carga esperada: sem jornada a cumprir não
    -- existe falta. Os registros que ele porventura tiver seguem visíveis.
    v_esp := coalesce(c.bate_ponto, true)
             and (extract(isodow from d)::int = any (coalesce(j.dias_semana, array[1,2,3,4,5])));
    v_carga := coalesce(j.carga_min, 480);
    if v_fer.nome is not null or v_fer.tipo is not null then
      v_carga := coalesce(v_fer.carga_min, case when coalesce(v_fer.abona, true) then 0 else v_carga end);
      if v_carga = 0 then v_esp := false; end if;
    end if;
    -- Emenda de feriado: abona só quem ADERIU. O calendário (rh_feriado) vale
    -- para a org inteira e numa ponte parte do time trabalha — abonar todos
    -- daria hora extra a quem estava no escritório.
    if v_esp and rh_ponte_abona(p_colaborador_id, d) then
      v_carga := 0; v_esp := false;
    end if;

    if p.origem = 'pontomais' then
      -- Dia congelado: a apuração é a DELES. O Pontomais credita 8h fixas e
      -- joga o excedente em extra, e abona atestado/ausência justificada no
      -- próprio débito — régua diferente da do Flow. Recalcular aqui inventava
      -- falta onde eles não cobraram (um atestado do dia inteiro virava 8h de
      -- falta) e faria o histórico divergir do que as pessoas já assinaram.
      v_hn    := v_hn + coalesce(p.imp_normais_min, 0);
      v_falta := v_falta + greatest(0, coalesce(p.imp_debito_min, p.imp_faltantes_min, 0));
      v_ex    := v_ex + coalesce(p.imp_he50_min, 0) + coalesce(p.imp_he100_min, 0);
    else
      if v_esp then
        v_hn := v_hn + least(coalesce(p.minutos, 0), v_carga);
        if coalesce(p.minutos, 0) < v_carga
           and not exists (select 1 from rh_justificativa x where x.colaborador_id = p_colaborador_id
                            and x.status in ('aprovado','abonado') and d between x.data_ini and x.data_fim)
        then v_falta := v_falta + (v_carga - coalesce(p.minutos, 0)); end if;
      end if;
      v_ex := v_ex + greatest(0, coalesce(p.minutos, 0) - v_carga);
    end if;

    -- Saldo EXIBIDO do dia. O resumo do ciclo já ignorava a diferença de um
    -- dia com justificativa aprovada/abonada, mas a linha continuava mostrando
    -- o saldo bruto: o dia aparecia "abonada" e -0:39 em vermelho ao mesmo
    -- tempo, e o total não fechava com a soma da coluna. Abonar é justamente
    -- perdoar a diferença — então ela some da linha também. Hora extra (saldo
    -- positivo) não é afetada.
    v_saldo_dia := coalesce(p.saldo_min, 0);
    if v_saldo_dia < 0 and v_just.status in ('aprovado', 'abonado') then
      v_saldo_dia := 0;
    end if;

    v_dias := v_dias || jsonb_build_object(
      'data', d, 'dow', extract(isodow from d)::int,
      'esperado_min', case when v_esp then v_carga else 0 end,
      'marcacoes', v_marc,
      'minutos', coalesce(p.minutos, 0), 'saldo_min', v_saldo_dia,
      'intervalo_maior_min', p.intervalo_maior_min, 'intervalo_ok', p.intervalo_ok,
      'extra_status', p.extra_status, 'origem', p.origem, 'motivo', p.motivo,
      'feriado', case when v_fer.tipo is null then null else
        jsonb_build_object('nome', v_fer.nome, 'tipo', v_fer.tipo, 'carga_min', v_fer.carga_min) end,
      'justificativa', case when v_just.status is null then null else
        jsonb_build_object('tipo', v_just.tipo, 'descricao', v_just.descricao, 'status', v_just.status,
          'decidido_por', v_just.decidido_por_nome, 'decidido_em', v_just.decidido_em) end,
      'ajuste', case when p.ajuste_em is null then null else
        jsonb_build_object('de', p.ajuste_de, 'por', v_por, 'em', p.ajuste_em) end,
      'log', v_log);

    d := d + 1;
  end loop;

  return jsonb_build_object(
    'colaborador', jsonb_build_object('id', c.id, 'nome', c.nome, 'cargo', c.cargo, 'cpf', c.cpf, 'bate_ponto', coalesce(c.bate_ponto, true)),
    'jornada', jsonb_build_object('carga_min', j.carga_min, 'entrada', j.entrada, 'saida', j.saida,
                                  'intervalo_min', j.intervalo_min, 'dias_semana', j.dias_semana),
    'ini', v_ini, 'fim', v_fim, 'competencia', to_char(p_competencia, 'YYYY-MM'),
    'resumo', jsonb_build_object('hn_min', v_hn, 'faltas_min', v_falta, 'extra_min', v_ex,
                                 'saldo_min', v_ex - v_falta),
    'dias', v_dias);
end; $function$

;
CREATE OR REPLACE FUNCTION public.rh_fechamento(p_org_id uuid, p_competencia date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ini date; v_fim date; v_linhas jsonb := '[]'::jsonb;
  c record; j rh_jornada; d date;
  v_hn int; v_h50 int; v_h100 int; v_falta int; v_pend int; v_edit timestamptz;
  v_carga int; v_trab int; v_esp boolean; v_ab boolean; v_100 boolean; v_extra int;
  v_status text; v_upd timestamptz; v_dias int; v_esperados int;
  v_origem text; v_i_norm int; v_i_deb int; v_i_falt int; v_i_50 int; v_i_100 int;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select ini, fim into v_ini, v_fim from rh_periodo_fechamento(p_org_id, p_competencia);

  for c in
    select co.id, co.nome, co.cpf, co.cargo, co.bate_ponto
    from rh_colaborador co
    where co.org_id = p_org_id and not co.arquivado
      and (co.status <> 'desligado'
           or exists (select 1 from rh_ponto p where p.colaborador_id = co.id and p.data between v_ini and v_fim))
    order by co.nome
  loop
    j := rh_jornada_de(c.id);
    v_hn := 0; v_h50 := 0; v_h100 := 0; v_falta := 0; v_pend := 0; v_edit := null;
    v_dias := 0; v_esperados := 0;

    d := v_ini;
    while d <= v_fim loop
      v_carga := coalesce(j.carga_min, 480);
      -- Dia esperado = está nos dias_semana da jornada E não é feriado/emenda que abona.
      -- Dispensado de jornada (sócio, cargo de confiança): sem carga esperada.
      v_esp := coalesce(c.bate_ponto, true)
               and (extract(isodow from d)::int = any (coalesce(j.dias_semana, array[1,2,3,4,5])));
      select f.abona, f.extra_100 into v_ab, v_100 from rh_feriado f where f.org_id = p_org_id and f.data = d;
      if found and coalesce(v_ab, true) then v_esp := false; end if;
      if not found then v_100 := false; end if;
      -- Emenda de feriado: abona só quem aderiu (ver rh_ponte_abona).
      if v_esp and rh_ponte_abona(c.id, d) then v_esp := false; end if;

      select p.minutos, p.extra_status, p.updated_at, p.origem,
             p.imp_normais_min, p.imp_debito_min, p.imp_faltantes_min, p.imp_he50_min, p.imp_he100_min
        into v_trab, v_status, v_upd, v_origem, v_i_norm, v_i_deb, v_i_falt, v_i_50, v_i_100
      from rh_ponto p where p.colaborador_id = c.id and p.data = d;
      if not found then v_trab := 0; v_status := null; v_upd := null; else v_dias := v_dias + 1; end if;
      v_trab := coalesce(v_trab, 0);
      if v_upd is not null and (v_edit is null or v_upd > v_edit) then v_edit := v_upd; end if;

      if v_origem = 'pontomais' then
        -- Dia congelado: usa a apuração do Pontomais (ver rh_espelho).
        if v_esp then v_esperados := v_esperados + 1; end if;
        v_hn    := v_hn + coalesce(v_i_norm, 0);
        v_falta := v_falta + greatest(0, coalesce(v_i_deb, v_i_falt, 0));
        v_h50   := v_h50 + coalesce(v_i_50, 0);
        v_h100  := v_h100 + coalesce(v_i_100, 0);
      elsif v_esp then
        v_esperados := v_esperados + 1;
        v_hn := v_hn + least(v_trab, v_carga);
        v_extra := greatest(0, v_trab - v_carga);
        if v_extra > 0 then
          -- Só entra na folha o que o gestor aprovou; o resto fica sinalizado.
          if v_status = 'aprovado' then
            if v_100 then v_h100 := v_h100 + v_extra; else v_h50 := v_h50 + v_extra; end if;
          else v_pend := v_pend + v_extra; end if;
        elsif v_trab < v_carga then
          -- Justificativa aprovada/abonada credita o dia (não vira falta).
          if exists (select 1 from rh_justificativa x
                     where x.colaborador_id = c.id and x.status in ('aprovado','abonado')
                       and d between x.data_ini and x.data_fim) then
            v_hn := v_hn + (v_carga - v_trab);
          else
            v_falta := v_falta + (v_carga - v_trab);
          end if;
        end if;
      elsif v_trab > 0 then
        -- Dia não esperado (fim de semana, feriado, emenda): tudo é extra.
        if v_status = 'aprovado' then
          if v_100 then v_h100 := v_h100 + v_trab; else v_h50 := v_h50 + v_trab; end if;
        else v_pend := v_pend + v_trab; end if;
      end if;

      d := d + 1;
    end loop;

    v_linhas := v_linhas || jsonb_build_object(
      'colaborador_id', c.id, 'nome', c.nome, 'cpf', c.cpf, 'cargo', c.cargo,
      'hn_min', v_hn, 'he50_min', v_h50, 'he100_min', v_h100, 'faltas_min', v_falta,
      'total_min', v_hn + v_h50 + v_h100 - v_falta,
      'quitacao_min', v_h50 + v_h100 - v_falta,
      'pendente_min', v_pend, 'editado_em', v_edit,
      -- dias_com_ponto = 0 → a pessoa não bateu ponto no período (dado ausente),
      -- diferente de ter faltado: a tela mostra "sem marcação" em vez de 168h de falta.
      'dias_com_ponto', v_dias, 'dias_esperados', v_esperados);
  end loop;

  return jsonb_build_object('ini', v_ini, 'fim', v_fim,
    'competencia', to_char(p_competencia, 'YYYY-MM'), 'linhas', v_linhas);
end; $function$

;

notify pgrst, 'reload schema';
