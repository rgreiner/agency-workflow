-- 292: a GRAVAÇÃO da jornada passa a respeitar a vigência (par da 288).
--
-- A 288 deu timeline à jornada, mas rh_upsert_jornada continuou fazendo
-- "select id ... where colaborador_id = X" — com duas vigências isso pega uma
-- linha qualquer e pode reescrever a jornada ANTIGA, que é justamente a que
-- sustenta o cálculo do passado. E rh_reset_jornada apagava TODAS as vigências,
-- jogando o histórico inteiro no padrão da org.
--
-- Agora: edita-se uma vigência por vez; sem data informada, a vigente hoje.

-- ── upsert ────────────────────────────────────────────────────────────────
create or replace function rh_upsert_jornada(p_org_id uuid, p_colaborador_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid;
  v_ent time; v_ii time; v_if time; v_sai time; v_flex int; v_carga int; v_dias int[]; v_tol int;
  v_vig date;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_colaborador_id is not null and not exists (
       select 1 from rh_colaborador where id = p_colaborador_id and org_id = p_org_id)
  then raise exception 'Colaborador inválido'; end if;

  v_ent  := coalesce(nullif(p_data->>'entrada','')::time,       time '08:30');
  v_ii   := coalesce(nullif(p_data->>'intervalo_ini','')::time, time '12:00');
  v_if   := coalesce(nullif(p_data->>'intervalo_fim','')::time, time '13:30');
  v_sai  := coalesce(nullif(p_data->>'saida','')::time,         time '18:00');
  v_flex := coalesce(nullif(p_data->>'flex_min','')::int, 30);
  v_tol  := greatest(0, coalesce(nullif(p_data->>'tolerancia_min','')::int, 10));
  v_dias := coalesce(
    (select array_agg(distinct (x)::int order by (x)::int) from jsonb_array_elements_text(p_data->'dias_semana') x),
    array[1,2,3,4,5]);
  v_carga := greatest(0,
    (extract(epoch from (v_ii - v_ent)) / 60)::int +
    (extract(epoch from (v_sai - v_if)) / 60)::int);

  -- Sem data: mexe na vigência que está valendo hoje (é o que a tela mostra).
  -- Nenhuma ainda: nasce em 1900 e vale para todo o histórico, como antes da 288.
  v_vig := nullif(p_data->>'vigencia_ini','')::date;
  if v_vig is null then
    if p_colaborador_id is null then
      select max(vigencia_ini) into v_vig from rh_jornada
       where org_id = p_org_id and colaborador_id is null and vigencia_ini <= v_hoje;
    else
      select max(vigencia_ini) into v_vig from rh_jornada
       where colaborador_id = p_colaborador_id and vigencia_ini <= v_hoje;
    end if;
    v_vig := coalesce(v_vig, date '1900-01-01');
  end if;

  if p_colaborador_id is null then
    select id into v_id from rh_jornada
     where org_id = p_org_id and colaborador_id is null and vigencia_ini = v_vig;
  else
    select id into v_id from rh_jornada
     where colaborador_id = p_colaborador_id and vigencia_ini = v_vig;
  end if;

  if v_id is null then
    insert into rh_jornada (org_id, colaborador_id, vigencia_ini, entrada, intervalo_ini, intervalo_fim, saida, carga_min, flex_min, tolerancia_min, dias_semana)
    values (p_org_id, p_colaborador_id, v_vig, v_ent, v_ii, v_if, v_sai, v_carga, v_flex, v_tol, v_dias)
    returning id into v_id;
  else
    update rh_jornada set
      entrada = v_ent, intervalo_ini = v_ii, intervalo_fim = v_if, saida = v_sai,
      carga_min = v_carga, flex_min = v_flex, tolerancia_min = v_tol, dias_semana = v_dias, updated_at = now()
    where id = v_id;
  end if;

  -- Reprocessa só o que esta vigência alcança: dia anterior a ela seguia outra
  -- régua e não pode ser tocado. Dia importado (origem não nula) nunca recalcula.
  if p_colaborador_id is null then
    perform rh_recalc_ponto(p.id) from rh_ponto p
     where p.org_id = p_org_id and p.origem is null and p.data >= v_vig
       and not exists (select 1 from rh_jornada j
                        where j.colaborador_id = p.colaborador_id and j.vigencia_ini <= p.data);
  else
    perform rh_recalc_ponto(p.id) from rh_ponto p
     where p.colaborador_id = p_colaborador_id and p.origem is null and p.data >= v_vig;
  end if;

  return v_id;
end; $$;

-- ── reset ─────────────────────────────────────────────────────────────────
-- "Voltar ao padrão" apagava tudo. Agora remove só a vigência em vigor e diz o
-- que passa a valer no lugar — para quem clica enxergar que existe um antes.
drop function if exists rh_reset_jornada(uuid);
create or replace function rh_reset_jornada(p_colaborador_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_org uuid; v_vig date; v_anterior date; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador_id;
  if v_org is null then return jsonb_build_object('ok', false); end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  select max(vigencia_ini) into v_vig from rh_jornada
   where colaborador_id = p_colaborador_id and vigencia_ini <= v_hoje;
  if v_vig is null then return jsonb_build_object('ok', true, 'removida', null); end if;

  delete from rh_jornada where colaborador_id = p_colaborador_id and vigencia_ini = v_vig;

  select max(vigencia_ini) into v_anterior from rh_jornada
   where colaborador_id = p_colaborador_id and vigencia_ini <= v_hoje;

  perform rh_recalc_ponto(p.id) from rh_ponto p
   where p.colaborador_id = p_colaborador_id and p.origem is null and p.data >= v_vig;

  return jsonb_build_object('ok', true, 'removida', v_vig, 'volta_para', v_anterior);
end; $$;

-- As duas são RPC de tela (chamadas pelo app com o JWT do usuário) e já se
-- defendem por rh_can(); os privilégios seguem os mesmos de antes.

notify pgrst, 'reload schema';
