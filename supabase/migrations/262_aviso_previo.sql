-- 262_aviso_previo.sql
-- AVISO PRÉVIO TRABALHADO (art. 488 da CLT) como regra da FICHA — nada de
-- abonar dia a dia (pedido do Rafael, 27/08; caso real: Luiza Boschirolli em
-- aviso, último dia 20/09).
--
-- No aviso trabalhado o empregado escolhe UMA das opções:
--   • 'reducao_2h'     → jornada reduz 2h por dia durante todo o aviso;
--   • 'ultima_semana'  → trabalha jornada cheia e é dispensado dos últimos
--                        7 dias corridos.
--
-- Modelagem: `aviso_previo_ini` + `aviso_previo_modo` na ficha; o FIM do
-- aviso é a própria `data_demissao` (último dia). A redução da carga vive num
-- helper ÚNICO (`rh_aviso_reducao_min`) enxertado nos três pontos que
-- calculam carga — rh_esperado_min, rh_espelho e rh_fechamento_linha_calc —
-- porque toda divergência dessa família nasceu de régua copiada (migs.
-- 259/260). A marcação real nunca muda; o que muda é o ESPERADO do dia.

alter table rh_colaborador add column if not exists aviso_previo_ini  date;
alter table rh_colaborador add column if not exists aviso_previo_modo text;
alter table rh_colaborador drop constraint if exists rh_colaborador_aviso_modo_ck;
alter table rh_colaborador add constraint rh_colaborador_aviso_modo_ck
  check (aviso_previo_modo is null or aviso_previo_modo in ('reducao_2h', 'ultima_semana'));

-- ── A régua, num lugar só (helper interno — revoke geral) ───────────────────
create or replace function rh_aviso_reducao_min(p_colaborador uuid, p_data date, p_carga int)
returns int language sql stable security definer set search_path to 'public' as $$
  select case
    when c.aviso_previo_modo is null or c.aviso_previo_ini is null or c.data_demissao is null then 0
    when p_data < c.aviso_previo_ini or p_data > c.data_demissao then 0
    when c.aviso_previo_modo = 'reducao_2h' then least(120, p_carga)
    when c.aviso_previo_modo = 'ultima_semana' and p_data >= c.data_demissao - 6 then p_carga
    else 0 end
  from rh_colaborador c where c.id = p_colaborador;
$$;
revoke execute on function rh_aviso_reducao_min(uuid, date, int) from public, anon, authenticated;

-- ── rh_esperado_min: o aviso sai da carga antes do abono ────────────────────
create or replace function rh_esperado_min(p_colaborador uuid, p_data date)
returns integer language plpgsql stable security definer set search_path to 'public' as $$
declare
  j rh_jornada; v_carga int; v_bate boolean; v_org uuid; v_abona boolean; v_fer_carga int;
begin
  select org_id, bate_ponto into v_org, v_bate from rh_colaborador where id = p_colaborador;
  if v_org is null then return 0; end if;
  -- Sócio/cargo de confiança: sem jornada a cumprir.
  if not coalesce(v_bate, true) then return 0; end if;
  -- Fora do vínculo: a pessoa não devia nada porque ainda não estava aqui.
  if not rh_no_vinculo(p_colaborador, p_data) then return 0; end if;

  j := rh_jornada_de(p_colaborador);
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
end $$;

-- ── rh_upsert_colaborador ganha os campos do aviso ──────────────────────────
create or replace function rh_upsert_colaborador(p_org_id uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if coalesce(nullif(p_data->>'nome',''), '') = '' then raise exception 'Nome é obrigatório'; end if;

  if p_id is null then
    insert into rh_colaborador (org_id, nome, cpf, email, telefone, cargo, tipo_vinculo,
      data_admissao, data_demissao, status, gestor_id, membro_user_id, salario_atual,
      beneficios_mensal, custo_projetado_mensal, aviso_previo_ini, aviso_previo_modo, observacao, created_by)
    values (p_org_id,
      p_data->>'nome', nullif(p_data->>'cpf',''), nullif(p_data->>'email',''), nullif(p_data->>'telefone',''),
      nullif(p_data->>'cargo',''), nullif(p_data->>'tipo_vinculo',''),
      nullif(p_data->>'data_admissao','')::date, nullif(p_data->>'data_demissao','')::date,
      coalesce(nullif(p_data->>'status',''), 'ativo'),
      nullif(p_data->>'gestor_id','')::uuid, nullif(p_data->>'membro_user_id','')::uuid,
      nullif(p_data->>'salario_atual','')::numeric,
      coalesce(nullif(p_data->>'beneficios_mensal','')::numeric, 0),
      nullif(p_data->>'custo_projetado_mensal','')::numeric,
      nullif(p_data->>'aviso_previo_ini','')::date,
      nullif(p_data->>'aviso_previo_modo',''),
      nullif(p_data->>'observacao',''), auth.uid())
    returning id into v_id;
  else
    update rh_colaborador set
      nome = p_data->>'nome', cpf = nullif(p_data->>'cpf',''), email = nullif(p_data->>'email',''),
      telefone = nullif(p_data->>'telefone',''), cargo = nullif(p_data->>'cargo',''),
      tipo_vinculo = nullif(p_data->>'tipo_vinculo',''),
      data_admissao = nullif(p_data->>'data_admissao','')::date,
      data_demissao = nullif(p_data->>'data_demissao','')::date,
      status = coalesce(nullif(p_data->>'status',''), status),
      gestor_id = nullif(p_data->>'gestor_id','')::uuid,
      membro_user_id = nullif(p_data->>'membro_user_id','')::uuid,
      salario_atual = nullif(p_data->>'salario_atual','')::numeric,
      beneficios_mensal = coalesce(nullif(p_data->>'beneficios_mensal','')::numeric, beneficios_mensal),
      custo_projetado_mensal = case when p_data ? 'custo_projetado_mensal'
                                    then nullif(p_data->>'custo_projetado_mensal','')::numeric
                                    else custo_projetado_mensal end,
      aviso_previo_ini  = case when p_data ? 'aviso_previo_ini'
                               then nullif(p_data->>'aviso_previo_ini','')::date
                               else aviso_previo_ini end,
      aviso_previo_modo = case when p_data ? 'aviso_previo_modo'
                               then nullif(p_data->>'aviso_previo_modo','')
                               else aviso_previo_modo end,
      observacao = nullif(p_data->>'observacao',''), updated_at = now()
    where id = p_id and org_id = p_org_id
    returning id into v_id;
    if v_id is null then raise exception 'Colaborador não encontrado'; end if;
  end if;
  return v_id;
end; $$;

-- ── rh_fechamento_linha_calc: o aviso reduz a carga (antes do abono) ────────
create or replace function rh_fechamento_linha_calc(p_colaborador_id uuid, p_ini date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
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
revoke execute on function rh_fechamento_linha_calc(uuid, date, date) from public, anon, authenticated;

-- ── rh_espelho: idem, e o dia carrega 'aviso_min' para a tela explicar ──────
create or replace function rh_espelho(p_org_id uuid, p_colaborador_id uuid, p_competencia date, p_ini date default null, p_fim date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
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
end $$;
revoke execute on function rh_espelho(uuid, uuid, date, date, date) from public, anon;
grant  execute on function rh_espelho(uuid, uuid, date, date, date) to authenticated;

notify pgrst, 'reload schema';
