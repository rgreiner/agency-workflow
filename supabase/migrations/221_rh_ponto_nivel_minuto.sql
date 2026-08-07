-- 221_rh_ponto_nivel_minuto.sql
-- Pedido do RH (07/08): o ponto passa a trabalhar NO NÍVEL DO MINUTO, como o
-- mercado (Pontomais incluso). A marcação guardava os segundos e a conta usava
-- eles, mas a tela só mostra HH:MM — quem bateu 08:40:59 via "08:40" e mesmo
-- assim caía fora da tolerância de 10 min (a conta via 10min59s). Regra nova:
-- o segundo é DESCARTADO na marcação (08:40:59 = 08:40 → dentro da tolerância;
-- 18:10:59 = 18:10 → também dentro, não vira extra).
--
-- Três lugares faziam conta com segundo:
--   · rh_bater_ponto  → grava a hora truncada no minuto (a trava de duplo
--                       clique passa a usar created_at, que segue no relógio
--                       real — duas horas truncadas podem distar 1 min com 2s
--                       reais entre os cliques)
--   · rh_recalc_ponto → soma minuto a minuto (defensivo: vale até para
--                       marcação antiga que ainda tenha segundos gravados)
--   · rh_ponto_gate   → almoço de 1h e tempo decorrido no nível do minuto
--
-- rh_bater_entrada_retro já truncava (date_trunc 'minute'). Dia importado do
-- Pontomais não é tocado (origem <> null = congelado; o relatório deles já é
-- HH:MM). Backfill: marcações vivas perdem os segundos e são recalculadas.
-- Idempotente.

-- Minuto do dia de uma hora, descartando os segundos (08:40:59 → 520).
create or replace function rh_min_do_dia(t time)
returns int language sql immutable as $$
  select extract(hour from t)::int * 60 + extract(minute from t)::int
$$;
revoke execute on function rh_min_do_dia(time) from public, anon;

-- ── Bater ponto: hora truncada no minuto ─────────────────────────────────────
create or replace function rh_bater_ponto(p_colaborador_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_org uuid; v_hoje date; v_agora time; p rh_ponto; v_n int; v_ult timestamptz;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador_id;
  if v_org is null then raise exception 'Colaborador não encontrado'; end if;
  if not (rh_is_self(p_colaborador_id) or rh_can(v_org)) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  v_hoje  := (now() at time zone 'America/Sao_Paulo')::date;
  -- O segundo morre aqui: o ponto é no nível do minuto, como o mercado.
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

  insert into rh_marcacao (ponto_id, hora, seq) values (p.id, v_agora, v_n + 1);
  perform rh_recalc_ponto(p.id);

  select * into p from rh_ponto where id = p.id;
  return jsonb_build_object(
    'hora', v_agora, 'seq', v_n + 1,
    'aberto', (v_n + 1) % 2 = 1,
    'minutos', p.minutos, 'saldo_min', p.saldo_min,
    'intervalo_maior_min', p.intervalo_maior_min, 'intervalo_ok', p.intervalo_ok);
end; $$;
revoke execute on function rh_bater_ponto(uuid) from public;
grant execute on function rh_bater_ponto(uuid) to authenticated;

-- ── Recalc: soma minuto a minuto (corpo da 167, só a aritmética muda) ────────
create or replace function rh_recalc_ponto(p_ponto_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  p rh_ponto; j rh_jornada; v_min int := 0; v_carga int; v_abona boolean; v_fcarga int;
  v_maior int := 0; v_n int; v_ini time; v_fim time; v_ant time; r record; v_i int := 0;
  v_saldo int; v_tol int;
begin
  select * into p from rh_ponto where id = p_ponto_id;
  if p.id is null then return; end if;
  if p.origem is not null then return; end if;   -- histórico importado é congelado
  j := rh_jornada_de(p.colaborador_id);

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
end; $$;
revoke execute on function rh_recalc_ponto(uuid) from public;
grant execute on function rh_recalc_ponto(uuid) to authenticated;

-- ── Gate: almoço de 1h e tempo decorrido no nível do minuto (corpo da 217) ───
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

  select coalesce(
    (select j.dias_semana from rh_jornada j where j.colaborador_id = v_colab limit 1),
    (select j.dias_semana from rh_jornada j where j.org_id = v_org and j.colaborador_id is null limit 1),
    array[1,2,3,4,5]) into v_dias;
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
revoke execute on function rh_ponto_gate() from public, anon;
grant  execute on function rh_ponto_gate() to authenticated;

-- ── Backfill: marcações vivas perdem os segundos; dia importado não é tocado ─
update rh_marcacao m
   set hora = make_time(extract(hour from m.hora)::int, extract(minute from m.hora)::int, 0)
  from rh_ponto p
 where p.id = m.ponto_id and p.origem is null
   and m.hora <> make_time(extract(hour from m.hora)::int, extract(minute from m.hora)::int, 0);

-- Reprocessa os dias vivos com a régua nova (08:40:59 deixa de virar atraso).
do $$ declare r record; begin
  for r in select id from rh_ponto where origem is null loop perform rh_recalc_ponto(r.id); end loop;
end $$;

notify pgrst, 'reload schema';
