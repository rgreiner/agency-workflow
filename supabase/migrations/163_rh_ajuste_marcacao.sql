-- 163_rh_ajuste_marcacao.sql
-- BUG: justificativa aprovada não corrigia a marcação. Quem bateu 9h37 mas chegou
-- 8h39 continuava com a entrada errada e ~58min de saldo negativo, mesmo após o RH
-- aprovar (a aprovação só gravava status em rh_justificativa; nada tocava rh_ponto).
--
-- Correção: a justificativa passa a CARREGAR as horas corretas e, ao ser aprovada,
-- o ajuste é aplicado ao ponto. A marcação ORIGINAL é preservada em rh_ponto.ajuste_de
-- (CLT/Portaria 671: não se apaga marcação — registra-se o ajuste e quem autorizou).
--
-- Também extrai o cálculo de minutos/saldo para rh_recalc_ponto(), usado tanto pelo
-- bater ponto quanto pelo ajuste — uma implementação só, sem risco de divergir.
-- Idempotente.

-- ── Horas corretas pedidas na justificativa (nulo = não pede ajuste de marcação) ──
alter table rh_justificativa add column if not exists hora_entrada       time;
alter table rh_justificativa add column if not exists hora_intervalo_ini time;
alter table rh_justificativa add column if not exists hora_intervalo_fim time;
alter table rh_justificativa add column if not exists hora_saida         time;

-- ── Trilha de auditoria do ajuste no ponto ──
alter table rh_ponto add column if not exists ajuste_de   jsonb;        -- marcações originais
alter table rh_ponto add column if not exists ajuste_por  uuid;         -- quem autorizou (RH)
alter table rh_ponto add column if not exists ajuste_em   timestamptz;
alter table rh_ponto add column if not exists ajuste_just_id uuid references rh_justificativa(id) on delete set null;

