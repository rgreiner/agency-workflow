-- 168_rh_jornada_tolerancia.sql
-- rh_upsert_jornada passa a gravar tolerancia_min (a 160 nem conhecia o campo,
-- então a tolerância editada na tela era descartada em silêncio). Idempotente.
create or replace function rh_upsert_jornada(p_org_id uuid, p_colaborador_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid;
  v_ent time; v_ii time; v_if time; v_sai time; v_flex int; v_carga int; v_dias int[]; v_tol int;
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

  if p_colaborador_id is null then
    select id into v_id from rh_jornada where org_id = p_org_id and colaborador_id is null;
  else
    select id into v_id from rh_jornada where colaborador_id = p_colaborador_id;
  end if;

  if v_id is null then
    insert into rh_jornada (org_id, colaborador_id, entrada, intervalo_ini, intervalo_fim, saida, carga_min, flex_min, tolerancia_min, dias_semana)
    values (p_org_id, p_colaborador_id, v_ent, v_ii, v_if, v_sai, v_carga, v_flex, v_tol, v_dias)
    returning id into v_id;
  else
    update rh_jornada set
      entrada = v_ent, intervalo_ini = v_ii, intervalo_fim = v_if, saida = v_sai,
      carga_min = v_carga, flex_min = v_flex, tolerancia_min = v_tol, dias_semana = v_dias, updated_at = now()
    where id = v_id;
  end if;

  -- A tolerância muda o saldo: reprocessa os dias vivos afetados.
  if p_colaborador_id is null then
    perform rh_recalc_ponto(p.id) from rh_ponto p
     where p.org_id = p_org_id and p.origem is null
       and not exists (select 1 from rh_jornada j where j.colaborador_id = p.colaborador_id);
  else
    perform rh_recalc_ponto(p.id) from rh_ponto p
     where p.colaborador_id = p_colaborador_id and p.origem is null;
  end if;

  return v_id;
end; $$;
revoke execute on function rh_upsert_jornada(uuid, uuid, jsonb) from public;
grant execute on function rh_upsert_jornada(uuid, uuid, jsonb) to authenticated;
notify pgrst, 'reload schema';
