-- 218_rh_espelho_anexo_na_linha.sql
-- "Os arquivos que foram feito o upload devem continuar acessíveis para
--  consulta, podemos ter um ícone na linha que ao clicar abre o arquivo."
--  (Rafael, 05/08)
--
-- O anexo já existia (mig. 207) e já era visível na FILA de pendentes do RH.
-- Só que a fila esvazia quando a justificativa é decidida — e é justamente
-- depois, conferindo o espelho do mês, que alguém pergunta "cadê o atestado
-- desse dia?". O documento ficava inalcançável sem ir ao banco.
--
-- O espelho passa a devolver `doc_id` dentro da justificativa do dia, mais o
-- período da ausência — que explica na própria linha por que a carga daquele
-- dia foi menor.
--
-- Quem abre o arquivo é a rota autenticada /api/rh/documento/[id]: o RH pela
-- RLS de sempre, e a própria pessoa pela policy estreita da 207 (só o
-- documento amarrado a uma justificativa dela).
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
  v_saldo_dia int; v_abono int;
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

    -- Abono da justificativa: sai da CARGA exigida, não do saldo inteiro. Só o
    -- tempo que o documento cobre (ver rh_abono_min) — atraso na entrada e
    -- volta depois do fim da consulta continuam contando.
    v_abono := 0;
    if v_esp then
      v_abono := rh_abono_min(p_colaborador_id, d, v_carga);
      if v_abono > 0 then
        v_carga := greatest(0, v_carga - v_abono);
        if v_carga = 0 then v_esp := false; end if;
      end if;
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
        -- A carga já vem líquida do abono: o que faltar aqui é responsabilidade
        -- da pessoa, não do documento.
        if coalesce(p.minutos, 0) < v_carga
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
    -- Saldo exibido do dia. Sai do trabalhado contra a carga JÁ LÍQUIDA do
    -- abono; o saldo bruto gravado no ponto não conhece decisão do RH.
    if p.origem = 'pontomais' then
      v_saldo_dia := coalesce(p.saldo_min, 0);       -- dia congelado (mig. 206)
    elsif v_esp then
      v_saldo_dia := coalesce(p.minutos, 0) - v_carga;
    else
      v_saldo_dia := coalesce(p.saldo_min, 0);
    end if;

    v_dias := v_dias || jsonb_build_object(
      'data', d, 'dow', extract(isodow from d)::int,
      'esperado_min', case when v_esp then v_carga else 0 end, 'abono_min', v_abono,
      'marcacoes', v_marc,
      'minutos', coalesce(p.minutos, 0), 'saldo_min', v_saldo_dia,
      'intervalo_maior_min', p.intervalo_maior_min, 'intervalo_ok', p.intervalo_ok,
      'extra_status', p.extra_status, 'origem', p.origem, 'motivo', p.motivo,
      'feriado', case when v_fer.tipo is null then null else
        jsonb_build_object('nome', v_fer.nome, 'tipo', v_fer.tipo, 'carga_min', v_fer.carga_min) end,
      'justificativa', case when v_just.status is null then null else
        jsonb_build_object('tipo', v_just.tipo, 'descricao', v_just.descricao, 'status', v_just.status,
          'decidido_por', v_just.decidido_por_nome, 'decidido_em', v_just.decidido_em,
          -- Anexo (atestado/declaração) para consulta na própria linha do dia.
          'doc_id', v_just.doc_id,
          'ausencia_ini', v_just.ausencia_ini, 'ausencia_fim', v_just.ausencia_fim) end,
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

notify pgrst, 'reload schema';
