-- 289_carga_le_jornada_do_dia.sql
-- Os sete pontos que calculam CARGA passam a perguntar "qual era a jornada
-- NAQUELE dia" (mig. 288), em vez de ler a jornada de hoje e aplicá-la ao
-- histórico inteiro.
--
-- `rh_espelho` e `rh_fechamento_linha_calc` liam a jornada UMA vez, antes do
-- laço de dias — por isso o mês da promoção sairia com 8h cobradas desde o
-- dia 1. Agora a leitura acontece dentro do laço.
--
-- Os que olham só o presente (rh_ponto_estado, rh_ponto_gate, o lembrete de
-- entrada, rh_bater_ponto) seguem em `rh_jornada_de`, que agora significa
-- "a vigente hoje".
-- Idempotente — cada função é a definição VIVA do banco com a leitura da
-- jornada trocada, nada mais.

CREATE OR REPLACE FUNCTION public.rh_esperado_min(p_colaborador uuid, p_data date)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  j rh_jornada; v_carga int; v_bate boolean; v_org uuid; v_abona boolean; v_fer_carga int;
begin
  select org_id, bate_ponto into v_org, v_bate from rh_colaborador where id = p_colaborador;
  if v_org is null then return 0; end if;
  -- Sócio/cargo de confiança: sem jornada a cumprir.
  if not coalesce(v_bate, true) then return 0; end if;
  -- Fora do vínculo: a pessoa não devia nada porque ainda não estava aqui.
  if not rh_no_vinculo(p_colaborador, p_data) then return 0; end if;

  -- A jornada que valia NAQUELE dia (mig. 288): mudar hoje não reescreve
  -- a carga do passado.
  j := rh_jornada_em(p_colaborador, p_data);
  if not (extract(isodow from p_data)::int = any (coalesce(j.dias_semana, array[1,2,3,4,5]))) then
    return 0;
  end if;
  v_carga := coalesce(j.carga_min, 480);

  select abona, carga_min into v_abona, v_fer_carga
    from rh_feriado where org_id = v_org and data = p_data;
  if found then
    v_carga := coalesce(v_fer_carga, case when coalesce(v_abona, true) then 0 else v_carga end);
    if v_carga = 0 then return 0; end if;
  end if;

  if rh_ponte_abona(p_colaborador, p_data) then return 0; end if;

  -- Aviso prévio (art. 488): reduz a carga do dia — 2h/dia ou os últimos
  -- 7 dias inteiros, conforme a escolha registrada na ficha.
  v_carga := greatest(0, v_carga - coalesce(rh_aviso_reducao_min(p_colaborador, p_data, v_carga), 0));
  if v_carga = 0 then return 0; end if;

  -- Abono do período justificado sai por último: incide sobre a carga que
  -- sobrou, nunca sobre um dia que já não exigia nada.
  return greatest(0, v_carga - rh_abono_min(p_colaborador, p_data, v_carga));
end $function$;

CREATE OR REPLACE FUNCTION public.rh_abono_min(p_colaborador uuid, p_data date, p_carga integer)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  j rh_jornada; v_just record; v_ini time; v_fim time; v_min int := 0;
begin
  -- Só 'abonado'. 'aprovado' corrige a marcação e o dia segue exigindo jornada.
  select * into v_just
    from rh_justificativa x
   where x.colaborador_id = p_colaborador
     and p_data between x.data_ini and x.data_fim
     and x.status = 'abonado'
   order by x.created_at desc limit 1;
  if not found then return 0; end if;

  if v_just.ausencia_ini is null or v_just.ausencia_fim is null
     or v_just.data_ini <> v_just.data_fim then
    return coalesce(p_carga, 0);
  end if;
  if v_just.ausencia_fim <= v_just.ausencia_ini then return 0; end if;

  j := rh_jornada_em(p_colaborador, p_data);   -- jornada do dia (mig. 288)

  v_ini := greatest(v_just.ausencia_ini, coalesce(j.entrada, '08:00'::time));
  v_fim := least(v_just.ausencia_fim, coalesce(j.intervalo_ini, '12:00'::time));
  if v_fim > v_ini then v_min := v_min + extract(epoch from (v_fim - v_ini))::int / 60; end if;

  v_ini := greatest(v_just.ausencia_ini, coalesce(j.intervalo_fim, '13:00'::time));
  v_fim := least(v_just.ausencia_fim, coalesce(j.saida, '18:00'::time));
  if v_fim > v_ini then v_min := v_min + extract(epoch from (v_fim - v_ini))::int / 60; end if;

  return least(v_min, coalesce(p_carga, v_min));
end $function$;

