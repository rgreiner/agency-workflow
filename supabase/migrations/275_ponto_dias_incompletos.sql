-- 275_ponto_dias_incompletos.sql
-- AVISO DE DIA SEM FECHAR (pedido do Rafael, 03/09): "quando a pessoa esqueceu
-- de bater e tem lançamento em número ímpar, poderia ter um botão dizendo peça
-- ajuste do horário faltante".
--
-- É pior do que parece e por isso merece aviso: com número ímpar de marcações
-- nenhum par fecha, e `rh_recalc_ponto` credita ZERO minuto no dia — a pessoa
-- perde o dia inteiro de horas. Medido em prod: 8 dias assim, 4 do próprio
-- Rafael (01/09, 02/09, 24/08, 17/08), todos com minutos = 0.
--
-- ⚠️ HOJE nunca entra na lista: marcação ímpar agora significa apenas que a
-- pessoa está DENTRO, trabalhando (é o estado normal da tarde). Só dia
-- passado é problema. Dia importado do Pontomais também fica fora: aquela
-- apuração é congelada e já creditou as horas (mig. 206).
--
-- Só leitura, dentro do estado que a home já consulta — nenhuma consulta nova.
-- Idempotente.

CREATE OR REPLACE FUNCTION public.rh_ponto_estado()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'agora', to_char(now() at time zone 'America/Sao_Paulo', 'HH24:MI'),
    -- Dias PASSADOS com marcação ímpar: alguém esqueceu de bater a saída e o
    -- dia não fecha nenhum par — o recálculo credita ZERO minuto (mig. 275).
    -- Hoje nunca entra: ímpar agora só quer dizer "está trabalhando".
    'dias_incompletos', coalesce((
      select jsonb_agg(jsonb_build_object('data', d.data, 'marcacoes', d.n) order by d.data desc)
        from (
          select p.data, count(m.id) as n
            from rh_ponto p
            join rh_marcacao m on m.ponto_id = p.id
           where p.colaborador_id = v_colab
             and p.data < v_hoje
             and p.data >= v_hoje - 30
             -- Dia importado do Pontomais é congelado (mig. 206): a apuração
             -- deles já creditou as horas, não há o que ajustar aqui.
             and p.origem is null
           group by p.data
          having count(m.id) % 2 = 1
        ) d), '[]'::jsonb));
end $function$;

notify pgrst, 'reload schema';
