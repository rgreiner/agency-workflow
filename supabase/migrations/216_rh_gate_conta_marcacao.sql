-- 216_rh_gate_conta_marcacao.sql
-- URGENTE. O Rafael ligou a trava do ponto e ela barrou o time INTEIRO —
-- inclusive quem já tinha batido a entrada às 8h30.
--
-- Causa: o gate perguntava `rh_ponto.entrada is not null`. Essa coluna é
-- derivada pelo rh_recalc_ponto e só é preenchida quando o dia tem número PAR
-- de marcações (ou seja, quando o par abriu e fechou). Quem bateu só a entrada
-- tem UMA marcação — ímpar — e a coluna fica nula até a saída para o almoço.
-- Resultado: das 8h30 ao meio-dia, todo mundo aparecia como "não bateu".
--
-- Medido em produção às 11h14 de 05/08: 9 pessoas com 1 marcação em
-- rh_marcacao e `entrada` nula; só a Isadora, que já tinha 2 marcações, passava.
--
-- A pergunta certa é "esta pessoa registrou alguma marcação hoje?", e isso se
-- responde em rh_marcacao — a fonte real das batidas. `entrada` é resumo, e
-- resumo em construção não serve de porteiro.
--
-- Idempotente.

create or replace function rh_ponto_gate()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid; v_colab uuid; v_org uuid; v_hoje date;
  v_obrig boolean; v_dias int[]; v_n int; v_abona boolean; v_bate boolean;
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

  v_hoje := (now() at time zone 'America/Sao_Paulo')::date;

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

  -- A pergunta é "bateu alguma vez hoje?" — conta a MARCAÇÃO, que existe desde
  -- a primeira batida, e não a coluna `entrada`, que é resumo do par fechado.
  select count(*) into v_n
    from rh_marcacao m
    join rh_ponto p on p.id = m.ponto_id
   where p.colaborador_id = v_colab and p.data = v_hoje;

  return jsonb_build_object('exige', v_n = 0, 'colaborador_id', v_colab);
end $$;
revoke execute on function rh_ponto_gate() from public, anon;
grant  execute on function rh_ponto_gate() to authenticated;

notify pgrst, 'reload schema';
