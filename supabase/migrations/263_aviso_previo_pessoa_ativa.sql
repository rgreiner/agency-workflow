-- 263_aviso_previo_pessoa_ativa.sql
-- Conserto de desenho da 262: o bloco do aviso prévio só aparecia com a ficha
-- em "Desligado" — mas quem cumpre aviso está ATIVA (a Luiza trabalha até
-- 20/09), e marcar "Desligado" antes da hora dispara o gatilho da 179 (corta
-- acesso e solta as atividades NA HORA; reativar é ato manual). O Rafael foi
-- procurar o bloco e ele não existia para pessoa ativa.
--
-- O aviso ganha FIM próprio (`aviso_previo_fim` = último dia trabalhado),
-- desacoplado de `data_demissao` — que continua sendo preenchida só no
-- desligamento efetivo. O helper usa o fim próprio com fallback na demissão
-- (fichas já desligadas seguem valendo). Idempotente.

alter table rh_colaborador add column if not exists aviso_previo_fim date;

create or replace function rh_aviso_reducao_min(p_colaborador uuid, p_data date, p_carga int)
returns int language sql stable security definer set search_path to 'public' as $$
  select case
    when c.aviso_previo_modo is null or c.aviso_previo_ini is null
         or coalesce(c.aviso_previo_fim, c.data_demissao) is null then 0
    when p_data < c.aviso_previo_ini or p_data > coalesce(c.aviso_previo_fim, c.data_demissao) then 0
    when c.aviso_previo_modo = 'reducao_2h' then least(120, p_carga)
    when c.aviso_previo_modo = 'ultima_semana'
         and p_data >= coalesce(c.aviso_previo_fim, c.data_demissao) - 6 then p_carga
    else 0 end
  from rh_colaborador c where c.id = p_colaborador;
$$;
revoke execute on function rh_aviso_reducao_min(uuid, date, int) from public, anon, authenticated;

-- rh_upsert_colaborador com o campo novo (mesma assinatura).
create or replace function rh_upsert_colaborador(p_org_id uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if coalesce(nullif(p_data->>'nome',''), '') = '' then raise exception 'Nome é obrigatório'; end if;

  if p_id is null then
    insert into rh_colaborador (org_id, nome, cpf, email, telefone, cargo, tipo_vinculo,
      data_admissao, data_demissao, status, gestor_id, membro_user_id, salario_atual,
      beneficios_mensal, custo_projetado_mensal, aviso_previo_ini, aviso_previo_fim, aviso_previo_modo, observacao, created_by)
    values (p_org_id,
      p_data->>'nome', nullif(p_data->>'cpf',''), nullif(p_data->>'email',''), nullif(p_data->>'telefone',''),
      nullif(p_data->>'cargo',''), nullif(p_data->>'tipo_vinculo',''),
      nullif(p_data->>'data_admissao','')::date, nullif(p_data->>'data_demissao','')::date,
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
                               then nullif(p_data->>'aviso_previo_ini','')::date
                               else aviso_previo_ini end,
      aviso_previo_fim  = case when p_data ? 'aviso_previo_fim'
                               then nullif(p_data->>'aviso_previo_fim','')::date
                               else aviso_previo_fim end,
      aviso_previo_modo = case when p_data ? 'aviso_previo_modo'
                               then nullif(p_data->>'aviso_previo_modo','')
                               else aviso_previo_modo end,
      observacao = nullif(p_data->>'observacao',''), updated_at = now()
    where id = p_id and org_id = p_org_id
    returning id into v_id;
    if v_id is null then raise exception 'Colaborador não encontrado'; end if;
  end if;
  return v_id;
end; $$;

notify pgrst, 'reload schema';
