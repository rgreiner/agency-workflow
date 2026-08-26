-- 259_extra_rejeitada_dispensado_abono.sql
-- Três inconsistências reportadas pelo Rafael no fechamento de ago/2026
-- (26/07–25/08), todas MEDIDAS em prod antes do conserto:
--
--  1) EXTRA REJEITADA contava como "pendente de aprovação" para sempre.
--     Caso real: Luiza Medeiros 05/08, 33 min com extra_status='rejeitado' —
--     o aviso do fechamento acusava "Luiza (0:33)" e a fila de RH → Ponto
--     (que só lista status='pendente') não mostrava nada. Rejeitada agora é
--     DESCARTADA: não vira H.E., não vira pendente (o dia fica só com as
--     horas normais).
--
--  2) DISPENSADO DE JORNADA (bate_ponto=false, art. 62) tinha TODAS as horas
--     tratadas como extra: o Rafael aparecia com 93h de H.E.50 "aprovada" e
--     28h26 pendente no relatório da contabilidade. Para quem não tem
--     jornada não existe hora extra: as horas registradas entram como estão,
--     em H.N. (informativo) — sem extra, sem pendente, sem falta.
--
--  3) EXTRA QUE NASCE DO ABONO ficava invisível: o abono encurta a carga do
--     dia (mig. 212) DEPOIS da batida, então o recalc nunca marcou
--     extra_status — a régua do fechamento via a extra (Heloisa 07/08,
--     0:20) mas ela não existia em lugar nenhum para aprovar. Agora a
--     decisão da justificativa (aprovar/abonar) marca 'pendente' nos dias em
--     que a carga líquida deixa saldo positivo — a extra entra na FILA.
--
-- De quebra, alinha o RESUMO do espelho ao fechamento: dia sem carga de quem
-- bate ponto (fim de semana/feriado) soma extra pelo TOTAL trabalhado
-- ("desde o 1º minuto", regra da casa) — antes o espelho usava
-- greatest(0, minutos − 8h), que sumia com trabalho de sábado abaixo de 8h.
-- Dia importado (Pontomais) segue congelado em tudo. Idempotente.

