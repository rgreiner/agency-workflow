-- 215_rh_abono_so_abonado.sql
-- Corrige um efeito colateral visto ao conferir a 214: o dia 03/08 da Danielle
-- ficou com carga esperada ZERO. A justificativa dele é 'aprovado' (esqueceu de
-- bater, o RH corrigiu a marcação para 08:40–18:13) e, sem período de ausência
-- informado, o rh_abono_min entendia "abona o dia inteiro".
--
-- Aprovar e abonar são atos diferentes:
--   · APROVADO  → a justificativa é aceita e a marcação é corrigida. O dia
--     conta normalmente, agora com o horário certo. Não há nada a perdoar.
--   · ABONADO   → a empresa perdoa o tempo não trabalhado: o período do
--     documento (ou o dia inteiro, se não houver período) sai da carga.
--
-- Tratar os dois como abono zerava a jornada de quem só tinha esquecido de
-- bater o ponto — e um dia de 8h07 aparecia como saldo zero.
--
-- Idempotente.

create or replace function rh_abono_min(p_colaborador uuid, p_data date, p_carga int)
returns int language plpgsql stable security definer set search_path to 'public' as $$
declare
  j rh_jornada; v_just record; v_ini time; v_fim time; v_min int := 0;
begin
  -- Só 'abonado'. 'aprovado' corrige a marcação e o dia segue exigindo jornada.
  select * into v_just
    from rh_justificativa x
   where x.colaborador_id = p_colaborador
     and p_data between x.data_ini and x.data_fim
     and x.status = 'abonado'
   order by x.created_at desc limit 1;
  if not found then return 0; end if;

  if v_just.ausencia_ini is null or v_just.ausencia_fim is null
     or v_just.data_ini <> v_just.data_fim then
    return coalesce(p_carga, 0);
  end if;
  if v_just.ausencia_fim <= v_just.ausencia_ini then return 0; end if;

  j := rh_jornada_de(p_colaborador);

  v_ini := greatest(v_just.ausencia_ini, coalesce(j.entrada, '08:00'::time));
  v_fim := least(v_just.ausencia_fim, coalesce(j.intervalo_ini, '12:00'::time));
  if v_fim > v_ini then v_min := v_min + extract(epoch from (v_fim - v_ini))::int / 60; end if;

  v_ini := greatest(v_just.ausencia_ini, coalesce(j.intervalo_fim, '13:00'::time));
  v_fim := least(v_just.ausencia_fim, coalesce(j.saida, '18:00'::time));
  if v_fim > v_ini then v_min := v_min + extract(epoch from (v_fim - v_ini))::int / 60; end if;

  return least(v_min, coalesce(p_carga, v_min));
end $$;

notify pgrst, 'reload schema';
