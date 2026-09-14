-- 290_promocao_e_vinculo.sql
-- MUDANÇA DE VÍNCULO VIRA UM ATO SÓ (14/09/2026).
--
-- A Luiza Medeiros saiu de estagiária (6h, bolsa) para CLT (8h, salário). Isso
-- hoje são quatro edições soltas em lugares diferentes — vínculo, salário,
-- cargo e jornada — e esquecer uma é o que gerou o caso: a ficha já dizia CLT
-- enquanto a jornada seguia de 6h. Nenhuma delas deixava rastro: trocar
-- `estagio` por `clt` sobrescrevia o campo e a bolsa anterior sumia.
--
-- Agora existe UM ato, numa transação: registra o marco na linha do tempo
-- (o histórico "era estágio, ganhava X") e aplica a mudança a partir da data,
-- criando a nova vigência da jornada em vez de reescrever a antiga (mig. 288).
--
-- `data_entrada_casa` guarda quando a pessoa chegou na empresa, separada de
-- `data_admissao`, que passa a ser a do vínculo ATUAL — é dela que saem
-- férias e contrato de experiência, por lei. Assim "2 anos de casa" e "CLT
-- desde setembro" convivem sem mentir nenhum dos dois.
-- Idempotente.

alter table rh_colaborador add column if not exists data_entrada_casa date;
-- Para quem já está cadastrado, chegar = ser admitido (não houve troca de vínculo).
update rh_colaborador set data_entrada_casa = data_admissao
 where data_entrada_casa is null and data_admissao is not null;

alter table rh_evento add column if not exists vinculo_de   text;
alter table rh_evento add column if not exists vinculo_para text;
alter table rh_evento add column if not exists jornada_de   int;
alter table rh_evento add column if not exists jornada_para int;

-- ── O ato ──────────────────────────────────────────────────────────────────
-- Tudo ou nada: ou o marco e as quatro mudanças entram juntos, ou nada entra.
create or replace function rh_promover_colaborador(p_colaborador uuid, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  c rh_colaborador; v_data date; v_carga int; v_ev uuid;
  v_vinc text; v_sal numeric; v_cargo text; v_jor rh_jornada;
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
    case when v_vinc is not null and v_vinc is distinct from c.tipo_vinculo
         then 'vinculo' else 'promocao' end,
    v_data,
    coalesce(nullif(p_dados->>'titulo',''),
             case when v_vinc is not null and v_vinc is distinct from c.tipo_vinculo
                  then 'Mudança de vínculo' else 'Promoção' end),
    nullif(p_dados->>'descricao',''),
    c.salario_atual, coalesce(v_sal, c.salario_atual),
    c.cargo,         coalesce(v_cargo, c.cargo),
    c.tipo_vinculo,  coalesce(v_vinc, c.tipo_vinculo),
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
      when v_vinc is not null and v_vinc is distinct from c.tipo_vinculo
           and coalesce((p_dados->>'reiniciar_admissao')::boolean, true)
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
  end if;

  return jsonb_build_object('ok', true, 'evento_id', v_ev, 'data_efeito', v_data);
end $$;
revoke execute on function rh_promover_colaborador(uuid, jsonb) from public, anon;
grant  execute on function rh_promover_colaborador(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
