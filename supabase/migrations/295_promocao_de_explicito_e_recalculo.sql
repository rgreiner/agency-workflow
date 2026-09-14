-- 295: dois buracos do ato de promoção (mig. 290), achados testando o caso real.
--
-- 1. O "antes" vinha SEMPRE da ficha. Mas o caminho real é o DP editar o vínculo
--    à mão primeiro e só depois alguém perceber que falta o resto — quando o
--    assistente roda, a ficha já diz CLT e o marco sai "clt → clt", perdendo
--    exatamente o que ele existe para guardar. Agora o "de" (vínculo e salário)
--    pode ser informado.
--
-- 2. A jornada nova entrava sem recalcular os dias que ela já alcança. Quem
--    bateu o ponto hoje de manhã ficava com o saldo da jornada velha até alguém
--    mexer no dia — no caso de 6h→8h, 2h de crédito que não existem.
create or replace function rh_promover_colaborador(p_colaborador uuid, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  c rh_colaborador; v_data date; v_carga int; v_ev uuid;
  v_vinc text; v_sal numeric; v_cargo text; v_jor rh_jornada;
  v_vinc_de text; v_sal_de numeric; v_mudou boolean;
begin
  select * into c from rh_colaborador where id = p_colaborador;
  if c.id is null then raise exception 'Colaborador não encontrado'; end if;
  if not rh_can(c.org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  v_data  := coalesce(nullif(p_dados->>'data_efeito','')::date,
                      (now() at time zone 'America/Sao_Paulo')::date);
  v_vinc  := nullif(p_dados->>'tipo_vinculo','');
  v_sal   := nullif(p_dados->>'salario','')::numeric;
  v_cargo := nullif(p_dados->>'cargo','');
  v_carga := nullif(p_dados->>'carga_min','')::int;
  -- Informado = "o que ela era de verdade antes disto", mesmo que a ficha já
  -- tenha sido corrigida na mão.
  v_vinc_de := coalesce(nullif(p_dados->>'vinculo_de',''), c.tipo_vinculo);
  v_sal_de  := coalesce(nullif(p_dados->>'salario_de','')::numeric, c.salario_atual);
  v_mudou   := v_vinc is not null and v_vinc is distinct from v_vinc_de;

  if v_vinc is null and v_sal is null and v_cargo is null and v_carga is null then
    raise exception 'Informe ao menos uma mudança (vínculo, salário, cargo ou jornada)';
  end if;

  -- 1. O marco, com o ANTES preservado — é o histórico que some quando se
  --    edita a ficha direto.
  insert into rh_evento (
    org_id, colaborador_id, tipo, data_efeito, titulo, descricao,
    salario_de, salario_para, cargo_de, cargo_para,
    vinculo_de, vinculo_para, jornada_de, jornada_para, registrado_por)
  values (
    c.org_id, c.id,
    case when v_mudou then 'vinculo' else 'promocao' end,
    v_data,
    coalesce(nullif(p_dados->>'titulo',''),
             case when v_mudou then 'Mudança de vínculo' else 'Promoção' end),
    nullif(p_dados->>'descricao',''),
    v_sal_de,    coalesce(v_sal, c.salario_atual),
    c.cargo,     coalesce(v_cargo, c.cargo),
    v_vinc_de,   coalesce(v_vinc, v_vinc_de),
    coalesce((rh_jornada_em(c.id, v_data - 1)).carga_min, 480),
    coalesce(v_carga, (rh_jornada_em(c.id, v_data - 1)).carga_min, 480),
    auth.uid())
  returning id into v_ev;

  -- 2. A ficha passa a valer o novo. `data_admissao` acompanha o vínculo novo
  --    (férias e experiência saem dela); a entrada na casa fica preservada.
  update rh_colaborador set
    tipo_vinculo  = coalesce(v_vinc, tipo_vinculo),
    salario_atual = coalesce(v_sal, salario_atual),
    cargo         = coalesce(v_cargo, cargo),
    data_entrada_casa = coalesce(data_entrada_casa, data_admissao, v_data),
    data_admissao = case
      when v_mudou and coalesce((p_dados->>'reiniciar_admissao')::boolean, true)
      then v_data else data_admissao end,
    updated_at = now()
  where id = c.id;

  -- 3. Jornada NOVA a partir da data — a antiga continua valendo no passado
  --    (mig. 288). Sem isso o mês da mudança inventaria falta.
  if v_carga is not null then
    v_jor := rh_jornada_em(c.id, v_data - 1);
    insert into rh_jornada (
      org_id, colaborador_id, entrada, intervalo_ini, intervalo_fim, saida,
      carga_min, intervalo_min, flex_min, tolerancia_min, max_dia_min, dias_semana, vigencia_ini)
    values (
      c.org_id, c.id,
      coalesce(nullif(p_dados->>'entrada','')::time,       v_jor.entrada,       '08:30'),
      coalesce(nullif(p_dados->>'intervalo_ini','')::time, v_jor.intervalo_ini, '12:00'),
      coalesce(nullif(p_dados->>'intervalo_fim','')::time, v_jor.intervalo_fim, '13:30'),
      coalesce(nullif(p_dados->>'saida','')::time,         v_jor.saida,         '18:00'),
      v_carga,
      coalesce(v_jor.intervalo_min, 60), coalesce(v_jor.flex_min, 30),
      coalesce(v_jor.tolerancia_min, 10), coalesce(v_jor.max_dia_min, 600),
      coalesce(v_jor.dias_semana, array[1,2,3,4,5]),
      v_data)
    on conflict (colaborador_id, vigencia_ini) where colaborador_id is not null
    do update set
      entrada = excluded.entrada, intervalo_ini = excluded.intervalo_ini,
      intervalo_fim = excluded.intervalo_fim, saida = excluded.saida,
      carga_min = excluded.carga_min, updated_at = now();

    -- Dia já batido sob a jornada velha precisa ser refeito pela nova; dia
    -- importado do Pontomais (origem) nunca se recalcula.
    perform rh_recalc_ponto(p.id) from rh_ponto p
     where p.colaborador_id = c.id and p.origem is null and p.data >= v_data;
  end if;

  return jsonb_build_object('ok', true, 'evento_id', v_ev, 'data_efeito', v_data,
                            'mudou_vinculo', v_mudou);
end $$;

notify pgrst, 'reload schema';