-- ── Recalcula minutos/saldo/extra de um ponto (fonte única da conta) ──
-- Carga esperada = 0 em feriado/emenda que abona e fora dos dias de jornada.
create or replace function rh_recalc_ponto(p_ponto_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  p rh_ponto; j rh_jornada; v_manha int; v_tarde int; v_min int; v_carga int; v_abona boolean;
begin
  select * into p from rh_ponto where id = p_ponto_id;
  if p.id is null then return; end if;
  j := rh_jornada_de(p.colaborador_id);

  if p.entrada is null or p.saida is null then
    -- Dia incompleto: não há jornada fechada para creditar.
    update rh_ponto set minutos = 0, saldo_min = 0, acima_10h = false, updated_at = now() where id = p.id;
    return;
  end if;

  v_manha := case when p.intervalo_ini is not null
                  then (extract(epoch from (p.intervalo_ini - p.entrada)) / 60)::int
                  else (extract(epoch from (p.saida - p.entrada)) / 60)::int end;
  v_tarde := case when p.intervalo_fim is not null
                  then (extract(epoch from (p.saida - p.intervalo_fim)) / 60)::int else 0 end;
  v_min := greatest(0, coalesce(v_manha, 0) + coalesce(v_tarde, 0));

  v_carga := coalesce(j.carga_min, 480);
  select abona into v_abona from rh_feriado where org_id = p.org_id and data = p.data;
  if (found and coalesce(v_abona, true))
     or not (extract(isodow from p.data)::int = any (coalesce(j.dias_semana, array[1,2,3,4,5])))
  then v_carga := 0; end if;

  update rh_ponto set
    minutos   = least(v_min, coalesce(j.max_dia_min, 600)),
    acima_10h = (v_min > coalesce(j.max_dia_min, 600)),
    saldo_min = least(v_min, coalesce(j.max_dia_min, 600)) - v_carga,
    extra_status = case
      when least(v_min, coalesce(j.max_dia_min, 600)) - v_carga > 0 then coalesce(extra_status, 'pendente')
      else extra_status end,
    updated_at = now()
  where id = p.id;
end; $$;
revoke execute on function rh_recalc_ponto(uuid) from public;
grant execute on function rh_recalc_ponto(uuid) to authenticated;

-- ── Bater ponto: agora delega a conta ao rh_recalc_ponto ──
create or replace function rh_bater_ponto(p_colaborador_id uuid, p_tipo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid; v_hoje date; v_agora time; j rh_jornada; p rh_ponto;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador_id;
  if v_org is null then raise exception 'Colaborador não encontrado'; end if;
  if not (rh_is_self(p_colaborador_id) or rh_can(v_org)) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  v_hoje  := (now() at time zone 'America/Sao_Paulo')::date;
  v_agora := (now() at time zone 'America/Sao_Paulo')::time;
  j := rh_jornada_de(p_colaborador_id);

  insert into rh_ponto (org_id, colaborador_id, data) values (v_org, p_colaborador_id, v_hoje)
    on conflict (colaborador_id, data) do nothing;
  select * into p from rh_ponto where colaborador_id = p_colaborador_id and data = v_hoje;

  if p_tipo = 'entrada' then
    if p.entrada is not null then raise exception 'Entrada já registrada hoje'; end if;
    update rh_ponto set entrada = v_agora, updated_at = now() where id = p.id;
  elsif p_tipo = 'intervalo_ini' then
    if p.entrada is null then raise exception 'Bata a entrada primeiro'; end if;
    if p.intervalo_ini is not null then raise exception 'Intervalo já iniciado'; end if;
    update rh_ponto set intervalo_ini = v_agora, updated_at = now() where id = p.id;
  elsif p_tipo = 'intervalo_fim' then
    if p.intervalo_ini is null then raise exception 'Inicie o intervalo primeiro'; end if;
    if p.intervalo_fim is not null then raise exception 'Retorno já registrado'; end if;
    if extract(epoch from (v_agora - p.intervalo_ini)) / 60 < coalesce(j.intervalo_min, 60) then
      raise exception 'Intervalo mínimo de % min. Aguarde para registrar o retorno.', coalesce(j.intervalo_min, 60);
    end if;
    update rh_ponto set intervalo_fim = v_agora, updated_at = now() where id = p.id;
  elsif p_tipo = 'saida' then
    if p.entrada is null then raise exception 'Bata a entrada primeiro'; end if;
    if p.saida is not null then raise exception 'Saída já registrada'; end if;
    update rh_ponto set saida = v_agora, updated_at = now() where id = p.id;
  else
    raise exception 'Tipo de marcação inválido';
  end if;

  perform rh_recalc_ponto(p.id);
  select * into p from rh_ponto where id = p.id;
  return jsonb_build_object('tipo', p_tipo, 'hora', v_agora, 'minutos', p.minutos, 'saldo_min', p.saldo_min, 'acima_10h', p.acima_10h);
end; $$;
revoke execute on function rh_bater_ponto(uuid,text) from public;
grant execute on function rh_bater_ponto(uuid,text) to authenticated;

-- ── RH decide a justificativa; aprovada COM hora corrigida → aplica no ponto ──
create or replace function rh_decidir_justificativa(p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  jt rh_justificativa; p rh_ponto; v_ajustados int := 0; d date; v_pede boolean;
begin
  select * into jt from rh_justificativa where id = p_id;
  if jt.id is null then raise exception 'Justificativa não encontrada'; end if;
  if not rh_can(jt.org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_status not in ('aprovado','rejeitado','abonado','falta') then raise exception 'Status inválido'; end if;

  update rh_justificativa set status = p_status, decidido_por = auth.uid(), decidido_em = now() where id = p_id;

  v_pede := (jt.hora_entrada is not null or jt.hora_intervalo_ini is not null
             or jt.hora_intervalo_fim is not null or jt.hora_saida is not null);

  -- Só ajusta a marcação quando aprovado E a pessoa informou a hora correta.
  if p_status = 'aprovado' and v_pede then
    d := jt.data_ini;
    while d <= jt.data_fim loop
      insert into rh_ponto (org_id, colaborador_id, data) values (jt.org_id, jt.colaborador_id, d)
        on conflict (colaborador_id, data) do nothing;
      select * into p from rh_ponto where colaborador_id = jt.colaborador_id and data = d;

      update rh_ponto set
        -- Guarda a marcação original UMA vez (ajuste posterior não sobrescreve a trilha).
        ajuste_de = coalesce(ajuste_de, jsonb_strip_nulls(jsonb_build_object(
          'entrada', entrada, 'intervalo_ini', intervalo_ini,
          'intervalo_fim', intervalo_fim, 'saida', saida))),
        entrada       = coalesce(jt.hora_entrada, entrada),
        intervalo_ini = coalesce(jt.hora_intervalo_ini, intervalo_ini),
        intervalo_fim = coalesce(jt.hora_intervalo_fim, intervalo_fim),
        saida         = coalesce(jt.hora_saida, saida),
        ajuste_por = auth.uid(), ajuste_em = now(), ajuste_just_id = p_id, updated_at = now()
      where id = p.id;

      perform rh_recalc_ponto(p.id);
      v_ajustados := v_ajustados + 1;
      d := d + 1;
    end loop;
  end if;

  return jsonb_build_object('status', p_status, 'pontos_ajustados', v_ajustados);
end; $$;
revoke execute on function rh_decidir_justificativa(uuid, text) from public;
grant execute on function rh_decidir_justificativa(uuid, text) to authenticated;

notify pgrst, 'reload schema';
