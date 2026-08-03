-- 167_rh_tolerancia.sql
-- BUG: chegar 1 min mais cedo virava "hora extra pendente de aprovação".
--
-- Faltava a TOLERÂNCIA diária. Ela é coisa diferente da flexibilidade:
--   · flex_min (±30)      = janela em que a pessoa PODE entrar (08:00–09:00).
--                            Diz respeito a horário, não a quantidade de horas.
--   · tolerancia_min (10) = variação no total do dia que NÃO vira extra nem débito.
--
-- Régua medida no histórico real do Pontomais (6 meses, 6 pessoas):
--   delta de -10 a +10 min → absorvido em 100% dos casos (0 creditados);
--   a partir de +11 min    → credita o valor CHEIO, não o excedente (73 casos, 0 exceções).
-- Isso é o art. 58 §1º da CLT (5 min por marcação, máx. 10/dia).
-- Idempotente.

alter table rh_jornada add column if not exists tolerancia_min int not null default 10;

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
        v_maior := greatest(v_maior, (extract(epoch from (v_ini - v_ant)) / 60)::int);
      end if;
    else
      v_fim := r.hora;
      v_min := v_min + greatest(0, (extract(epoch from (v_fim - v_ini)) / 60)::int);
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

-- Reprocessa os dias vivos: some a "extra" de 1 min que já estava na fila do gestor.
do $$ declare r record; begin
  for r in select id from rh_ponto where origem is null loop perform rh_recalc_ponto(r.id); end loop;
end $$;

notify pgrst, 'reload schema';
