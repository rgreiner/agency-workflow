-- 217_rh_gate_por_periodo.sql
-- A trava passa a seguir o ESTADO do ponto, não "bateu alguma vez hoje".
-- Régua do Rafael (05/08):
--
--   · vou abrir o Flow e ainda não abri o ponto      → tela de bater
--   · estou no intervalo e ainda não deu 1h          → avisa, mas deixa entrar
--   · deu 1h                                         → tela de bater a volta
--   · fechei o ponto e precisei voltar a uma demanda → nova janela de ponto
--
-- O modelo anterior liberava o dia inteiro depois da primeira batida: quem
-- fechava às 12h e voltava às 14h passava o intervalo com o Flow aberto, e o
-- retorno à noite não pedia nada.
--
-- Ponto ABERTO (número ímpar de marcações) = a pessoa está dentro, nada a
-- pedir. Ponto FECHADO (par) = está fora, e para trabalhar precisa reabrir.
--
-- A exceção é o intervalo: enquanto ele não fecha 1h e o almoço do dia ainda
-- não aconteceu, a tela AVISA em vez de bloquear (decisão do Rafael). Bloquear
-- ali seria uma parede sem porta — a pessoa não pode bater a volta sem
-- estourar o intervalo mínimo, e ficaria presa. Quem voltar antes da hora
-- aparece no espelho com "almoço <1h", que é onde o RH revisa.
--
-- "Almoço já cumprido" = já houve no dia um intervalo fechado de 60+ min. A
-- partir daí as pausas são curtas por natureza e o gate volta a pedir batida.
--
-- Idempotente.

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
       and extract(epoch from (x.prox - x.hora)) / 60 >= 60
  ) into v_teve_almoco;

  v_decorrido := greatest(0, (extract(epoch from (v_agora - v_ult)) / 60)::int);

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

notify pgrst, 'reload schema';
