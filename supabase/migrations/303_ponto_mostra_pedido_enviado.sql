-- 303: a pessoa passa a VER que o pedido dela chegou ao RH (22/09/2026).
--
-- Pedido do Rafael: mandou o ajuste e o aviso continuava igual — "Falta uma
-- marcação em 21/09 · Pedir ajuste" —, como se nada tivesse sido feito. Quem
-- olha reenvia o mesmo pedido.
--
-- `rh_ponto_estado` agora diz, por dia, o que já foi pedido, e devolve a lista
-- do que está aguardando o RH. Dia já resolvido (marcação corrigida ou dia
-- abonado) sai do alerta: abonado continua com marcação ímpar e por isso
-- cobrava ajuste para sempre.

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

  -- Jornada em vigor HOJE (mig. 288) — antes, "limit 1" podia devolver a
  -- vigência antiga e a tela mostrava o horário de estagiária para uma CLT.
  select entrada, intervalo_ini, intervalo_fim, saida, flex_min into v_j
  from rh_jornada_de(v_colab);

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
      select jsonb_agg(jsonb_build_object('data', d.data, 'marcacoes', d.n, 'pedido', d.pedido) order by d.data desc)
        from (
          select p.data, count(m.id) as n,
                 -- O que a pessoa já pediu para este dia. 'pendente' = está com
                 -- o RH; 'rejeitado' = recusado, o dia continua aberto.
                 (select j.status from rh_justificativa j
                   where j.colaborador_id = v_colab
                     and p.data between j.data_ini and j.data_fim
                   order by (j.status = 'pendente') desc, j.created_at desc
                   limit 1) as pedido
            from rh_ponto p
            join rh_marcacao m on m.ponto_id = p.id
           where p.colaborador_id = v_colab
             and p.data < v_hoje
             and p.data >= v_hoje - 30
             -- Dia importado do Pontomais é congelado (mig. 206): a apuração
             -- deles já creditou as horas, não há o que ajustar aqui.
             and p.origem is null
             -- Resolvido pelo RH (marcação corrigida ou dia abonado): não há o
             -- que pedir. Dia abonado segue ímpar e ficava cobrando para sempre.
             and not exists (
               select 1 from rh_justificativa j
                where j.colaborador_id = v_colab
                  and p.data between j.data_ini and j.data_fim
                  and j.status in ('aprovado', 'abonado'))
           group by p.data
          having count(m.id) % 2 = 1
        ) d), '[]'::jsonb),
    -- O que a pessoa mandou e ainda está na mesa do RH. Sem isso ela reenvia o
    -- mesmo pedido: a tela pedia o ajuste de novo como se nada tivesse sido feito.
    'pedidos_pendentes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', j.id, 'data_ini', j.data_ini, 'data_fim', j.data_fim,
               'tipo', j.tipo, 'criado_em', j.created_at) order by j.data_ini desc)
        from rh_justificativa j
       where j.colaborador_id = v_colab and j.status = 'pendente'), '[]'::jsonb));
end $$;

notify pgrst, 'reload schema';
