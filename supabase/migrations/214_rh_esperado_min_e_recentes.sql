-- 214_rh_esperado_min_e_recentes.sql
-- "Na tela meu ponto ainda 0h-39." (Rafael, 05/08)
--
-- A régua nova (212/213) valeu para o espelho e para o fechamento, que
-- calculam o dia. A tela "Meu ponto" não calcula nada: lê `rh_ponto.saldo_min`
-- direto da tabela — o número gravado quando o ponto foi batido, que não
-- conhece feriado, emenda nem decisão do RH. Por isso continuava -0h39.
--
-- Duas telas mostrando saldos diferentes do mesmo dia é pior do que uma errada:
-- ninguém sabe em qual acreditar. Então a carga esperada do dia vira UMA função
-- (rh_esperado_min), e a tela passa a ler por uma RPC que a usa.
--
-- rh_esperado_min concentra o que estava espalhado: dia de jornada, dispensa de
-- bater ponto (209), feriado que abona (162), emenda a que a pessoa aderiu
-- (205) e abono do período justificado (212).
--
-- Idempotente.

create or replace function rh_esperado_min(p_colaborador uuid, p_data date)
returns int language plpgsql stable security definer set search_path to 'public' as $$
declare
  j rh_jornada; v_carga int; v_bate boolean; v_org uuid; v_abona boolean; v_fer_carga int;
begin
  select org_id, bate_ponto into v_org, v_bate from rh_colaborador where id = p_colaborador;
  if v_org is null then return 0; end if;
  -- Sócio/cargo de confiança: sem jornada a cumprir.
  if not coalesce(v_bate, true) then return 0; end if;

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

  -- Abono do período justificado sai por último: incide sobre a carga que
  -- sobrou, nunca sobre um dia que já não exigia nada.
  return greatest(0, v_carga - rh_abono_min(p_colaborador, p_data, v_carga));
end $$;
revoke execute on function rh_esperado_min(uuid, date) from public, anon;
grant  execute on function rh_esperado_min(uuid, date) to authenticated;

-- ── Últimos dias da tela "Meu ponto" ───────────────────────────────────────
-- Mesma régua do espelho. Dia importado do Pontomais mantém a apuração deles
-- (mig. 206) — não se recalcula histórico congelado.
create or replace function rh_ponto_recentes(p_colaborador uuid, p_limite int default 15)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_out jsonb := '[]'::jsonb; r record; v_esp int; v_saldo int;
begin
  if not (rh_is_self(p_colaborador) or rh_can((select org_id from rh_colaborador where id = p_colaborador))) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  for r in
    select p.*, (select coalesce(jsonb_agg(to_char(m.hora, 'HH24:MI') order by m.seq), '[]'::jsonb)
                   from rh_marcacao m where m.ponto_id = p.id) as marcacoes
      from rh_ponto p
     where p.colaborador_id = p_colaborador
     order by p.data desc
     limit greatest(1, coalesce(p_limite, 15))
  loop
    v_esp := rh_esperado_min(p_colaborador, r.data);
    if r.origem = 'pontomais' then
      v_saldo := coalesce(r.saldo_min, 0);
    elsif v_esp > 0 then
      v_saldo := coalesce(r.minutos, 0) - v_esp;
    else
      v_saldo := coalesce(r.saldo_min, 0);
    end if;

    v_out := v_out || jsonb_build_object(
      'data', r.data, 'entrada', r.entrada, 'intervalo_ini', r.intervalo_ini,
      'intervalo_fim', r.intervalo_fim, 'saida', r.saida,
      'minutos', coalesce(r.minutos, 0), 'saldo_min', v_saldo, 'esperado_min', v_esp,
      'acima_10h', coalesce(r.acima_10h, false), 'extra_status', r.extra_status,
      'ajuste_de', r.ajuste_de, 'ajuste_em', r.ajuste_em,
      'intervalo_maior_min', r.intervalo_maior_min, 'intervalo_ok', r.intervalo_ok,
      'marcacoes', r.marcacoes);
  end loop;
  return v_out;
end $$;
revoke execute on function rh_ponto_recentes(uuid, int) from public, anon;
grant  execute on function rh_ponto_recentes(uuid, int) to authenticated;

notify pgrst, 'reload schema';