CREATE OR REPLACE FUNCTION public.rh_recalc_ponto(p_ponto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p rh_ponto; j rh_jornada; v_min int := 0; v_carga int; v_abona boolean; v_fcarga int;
  v_maior int := 0; v_n int; v_ini time; v_fim time; v_ant time; r record; v_i int := 0;
  v_saldo int; v_tol int;
begin
  select * into p from rh_ponto where id = p_ponto_id;
  if p.id is null then return; end if;
  if p.origem is not null then return; end if;   -- histórico importado é congelado
  j := rh_jornada_em(p.colaborador_id, p.data);   -- jornada do dia (mig. 288)

  select count(*) into v_n from rh_marcacao where ponto_id = p.id;

  for r in select hora, seq from rh_marcacao where ponto_id = p.id order by seq loop
    v_i := v_i + 1;
    if v_i % 2 = 1 then
      v_ini := r.hora;
      if v_ant is not null then
        v_maior := greatest(v_maior, rh_min_do_dia(v_ini) - rh_min_do_dia(v_ant));
      end if;
    else
      v_fim := r.hora;
      v_min := v_min + greatest(0, rh_min_do_dia(v_fim) - rh_min_do_dia(v_ini));
      v_ant := v_fim;
    end if;
  end loop;

  if v_n = 0 or v_n % 2 = 1 then
    update rh_ponto set minutos = 0, saldo_min = 0, acima_10h = false,
      intervalo_maior_min = nullif(v_maior, 0), intervalo_ok = null, updated_at = now()
    where id = p.id;
    return;
  end if;

  v_carga := coalesce(j.carga_min, 480);
  select abona, carga_min into v_abona, v_fcarga from rh_feriado where org_id = p.org_id and data = p.data;
  if found then
    v_carga := coalesce(v_fcarga, case when coalesce(v_abona, true) then 0 else v_carga end);
  elsif not (extract(isodow from p.data)::int = any (coalesce(j.dias_semana, array[1,2,3,4,5]))) then
    v_carga := 0;
  end if;

  v_min   := least(v_min, coalesce(j.max_dia_min, 600));
  v_saldo := v_min - v_carga;
  v_tol   := coalesce(j.tolerancia_min, 10);

  -- Tolerância: variação pequena não vira extra nem débito. Só vale quando há carga
  -- esperada — trabalho em feriado/fim de semana conta desde o primeiro minuto.
  if v_carga > 0 and abs(v_saldo) <= v_tol then v_saldo := 0; end if;

  update rh_ponto set
    minutos   = v_min,
    acima_10h = (v_min >= coalesce(j.max_dia_min, 600)),
    saldo_min = v_saldo,
    intervalo_maior_min = v_maior,
    intervalo_ok = case when v_min > 360 then v_maior >= coalesce(j.intervalo_min, 60) else true end,
    -- Só pede aprovação do gestor quando sobrou extra DE VERDADE (fora da tolerância).
    extra_status = case when v_saldo > 0 then coalesce(extra_status, 'pendente') else null end,
    entrada       = (select hora from rh_marcacao where ponto_id = p.id and seq = 1),
    intervalo_ini = (select hora from rh_marcacao where ponto_id = p.id and seq = 2),
    intervalo_fim = (select hora from rh_marcacao where ponto_id = p.id and seq = 3),
    saida         = (select hora from rh_marcacao where ponto_id = p.id order by seq desc limit 1),
    updated_at = now()
  where id = p.id;
end; $function$;

CREATE OR REPLACE FUNCTION public.rh_ausencias(p_org uuid, p_ini date, p_fim date)
 RETURNS TABLE(colaborador_id uuid, nome text, cargo text, data date, tipo text, rotulo text, parcial boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_fim < p_ini or p_fim - p_ini > 400 then
    raise exception 'Período inválido (máximo 400 dias)';
  end if;

  return query
  with dias as (
    select generate_series(p_ini, p_fim, interval '1 day')::date as d
  ),
  pessoas as (
    select c.id, c.nome, c.cargo, c.bate_ponto, c.data_demissao,
           c.aviso_previo_ini, c.aviso_previo_fim, c.aviso_previo_modo
    from rh_colaborador c
    where c.org_id = p_org and not c.arquivado
      and (c.status <> 'desligado' or c.data_demissao is null or c.data_demissao >= p_ini)
  ),
  -- Grade só com dia ÚTIL da escala de cada pessoa e dentro do vínculo: fim de
  -- semana não é ausência, e ninguém "falta" antes de ser contratado.
  grade as (
    select p.*, d.d
    from pessoas p
    cross join dias d
    where coalesce(p.bate_ponto, true)
      and rh_no_vinculo(p.id, d.d)
      and extract(isodow from d.d)::int = any (
            coalesce((rh_jornada_em(p.id, d.d)).dias_semana, array[1,2,3,4,5]))
  ),
  marcado as (
    select g.id, g.nome, g.cargo, g.d,
           case
             when fe.data is not null and coalesce(fe.abona, true) then 'feriado'
             when pt.id is not null then 'ponte'
             when fr.id is not null then 'ferias'
             when fl.id is not null then 'ferias_avulsa'
             when g.aviso_previo_modo = 'ultima_semana'
                  and coalesce(g.aviso_previo_fim, g.data_demissao) is not null
                  and g.d between coalesce(g.aviso_previo_fim, g.data_demissao) - 6
                              and coalesce(g.aviso_previo_fim, g.data_demissao) then 'aviso'
             when ju.id is not null then ju.tipo
           end as tipo,
           case
             when fe.data is not null and coalesce(fe.abona, true) then coalesce(fe.nome, 'Feriado')
             when pt.id is not null then pt.nome
             when fr.id is not null then 'Férias' || case when fr.status = 'programada' then ' (programada)' else '' end
             when fl.id is not null then coalesce(nullif(btrim(fl.motivo), ''), 'Folga')
             when g.aviso_previo_modo = 'ultima_semana'
                  and coalesce(g.aviso_previo_fim, g.data_demissao) is not null
                  and g.d between coalesce(g.aviso_previo_fim, g.data_demissao) - 6
                              and coalesce(g.aviso_previo_fim, g.data_demissao) then 'Aviso prévio'
             when ju.id is not null then coalesce(nullif(btrim(ju.descricao), ''), ju.tipo)
           end as rotulo,
           -- Justificativa com período (declaração das 13h às 14h) é ausência
           -- PARCIAL: o dia continua tendo carga, só menor.
           (ju.id is not null and ju.ausencia_ini is not null and ju.ausencia_fim is not null) as parcial
      from grade g
      left join rh_feriado fe
        on fe.org_id = p_org and fe.data = g.d
      left join lateral (
        select pp.id, pp.nome from rh_ferias_ponte pp
         where pp.org_id = p_org and g.d between pp.inicio and pp.fim
           and not exists (select 1 from rh_ferias_ponte_excecao e
                           where e.ponte_id = pp.id and e.colaborador_id = g.id)
         limit 1) pt on true
      left join lateral (
        select f.id, f.status from rh_ferias f
         where f.colaborador_id = g.id and f.status <> 'cancelada'
           and g.d between f.inicio and f.fim
         limit 1) fr on true
      left join lateral (
        select l.id, l.motivo from rh_ferias_lancamento l
         where l.colaborador_id = g.id and g.d between l.inicio and l.fim
         limit 1) fl on true
      left join lateral (
        select j.id, j.tipo, j.descricao, j.ausencia_ini, j.ausencia_fim
          from rh_justificativa j
         where j.colaborador_id = g.id and g.d between j.data_ini and j.data_fim
           and j.status in ('aprovado', 'abonado', 'falta')
           -- Correção de marcação não é ausência: 'esqueci' nunca entra, e
           -- 'outro' só entra quando declara o período em que ficou fora.
           and (j.tipo in ('atestado', 'medico', 'falta')
                or (j.tipo = 'outro' and j.ausencia_ini is not null))
         order by j.created_at desc limit 1) ju on true
  )
  select m.id, m.nome, m.cargo, m.d, m.tipo, m.rotulo, coalesce(m.parcial, false)
    from marcado m
   where m.tipo is not null
   order by m.nome, m.d;
end $function$;

CREATE OR REPLACE FUNCTION public.rh_decidir_justificativa(p_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                        coalesce((rh_jornada_em(pp.colaborador_id, pp.data)).tolerancia_min, 10))
                 else pp.minutos end) > 0;
  end if;

  return jsonb_build_object('status', p_status, 'pontos_ajustados', v_ajustados, 'nao_aplicados', v_erros);
end $function$;

CREATE OR REPLACE FUNCTION public.rh_espelho(p_org_id uuid, p_colaborador_id uuid, p_competencia date, p_ini date DEFAULT NULL::date, p_fim date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ini date; v_fim date; v_dias jsonb := '[]'::jsonb; d date;
  c record; j rh_jornada; p rh_ponto; v_marc jsonb; v_fer record; v_just record;
  v_saldo_dia int; v_abono int; v_aviso int; v_tol int; v_absorvido int;
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
end $function$;

CREATE OR REPLACE FUNCTION public.rh_fechamento_linha_calc(p_colaborador_id uuid, p_ini date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c record; j rh_jornada; d date;
  v_hn int := 0; v_h50 int := 0; v_h100 int := 0; v_falta int := 0; v_pend int := 0; v_edit timestamptz;
  v_carga int; v_trab int; v_esp boolean; v_ab boolean; v_100 boolean; v_extra int;
  v_status text; v_upd timestamptz; v_dias int := 0; v_esperados int := 0;
  v_abono int; v_aviso int; v_origem text; v_i_norm int; v_i_deb int; v_i_falt int; v_i_50 int; v_i_100 int;
  v_tol int; v_saldo int;
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
end $function$;

notify pgrst, 'reload schema';
