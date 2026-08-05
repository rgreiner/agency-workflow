-- 212_rh_abono_por_periodo.sql
-- Régua do abono, fechada com o Rafael no caso da Danielle em 04/08/2026.
--
-- Declaração de comparecimento: atendimento das 13:00 às 14:00.
-- Jornada: 8h30–12h e 13h30–18h. Marcações: 08:40:45 · 12:00 · 14:03 · 18:05.
--
--   08h40 → 12h00     −10 min   (atraso na entrada, conta)
--   13h00 → 14h00     abonado   (o período declarado)
--   14h03 → 18h05     −3 +5     (voltou 3 min depois do fim da consulta,
--                                ficou 5 a mais na saída)
--   ────────────────────────────
--   total             −8 min
--
-- O que a 208 fazia estava grosso: zerava TODO o saldo negativo do dia, então
-- perdoava junto o atraso da entrada e os 3 min da volta. Abonar não é
-- absolver o dia — é descontar da jornada exigida apenas o tempo que o
-- documento cobre. O resto continua sendo responsabilidade da pessoa.
--
-- Por isso a justificativa passa a guardar o PERÍODO da ausência: é o dado que
-- a declaração traz ("das 13:00 às 14:00") e o único que permite separar o que
-- é justificado do que não é.
--
-- Sem período informado (atestado do dia inteiro, falta justificada, período de
-- vários dias) o abono continua cobrindo a jornada toda daquele dia — que é o
-- comportamento certo para esses casos.
--
-- A marcação real NUNCA é alterada: 14:03 continua sendo 14:03 na tela. O que
-- muda é a carga exigida do dia.
--
-- Idempotente.

alter table rh_justificativa add column if not exists ausencia_ini time;
alter table rh_justificativa add column if not exists ausencia_fim time;

comment on column rh_justificativa.ausencia_ini is
  'Início do período coberto pelo documento (ex.: 13:00 da declaração). Nulo = dia inteiro.';

-- ── Minutos de JORNADA cobertos pelo abono, num dia ────────────────────────
-- Só conta a interseção do período declarado com os blocos de trabalho: a
-- consulta das 13:00 às 14:00 cai metade no intervalo de almoço dela (13:00–
-- 13:30), e aquilo não era jornada — abonar ali seria dar 30 min de presente.
create or replace function rh_abono_min(p_colaborador uuid, p_data date, p_carga int)
returns int language plpgsql stable security definer set search_path to 'public' as $$
declare
  j rh_jornada; v_just record; v_ini time; v_fim time; v_min int := 0;
begin
  select * into v_just
    from rh_justificativa x
   where x.colaborador_id = p_colaborador
     and p_data between x.data_ini and x.data_fim
     and x.status in ('aprovado', 'abonado')
   order by x.created_at desc limit 1;
  if not found then return 0; end if;

  -- Sem período, ou justificativa de vários dias: o dia inteiro é abonado.
  if v_just.ausencia_ini is null or v_just.ausencia_fim is null
     or v_just.data_ini <> v_just.data_fim then
    return coalesce(p_carga, 0);
  end if;
  if v_just.ausencia_fim <= v_just.ausencia_ini then return 0; end if;

  j := rh_jornada_de(p_colaborador);

  -- Bloco da manhã.
  v_ini := greatest(v_just.ausencia_ini, coalesce(j.entrada, '08:00'::time));
  v_fim := least(v_just.ausencia_fim, coalesce(j.intervalo_ini, '12:00'::time));
  if v_fim > v_ini then v_min := v_min + extract(epoch from (v_fim - v_ini))::int / 60; end if;

  -- Bloco da tarde.
  v_ini := greatest(v_just.ausencia_ini, coalesce(j.intervalo_fim, '13:00'::time));
  v_fim := least(v_just.ausencia_fim, coalesce(j.saida, '18:00'::time));
  if v_fim > v_ini then v_min := v_min + extract(epoch from (v_fim - v_ini))::int / 60; end if;

  return least(v_min, coalesce(p_carga, v_min));
end $$;
revoke execute on function rh_abono_min(uuid, date, int) from public, anon;
grant  execute on function rh_abono_min(uuid, date, int) to authenticated;

notify pgrst, 'reload schema';
