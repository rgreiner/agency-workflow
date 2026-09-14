-- 294: a ficha passa a saber gravar data_entrada_casa (coluna criada na 290).
--
-- Sem isto: (a) não dá para corrigir a data de entrada de quem foi efetivada, e
-- (b) pior — corrigir a admissão de quem NUNCA foi promovida deixava a entrada
-- na casa presa na data antiga, e rh_no_vinculo (mig. 291) passa a contar dias
-- em que a pessoa ainda não estava na empresa.
--
-- Regra: valor explícito manda; senão a entrada na casa é a MAIS ANTIGA entre a
-- que já estava lá e a admissão informada. Assim corrigir a admissão para trás
-- puxa as duas, e mudar a admissão para a frente (efetivação) não apaga o tempo
-- de casa nem encurta o vínculo — foi o que apagou 7 meses de ponto no teste.
create or replace function rh_upsert_colaborador(p_org_id uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_dono rh_colaborador;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if coalesce(nullif(p_data->>'nome',''), '') = '' then raise exception 'Nome é obrigatório'; end if;

  -- CPF é a identidade da pessoa: duas fichas partem o histórico em duas
  -- (ponto, folha, férias) e ninguém percebe até fechar o mês.
  v_dono := rh_cpf_em_uso(p_org_id, p_data->>'cpf', p_id);
  if v_dono.id is not null then
    if coalesce(v_dono.arquivado, false) or v_dono.status = 'desligado' then
      raise exception 'Este CPF já tem ficha: % (%). Reative a ficha existente em vez de criar outra — o histórico dela continua valendo.',
        v_dono.nome, case when coalesce(v_dono.arquivado, false) then 'arquivada' else 'desligada' end
        using errcode = '23505';
    end if;
    raise exception 'Este CPF já está cadastrado para %.', v_dono.nome using errcode = '23505';
  end if;

  if p_id is null then
    insert into rh_colaborador (org_id, nome, cpf, email, telefone, cargo, tipo_vinculo,
      data_admissao, data_entrada_casa, data_demissao, status, gestor_id, membro_user_id, salario_atual,
      beneficios_mensal, custo_projetado_mensal, aviso_previo_ini, aviso_previo_fim, aviso_previo_modo, observacao, created_by)
    values (p_org_id,
      p_data->>'nome', nullif(p_data->>'cpf',''), nullif(p_data->>'email',''), nullif(p_data->>'telefone',''),
      nullif(p_data->>'cargo',''), nullif(p_data->>'tipo_vinculo',''),
      nullif(p_data->>'data_admissao','')::date,
      coalesce(nullif(p_data->>'data_entrada_casa','')::date, nullif(p_data->>'data_admissao','')::date),
      nullif(p_data->>'data_demissao','')::date,
      coalesce(nullif(p_data->>'status',''), 'ativo'),
      nullif(p_data->>'gestor_id','')::uuid, nullif(p_data->>'membro_user_id','')::uuid,
      nullif(p_data->>'salario_atual','')::numeric,
      coalesce(nullif(p_data->>'beneficios_mensal','')::numeric, 0),
      nullif(p_data->>'custo_projetado_mensal','')::numeric,
      nullif(p_data->>'aviso_previo_ini','')::date,
      nullif(p_data->>'aviso_previo_fim','')::date,
      nullif(p_data->>'aviso_previo_modo',''),
      nullif(p_data->>'observacao',''), auth.uid())
    returning id into v_id;
  else
    update rh_colaborador set
      nome = p_data->>'nome', cpf = nullif(p_data->>'cpf',''), email = nullif(p_data->>'email',''),
      telefone = nullif(p_data->>'telefone',''), cargo = nullif(p_data->>'cargo',''),
      tipo_vinculo = nullif(p_data->>'tipo_vinculo',''),
      data_admissao = nullif(p_data->>'data_admissao','')::date,
      data_entrada_casa = case
        when nullif(p_data->>'data_entrada_casa','') is not null
          then (p_data->>'data_entrada_casa')::date
        -- least() ignora null: sem entrada gravada, vira a admissão informada.
        else least(data_entrada_casa, nullif(p_data->>'data_admissao','')::date) end,
      data_demissao = nullif(p_data->>'data_demissao','')::date,
      status = coalesce(nullif(p_data->>'status',''), status),
      gestor_id = nullif(p_data->>'gestor_id','')::uuid,
      membro_user_id = nullif(p_data->>'membro_user_id','')::uuid,
      salario_atual = nullif(p_data->>'salario_atual','')::numeric,
      beneficios_mensal = coalesce(nullif(p_data->>'beneficios_mensal','')::numeric, beneficios_mensal),
      custo_projetado_mensal = case when p_data ? 'custo_projetado_mensal'
                                    then nullif(p_data->>'custo_projetado_mensal','')::numeric
                                    else custo_projetado_mensal end,
      aviso_previo_ini  = case when p_data ? 'aviso_previo_ini'
                               then nullif(p_data->>'aviso_previo_ini','')::date else aviso_previo_ini end,
      aviso_previo_fim  = case when p_data ? 'aviso_previo_fim'
                               then nullif(p_data->>'aviso_previo_fim','')::date else aviso_previo_fim end,
      aviso_previo_modo = case when p_data ? 'aviso_previo_modo'
                               then nullif(p_data->>'aviso_previo_modo','') else aviso_previo_modo end,
      observacao = nullif(p_data->>'observacao',''), updated_at = now()
    where id = p_id and org_id = p_org_id
    returning id into v_id;
    if v_id is null then raise exception 'Colaborador não encontrado'; end if;
  end if;
  return v_id;
end; $$;

notify pgrst, 'reload schema';
