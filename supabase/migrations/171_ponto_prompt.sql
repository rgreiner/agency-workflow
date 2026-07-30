-- 171_ponto_prompt.sql
-- Lembrete preventivo de ponto (pedido do Rafael 31/07 — time migra pro ponto do
-- Flow na segunda-feira 03/08):
--   • card no app perto de cada horário da jornada ("hora de bater o ponto"),
--     abrindo ~10 min antes;
--   • se a pessoa JÁ está trabalhando (abriu tarefa) sem ponto aberto, oferecer
--     registrar a ENTRADA na hora em que ela começou — a hora do primeiro foco
--     do dia — confirmada por ela.
--
-- Duas RPCs, ambas resolvendo o colaborador pelo auth.uid() (nunca por parâmetro):
--   rh_ponto_estado()          → o que o card precisa pra decidir o que mostrar
--   rh_bater_entrada_retro()   → entrada retroativa TRAVADA no primeiro foco do dia

-- ── Estado do dia para o lembrete ────────────────────────────────────────────
create or replace function rh_ponto_estado()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid; v_colab uuid; v_org uuid; v_hoje date;
  v_marc text[]; v_j record; v_foco timestamptz;
begin
  v_uid := auth.uid();
  if v_uid is null then return null; end if;

  select id, org_id into v_colab, v_org
  from rh_colaborador
  where membro_user_id = v_uid and status = 'ativo'
  limit 1;
  if v_colab is null then return null; end if;  -- sem ficha vinculada → sem lembrete

  v_hoje := (now() at time zone 'America/Sao_Paulo')::date;

  select coalesce(array_agg(to_char(m.hora, 'HH24:MI') order by m.seq), '{}')
    into v_marc
  from rh_ponto p
  join rh_marcacao m on m.ponto_id = p.id
  where p.colaborador_id = v_colab and p.data = v_hoje;

  select entrada, intervalo_ini, intervalo_fim, saida, flex_min into v_j
  from rh_jornada
  where colaborador_id = v_colab or (org_id = v_org and colaborador_id is null)
  order by colaborador_id nulls last
  limit 1;

  -- primeiro sinal de trabalho de hoje (abertura de tarefa)
  select min(aberta_em) into v_foco
  from activity_focus
  where user_id = v_uid
    and aberta_em >= (v_hoje::timestamp at time zone 'America/Sao_Paulo');

  return jsonb_build_object(
    'colaborador_id', v_colab,
    'dia', v_hoje,
    'marcacoes', to_jsonb(v_marc),
    'jornada', jsonb_build_object(
      'entrada',       to_char(coalesce(v_j.entrada,       time '08:30'), 'HH24:MI'),
      'intervalo_ini', to_char(coalesce(v_j.intervalo_ini, time '12:00'), 'HH24:MI'),
      'intervalo_fim', to_char(coalesce(v_j.intervalo_fim, time '13:30'), 'HH24:MI'),
      'saida',         to_char(coalesce(v_j.saida,         time '18:00'), 'HH24:MI'),
      'flex_min',      coalesce(v_j.flex_min, 30)),
    'primeiro_foco', to_char(v_foco at time zone 'America/Sao_Paulo', 'HH24:MI'),
    'agora', to_char(now() at time zone 'America/Sao_Paulo', 'HH24:MI'));
end $$;
revoke execute on function rh_ponto_estado() from anon, authenticated, public;
grant execute on function rh_ponto_estado() to authenticated;

-- ── Entrada retroativa confirmada (travada no primeiro foco) ─────────────────
-- Só vale para a PRIMEIRA marcação do dia (entrada); a hora fica presa entre
-- [primeiro foco − 5 min] e agora. Não existe caminho para inventar horário:
-- sem foco registrado, não há retro. Marcação sai com origem='auto' (auditável).
create or replace function rh_bater_entrada_retro()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid; v_colab uuid; v_org uuid; v_hoje date; v_agora time;
  v_foco timestamptz; v_hora time; p rh_ponto; v_n int;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Acesso negado' using errcode = '42501'; end if;

  select id, org_id into v_colab, v_org
  from rh_colaborador where membro_user_id = v_uid and status = 'ativo' limit 1;
  if v_colab is null then raise exception 'Sua ficha não está vinculada ao login'; end if;

  v_hoje  := (now() at time zone 'America/Sao_Paulo')::date;
  v_agora := (now() at time zone 'America/Sao_Paulo')::time;

  select min(aberta_em) into v_foco
  from activity_focus
  where user_id = v_uid
    and aberta_em >= (v_hoje::timestamp at time zone 'America/Sao_Paulo');
  if v_foco is null then raise exception 'Nenhuma atividade aberta hoje — bata o ponto normal.'; end if;

  -- hora da entrada = primeiro foco (arredonda pro minuto, tolerância −5 min)
  v_hora := date_trunc('minute', v_foco at time zone 'America/Sao_Paulo')::time;
  if v_hora > v_agora then v_hora := v_agora; end if;

  insert into rh_ponto (org_id, colaborador_id, data) values (v_org, v_colab, v_hoje)
    on conflict (colaborador_id, data) do nothing;
  select * into p from rh_ponto where colaborador_id = v_colab and data = v_hoje;

  select count(*) into v_n from rh_marcacao where ponto_id = p.id;
  if v_n > 0 then raise exception 'O dia já tem marcação — a entrada retroativa só vale para a primeira.'; end if;

  insert into rh_marcacao (ponto_id, hora, seq, origem) values (p.id, v_hora, 1, 'auto');
  perform rh_recalc_ponto(p.id);

  return jsonb_build_object('hora', to_char(v_hora, 'HH24:MI'), 'aberto', true);
end $$;
revoke execute on function rh_bater_entrada_retro() from anon, authenticated, public;
grant execute on function rh_bater_entrada_retro() to authenticated;

notify pgrst, 'reload schema';
