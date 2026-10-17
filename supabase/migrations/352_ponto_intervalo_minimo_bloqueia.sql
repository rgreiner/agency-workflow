-- Ponto: o retorno do almoço antes de 1h é RECUSADO (revisa a regra de 03/08).
--
-- Antes: bater era livre e o almoço curto só ficava marcado (intervalo_ok=false)
-- para o RH revisar. Em 14/10/2026 a Isadora voltou do almoço em 7 min e os
-- 44 min viraram "hora extra pendente". Decisão do Rafael (17/10): não pode
-- permitir a pessoa trabalhar antes de fechar 1h de intervalo.
--
-- Corpo = o que estava no ar + a checagem. Correção de dia passado continua pelo
-- RH (rh_editar_ponto) e pela justificativa "esqueci".

create or replace function public.rh_bater_ponto(p_colaborador_id uuid, p_lat numeric DEFAULT NULL::numeric, p_lon numeric DEFAULT NULL::numeric, p_ip text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid; v_hoje date; v_agora time; p rh_ponto; v_n int; v_ult timestamptz;
  v_local uuid; v_fora boolean; v_exige boolean;
  v_ip text; v_grupo boolean := false; v_local_unico uuid;
  v_ultima time; v_almoco_feito boolean; v_libera time; v_jornada_longa boolean;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador_id;
  if v_org is null then raise exception 'Colaborador não encontrado'; end if;
  if not (rh_is_self(p_colaborador_id) or rh_can(v_org)) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  v_hoje  := (now() at time zone 'America/Sao_Paulo')::date;
  -- O segundo morre aqui: o ponto é no nível do minuto (mig. 221).
  v_agora := (now() at time zone 'America/Sao_Paulo')::time;
  v_agora := make_time(extract(hour from v_agora)::int, extract(minute from v_agora)::int, 0);

  insert into rh_ponto (org_id, colaborador_id, data) values (v_org, p_colaborador_id, v_hoje)
    on conflict (colaborador_id, data) do nothing;
  select * into p from rh_ponto where colaborador_id = p_colaborador_id and data = v_hoje;

  select count(*), max(created_at) into v_n, v_ult from rh_marcacao where ponto_id = p.id;

  -- Trava de duplo-clique: 1 minuto de relógio REAL entre marcações.
  if v_ult is not null and now() - v_ult < interval '1 minute' then
    raise exception 'Você acabou de registrar uma marcação. Aguarde um instante.';
  end if;

  -- ── Intervalo mínimo de 1h (CLT art. 71) — REGRA DO RAFAEL, 17/10/2026 ─────
  -- Retorno (marcação ímpar ≥ 3) só é aceito depois de 1h fora, enquanto o
  -- almoço de 1h ainda não foi feito no dia. Revisa a decisão de 03/08 (que só
  -- marcava para o RH): a Isadora voltou em 7 min (14/10) e o almoço não feito
  -- virou "hora extra pendente". Pausa depois do almoço segue livre; jornada
  -- contratada de até 6h (estágio) fica fora — a CLT não exige 1h nela.
  -- A carga é a da JORNADA CONTRATADA (vigente no dia), não a do dia: sábado e
  -- feriado têm carga zero e desligariam a regra justo para quem trabalha 8h neles.
  select extract(epoch from (j.saida - j.entrada) - (j.intervalo_fim - j.intervalo_ini)) / 60 > 360
    into v_jornada_longa
    from rh_jornada j
   where (j.colaborador_id = p_colaborador_id or j.colaborador_id is null) and j.org_id = v_org
     and j.vigencia_ini <= v_hoje
   order by (j.colaborador_id is null), j.vigencia_ini desc
   limit 1;
  if v_n >= 2 and v_n % 2 = 0 and coalesce(v_jornada_longa, true) then
    select hora into v_ultima from rh_marcacao where ponto_id = p.id and seq = v_n;
    select coalesce(bool_or(s.hora - e.hora >= interval '60 minutes'), false) into v_almoco_feito
      from rh_marcacao e join rh_marcacao s on s.ponto_id = e.ponto_id and s.seq = e.seq + 1
     where e.ponto_id = p.id and e.seq % 2 = 0 and s.seq <= v_n;
    if not v_almoco_feito and v_agora - v_ultima < interval '60 minutes' then
      v_libera := v_ultima + interval '60 minutes';
      raise exception 'Intervalo mínimo de 1h: seu retorno fica liberado às %.', to_char(v_libera, 'HH24:MI')
        using errcode = 'P0001';
    end if;
  end if;

  -- Só classifica quando a org cadastrou algum local; sem cadastro, ninguém
  -- vira "fora" (senão ligar a migration marcaria o time inteiro).
  select exists (select 1 from rh_local where org_id = v_org and ativo) into v_exige;
  v_local := case when v_exige then rh_local_de(v_org, p_ip, p_lat, p_lon) end;
  v_fora  := v_exige and v_local is null;
  v_ip    := nullif(btrim(coalesce(p_ip, '')), '');

  insert into rh_marcacao (ponto_id, hora, seq, lat, lon, ip, local_id, fora, fora_status, fora_motivo)
  values (p.id, v_agora, v_n + 1, p_lat, p_lon, v_ip, v_local,
          v_fora, case when v_fora then 'pendente' end,
          case when v_fora then nullif(btrim(coalesce(p_motivo, '')), '') end);

  -- ── Rede reconhecida pelo GRUPO ───────────────────────────────────────────
  -- 3 pessoas diferentes no mesmo IP no mesmo dia é o escritório, mesmo sem
  -- cadastro. A contagem roda DEPOIS do insert, então a 3ª pessoa do dia já
  -- entra reconhecida — e as duas primeiras, que caíram como "fora" antes de
  -- existir grupo, são reclassificadas junto. Decisão do RH já tomada
  -- (aprovado/rejeitado) não é tocada.
  if v_fora and v_ip is not null and rh_pessoas_no_ip(v_org, v_hoje, v_ip) >= 3 then
    -- Um único local ativo: a batida fica amarrada a ele. Com mais de um, não
    -- dá pra saber qual — fica sem local, só com o reconhecimento registrado.
    select l.id into v_local_unico from rh_local l
     where l.org_id = v_org and l.ativo
       and (select count(*) from rh_local x where x.org_id = v_org and x.ativo) = 1;

    update rh_marcacao m
       set fora = false, fora_status = null, reconhecido_por = 'grupo',
           local_id = coalesce(m.local_id, v_local_unico)
      from rh_ponto pt
     where pt.id = m.ponto_id and pt.org_id = v_org and pt.data = v_hoje
       and m.ip is not null and btrim(m.ip) = v_ip
       and m.fora and m.fora_status = 'pendente';

    v_fora := false; v_grupo := true;
  end if;

  -- A batida fora CONTA: o recálculo roda igual. A revisão é do RH, depois.
  perform rh_recalc_ponto(p.id);

  select * into p from rh_ponto where id = p.id;
  return jsonb_build_object(
    'hora', v_agora, 'seq', v_n + 1,
    'aberto', (v_n + 1) % 2 = 1,
    'fora', coalesce(v_fora, false),
    'local', (select nome from rh_local where id = coalesce(v_local, v_local_unico)),
    -- 'grupo' = a rede foi reconhecida pela equipe, não pelo cadastro.
    'reconhecido_por', case when v_grupo then 'grupo' end,
    'minutos', p.minutos, 'saldo_min', p.saldo_min,
    'intervalo_maior_min', p.intervalo_maior_min, 'intervalo_ok', p.intervalo_ok,
    -- Estado da extra do dia: o front pergunta o contexto quando a batida
    -- FECHOU o período (aberto=false), a extra pende e ainda não há contexto.
    'extra_status', p.extra_status,
    'tem_contexto', (p.motivo is not null or p.extra_projeto is not null));
end $function$;

revoke execute on function rh_bater_ponto(uuid, numeric, numeric, text, text) from public, anon;
grant execute on function rh_bater_ponto(uuid, numeric, numeric, text, text) to authenticated;

notify pgrst, 'reload schema';