-- ── 1+2) Fechamento: rejeitada descarta; dispensado não tem extra ───────────
create or replace function rh_fechamento_linha_calc(p_colaborador_id uuid, p_ini date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  c record; j rh_jornada; d date;
  v_hn int := 0; v_h50 int := 0; v_h100 int := 0; v_falta int := 0; v_pend int := 0; v_edit timestamptz;
  v_carga int; v_trab int; v_esp boolean; v_ab boolean; v_100 boolean; v_extra int;
  v_status text; v_upd timestamptz; v_dias int := 0; v_esperados int := 0;
  v_abono int; v_origem text; v_i_norm int; v_i_deb int; v_i_falt int; v_i_50 int; v_i_100 int;
  v_tol int; v_saldo int;
begin
  select co.org_id, co.id, co.nome, co.cpf, co.cargo, co.bate_ponto, co.entra_fechamento, co.data_demissao
    into c from rh_colaborador co where co.id = p_colaborador_id;
  if c.id is null then raise exception 'Colaborador não encontrado'; end if;

  j := rh_jornada_de(c.id);
  v_tol := coalesce(j.tolerancia_min, 10);

  d := p_ini;
  while d <= p_fim loop
    v_carga := coalesce(j.carga_min, 480);
    v_esp := coalesce(c.bate_ponto, true) and rh_no_vinculo(c.id, d) and d < (now() at time zone 'America/Sao_Paulo')::date
             and (extract(isodow from d)::int = any (coalesce(j.dias_semana, array[1,2,3,4,5])));
    select f.abona, f.extra_100 into v_ab, v_100 from rh_feriado f where f.org_id = c.org_id and f.data = d;
    if found and coalesce(v_ab, true) then v_esp := false; end if;
    if not found then v_100 := false; end if;
    if v_esp and rh_ponte_abona(c.id, d) then v_esp := false; end if;
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
      -- Dia congelado: usa a apuração do Pontomais (ver rh_espelho).
      if v_esp then v_esperados := v_esperados + 1; end if;
      v_hn    := v_hn + coalesce(v_i_norm, 0);
      v_falta := v_falta + greatest(0, coalesce(v_i_deb, v_i_falt, 0));
      v_h50   := v_h50 + coalesce(v_i_50, 0);
      v_h100  := v_h100 + coalesce(v_i_100, 0);
    elsif v_esp then
      v_esperados := v_esperados + 1;
      v_saldo := rh_saldo_tolerado(v_trab, v_carga, v_tol);
      -- Dia absorvido credita a carga cheia de horas normais.
      v_hn := v_hn + v_carga + least(0, v_saldo);
      v_extra := greatest(0, v_saldo);
      if v_extra > 0 then
        if v_status = 'aprovado' then
          if v_100 then v_h100 := v_h100 + v_extra; else v_h50 := v_h50 + v_extra; end if;
        elsif v_status = 'rejeitado' then
          null;  -- rejeitada: não é paga nem fica "pendente" para sempre
        else v_pend := v_pend + v_extra; end if;
      elsif v_saldo < 0 then
        v_falta := v_falta + (-v_saldo);
      end if;
    elsif v_trab > 0 then
      if not coalesce(c.bate_ponto, true) then
        -- Dispensado de jornada (art. 62, II): não existe hora extra — as
        -- horas registradas aparecem como estão, em H.N. (informativo).
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
revoke execute on function rh_fechamento_linha_calc(uuid, date, date) from public, anon, authenticated;

-- ── Espelho: resumo com as mesmas três regras ───────────────────────────────
-- (recria por cima da 256; só o bloco do resumo muda — dias continuam iguais)
create or replace function rh_espelho(p_org_id uuid, p_colaborador_id uuid, p_competencia date, p_ini date default null, p_fim date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_ini date; v_fim date; v_dias jsonb := '[]'::jsonb; d date;
  c record; j rh_jornada; p rh_ponto; v_marc jsonb; v_fer record; v_just record;
  v_saldo_dia int; v_abono int; v_tol int; v_absorvido int;
  v_log jsonb; v_por text; v_esp boolean; v_carga int;
  v_hn int := 0; v_falta int := 0; v_ex int := 0;
begin
  if not (rh_can(p_org_id) or rh_is_self(p_colaborador_id)) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select ini, fim into v_ini, v_fim from rh_periodo_fechamento(p_org_id, p_competencia);
  v_ini := coalesce(p_ini, v_ini);
  v_fim := coalesce(p_fim, v_fim);
  select id, nome, cargo, cpf, bate_ponto into c from rh_colaborador where id = p_colaborador_id and org_id = p_org_id;
  if c.id is null then raise exception 'Colaborador não encontrado'; end if;
  j := rh_jornada_de(p_colaborador_id);
  v_tol := coalesce(j.tolerancia_min, 10);

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

    v_abono := 0;
    if v_esp then
      v_abono := rh_abono_min(p_colaborador_id, d, v_carga);
      if v_abono > 0 then
        v_carga := greatest(0, v_carga - v_abono);
        if v_carga = 0 then v_esp := false; end if;
      end if;
    end if;

    if p.origem = 'pontomais' then
      v_saldo_dia := coalesce(p.saldo_min, 0);       -- dia congelado (mig. 206)
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
      -- Extra rejeitada não soma no card: não será paga.
      if p.extra_status is distinct from 'rejeitado' then
        v_ex := v_ex + greatest(0, v_saldo_dia);
      end if;
    elsif not coalesce(c.bate_ponto, true) then
      -- Dispensado de jornada: as horas aparecem como estão (H.N.), nunca
      -- como "extra" — antes 93h do sócio viravam extra no relatório.
      v_hn := v_hn + coalesce(p.minutos, 0);
    else
      -- Dia sem carga de quem bate ponto (fim de semana/feriado): extra pelo
      -- TOTAL, desde o 1º minuto — mesma régua do fechamento. Antes era
      -- greatest(0, minutos − 8h), que escondia sábado de menos de 8h.
      if p.extra_status is distinct from 'rejeitado' then
        v_ex := v_ex + coalesce(p.minutos, 0);
      end if;
    end if;

    v_dias := v_dias || jsonb_build_object(
      'data', d, 'dow', extract(isodow from d)::int,
      'esperado_min', case when v_esp then v_carga else 0 end, 'abono_min', v_abono,
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

  return jsonb_build_object(
    'colaborador', jsonb_build_object('id', c.id, 'nome', c.nome, 'cargo', c.cargo, 'cpf', c.cpf, 'bate_ponto', coalesce(c.bate_ponto, true)),
    'jornada', jsonb_build_object('carga_min', j.carga_min, 'entrada', j.entrada, 'saida', j.saida,
                                  'intervalo_min', j.intervalo_min, 'dias_semana', j.dias_semana,
                                  'tolerancia_min', v_tol),
    'ini', v_ini, 'fim', v_fim, 'competencia', to_char(p_competencia, 'YYYY-MM'),
    'resumo', jsonb_build_object('hn_min', v_hn, 'faltas_min', v_falta, 'extra_min', v_ex,
                                 'saldo_min', v_ex - v_falta,
                                 'ate', least(v_fim, (now() at time zone 'America/Sao_Paulo')::date - 1)),
    'dias', v_dias);
end $$;
revoke execute on function rh_espelho(uuid, uuid, date, date, date) from public, anon;
grant  execute on function rh_espelho(uuid, uuid, date, date, date) to authenticated;

-- ── 3) Decisão da justificativa põe na fila a extra que nasce do abono ──────
create or replace function rh_decidir_justificativa(p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  jt rh_justificativa; p rh_ponto;
  v_pede boolean; v_ajustados int := 0;
  v_marc text[]; v_n int; v_novo text[]; v_erros jsonb := '[]'::jsonb; v_msg text;
  v_e text; v_ii text; v_if text; v_s text; v_extras text[];
begin
  select * into jt from rh_justificativa where id = p_id;
  if jt.id is null then raise exception 'Justificativa não encontrada'; end if;
  if not rh_can(jt.org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_status not in ('aprovado','rejeitado','abonado','falta') then raise exception 'Status inválido'; end if;

  update rh_justificativa
     set status = p_status, decidido_por = auth.uid(), decidido_em = now(), ajuste_erro = null
   where id = p_id;

  v_pede := coalesce(jsonb_array_length(jt.marcacoes), 0) > 0
            or jt.hora_entrada is not null or jt.hora_intervalo_ini is not null
            or jt.hora_intervalo_fim is not null or jt.hora_saida is not null;

  if p_status = 'aprovado' and v_pede then
    -- Correção de horário vale para UM dia. A tela já impede pedir horário em
    -- justificativa de período; aplicar a mesma entrada/saída em cinco dias
    -- seria inventar marcação, então o resto fica registrado como não aplicado.
    insert into rh_ponto (org_id, colaborador_id, data) values (jt.org_id, jt.colaborador_id, jt.data_ini)
      on conflict (colaborador_id, data) do nothing;
    select * into p from rh_ponto where colaborador_id = jt.colaborador_id and data = jt.data_ini;

    begin
      if coalesce(jsonb_array_length(jt.marcacoes), 0) > 0 then
        -- Caminho novo: a justificativa traz o dia inteiro em pares. Nada de
        -- mesclar posição — a lista É o dia depois da aprovação.
        v_novo := array(select jsonb_array_elements_text(jt.marcacoes));
        if array_length(v_novo, 1) % 2 = 1 then
          raise exception 'As marcações vêm em pares (entrada e saída).';
        end if;
      else
        -- Caminho legado (justificativa anterior à 222): os quatro campos são
        -- POSIÇÕES no dia — 1ª, saída p/ intervalo, volta, ÚLTIMA. O que não
        -- foi informado é preservado.
        v_marc := coalesce(
          (select array_agg(to_char(hora, 'HH24:MI') order by seq) from rh_marcacao where ponto_id = p.id),
          '{}'::text[]);
        v_n := coalesce(array_length(v_marc, 1), 0);

        v_e  := coalesce(to_char(jt.hora_entrada, 'HH24:MI'),       v_marc[1]);
        v_ii := coalesce(to_char(jt.hora_intervalo_ini, 'HH24:MI'), case when v_n >= 3 then v_marc[2] end);
        v_if := coalesce(to_char(jt.hora_intervalo_fim, 'HH24:MI'), case when v_n >= 3 then v_marc[3] end);
        v_s  := coalesce(to_char(jt.hora_saida, 'HH24:MI'),         case when v_n >= 2 and v_n % 2 = 0 then v_marc[v_n] end);
        v_extras := case when v_n >= 5
          then (case when v_n % 2 = 0 then v_marc[4 : v_n - 1] else v_marc[4 : v_n] end)
          else '{}'::text[] end;

        v_novo := array_remove(array[v_e, v_ii, v_if] || v_extras || array[v_s], null);
      end if;

      perform rh_editar_ponto(
        jt.org_id, jt.colaborador_id, jt.data_ini,
        to_jsonb(v_novo),
        'Justificativa aprovada pelo RH — ' || jt.tipo
      );
      update rh_ponto set ajuste_just_id = p_id where id = p.id;
      v_ajustados := 1;
    exception when others then
      -- Competência assinada, dia importado, lista ímpar: a decisão vale, o
      -- ajuste não. Nunca engolir em silêncio (é o que a 193 consertou).
      v_msg := SQLERRM;
      v_erros := v_erros || jsonb_build_object('data', jt.data_ini, 'motivo', v_msg);
    end;

    if jt.data_fim > jt.data_ini then
      v_erros := v_erros || jsonb_build_object(
        'data', jt.data_fim,
        'motivo', 'Correção de horário vale para um dia. Os demais dias do período foram apenas decididos.');
    end if;

    if jsonb_array_length(v_erros) > 0 then
      update rh_justificativa set ajuste_erro = (v_erros->0->>'motivo') where id = p_id;
    end if;
  end if;

  -- Extra que NASCE da decisão (o abono encurta a carga DEPOIS da batida, e o
  -- recalc nunca a viu): marca 'pendente' para ela existir na fila de
  -- aprovação — antes só a régua do fechamento a enxergava e ela ficava
  -- "pendente" no relatório sem ter onde ser decidida (mig. 259).
  if p_status in ('aprovado', 'abonado') then
    update rh_ponto pp
       set extra_status = 'pendente', updated_at = now()
      from rh_colaborador co
     where co.id = pp.colaborador_id
       and pp.colaborador_id = jt.colaborador_id
       and pp.data between jt.data_ini and jt.data_fim
       and pp.origem is null
       and pp.extra_status is null
       and coalesce(co.bate_ponto, true)
       and coalesce(pp.minutos, 0) > 0
       -- Mesma régua do fechamento: com carga, saldo tolerado; sem carga
       -- (fds/feriado/abono total), extra desde o 1º minuto.
       and (case when rh_esperado_min(pp.colaborador_id, pp.data) > 0
                 then rh_saldo_tolerado(pp.minutos, rh_esperado_min(pp.colaborador_id, pp.data),
                        coalesce((rh_jornada_de(pp.colaborador_id)).tolerancia_min, 10))
                 else pp.minutos end) > 0;
  end if;

  return jsonb_build_object('status', p_status, 'pontos_ajustados', v_ajustados, 'nao_aplicados', v_erros);
end $$;
revoke execute on function rh_decidir_justificativa(uuid, text) from public, anon;
grant  execute on function rh_decidir_justificativa(uuid, text) to authenticated;

-- ── Backfill do ciclo corrente (26/07 em diante): extras invisíveis ─────────
-- Dias do Flow sem status cuja carga líquida (abono/feriado/escala) deixa
-- saldo positivo — entram na fila como pendentes (o caso Heloisa 07/08).
-- Fim de semana/feriado sem carga: rh_esperado_min = 0 e todo o trabalhado é
-- extra (rh_saldo_tolerado sem carga não absorve nada). Dia importado e
-- dispensado de ponto ficam de fora.
update rh_ponto p
   set extra_status = 'pendente', updated_at = now()
  from rh_colaborador c
 where c.id = p.colaborador_id
   and p.data >= '2026-07-26' and p.data < current_date
   and p.origem is null
   and p.extra_status is null
   and coalesce(c.bate_ponto, true)
   and coalesce(p.minutos, 0) > 0
   and (case when rh_esperado_min(p.colaborador_id, p.data) > 0
             then rh_saldo_tolerado(p.minutos, rh_esperado_min(p.colaborador_id, p.data),
                    coalesce((rh_jornada_de(p.colaborador_id)).tolerancia_min, 10))
             else p.minutos end) > 0;

notify pgrst, 'reload schema';
