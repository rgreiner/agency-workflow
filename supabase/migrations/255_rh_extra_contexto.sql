-- 255_rh_extra_contexto.sql
-- CONTEXTO DA HORA EXTRA NA HORA EM QUE ELA NASCE
--
-- A aprovação (rh/ponto) já mostra previsto × batido, mas o MOTIVO só existia
-- quando vinha do Pontomais (rh_ponto.motivo, mig. 164) ou de justificativa
-- avulsa. Agora, quando a batida fecha o dia acima da jornada, o app pergunta
-- na hora — motivo + tarefa/campanha (rh_ponto.extra_projeto, parado desde a
-- 150) — e isso aparece para o gestor decidir.
--
-- Duas peças:
--   1) rh_bater_ponto devolve o estado da extra do dia (extra_status +
--      tem_contexto) — o gatilho do front. Mesma assinatura: PostgREST
--      self-hosted não aceita overload.
--   2) rh_extra_contexto: o caminho ESTREITO de escrita do colaborador.
--      rh_ponto só tem escrita do RH (mig. 194); aqui ele grava motivo e
--      projeto da PRÓPRIA extra pendente — nunca hora, nunca status.

-- ── 1) rh_bater_ponto: retorno ganha o estado da extra ──────────────────────
create or replace function rh_bater_ponto(
  p_colaborador_id uuid,
  p_lat numeric default null, p_lon numeric default null,
  p_ip text default null, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_org uuid; v_hoje date; v_agora time; p rh_ponto; v_n int; v_ult timestamptz;
  v_local uuid; v_fora boolean; v_exige boolean;
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

  -- Só classifica quando a org cadastrou algum local; sem cadastro, ninguém
  -- vira "fora" (senão ligar a migration marcaria o time inteiro).
  select exists (select 1 from rh_local where org_id = v_org and ativo) into v_exige;
  v_local := case when v_exige then rh_local_de(v_org, p_ip, p_lat, p_lon) end;
  v_fora  := v_exige and v_local is null;

  insert into rh_marcacao (ponto_id, hora, seq, lat, lon, ip, local_id, fora, fora_status, fora_motivo)
  values (p.id, v_agora, v_n + 1, p_lat, p_lon, nullif(btrim(coalesce(p_ip, '')), ''), v_local,
          v_fora, case when v_fora then 'pendente' end,
          case when v_fora then nullif(btrim(coalesce(p_motivo, '')), '') end);

  -- A batida fora CONTA: o recálculo roda igual. A revisão é do RH, depois.
  perform rh_recalc_ponto(p.id);

  select * into p from rh_ponto where id = p.id;
  return jsonb_build_object(
    'hora', v_agora, 'seq', v_n + 1,
    'aberto', (v_n + 1) % 2 = 1,
    'fora', coalesce(v_fora, false),
    'local', (select nome from rh_local where id = v_local),
    'minutos', p.minutos, 'saldo_min', p.saldo_min,
    'intervalo_maior_min', p.intervalo_maior_min, 'intervalo_ok', p.intervalo_ok,
    -- Estado da extra do dia: o front pergunta o contexto quando a batida
    -- FECHOU o período (aberto=false), a extra pende e ainda não há contexto.
    'extra_status', p.extra_status,
    'tem_contexto', (p.motivo is not null or p.extra_projeto is not null));
end $$;
revoke execute on function rh_bater_ponto(uuid, numeric, numeric, text, text) from public, anon;
grant  execute on function rh_bater_ponto(uuid, numeric, numeric, text, text) to authenticated;

-- ── 2) Contexto da extra pelo próprio colaborador ───────────────────────────
-- Só enquanto a extra PENDE (o contexto serve à decisão do gestor); chamar de
-- novo sobrescreve — bateu, respondeu, reabriu à noite e fechou maior: o novo
-- contexto vale. Tarefa precisa ser da MESMA org (activities → campaigns →
-- workspaces.org_id).
create or replace function rh_extra_contexto(
  p_colaborador_id uuid, p_data date,
  p_motivo text default null, p_projeto uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare p rh_ponto;
begin
  select * into p from rh_ponto where colaborador_id = p_colaborador_id and data = p_data;
  if p.id is null then raise exception 'Dia sem ponto registrado'; end if;
  if not (rh_is_self(p_colaborador_id) or rh_can(p.org_id)) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if p.extra_status is distinct from 'pendente' then
    raise exception 'Não há hora extra pendente neste dia';
  end if;
  if coalesce(btrim(p_motivo), '') = '' and p_projeto is null then
    raise exception 'Informe o motivo ou a tarefa';
  end if;
  if p_projeto is not null and not exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    where a.id = p_projeto and w.org_id = p.org_id
  ) then raise exception 'Tarefa inválida'; end if;

  update rh_ponto
     set motivo = nullif(btrim(coalesce(p_motivo, '')), ''),
         extra_projeto = p_projeto,
         updated_at = now()
   where id = p.id;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function rh_extra_contexto(uuid, date, text, uuid) from public, anon;
grant  execute on function rh_extra_contexto(uuid, date, text, uuid) to authenticated;

notify pgrst, 'reload schema';
