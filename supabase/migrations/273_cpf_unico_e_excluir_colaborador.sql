-- 273_cpf_unico_e_excluir_colaborador.sql
-- Dois furos que apareceram juntos em 01/09: o Rafael e o RH cadastraram a
-- MESMA pessoa (Vanessa, CPF 124.142.229-05, duas fichas no mesmo dia) e não
-- havia como apagar a errada — só arquivar, o que deixaria um fantasma na
-- lista para sempre.
--
--  1. CPF é a chave da pessoa (a 197 já ensinou isso na folha): agora ele é
--     ÚNICO por org. Quem já esteve na casa e volta REATIVA a ficha antiga —
--     nunca nasce uma segunda, senão o histórico de ponto, férias e folha fica
--     partido em duas pessoas que são a mesma.
--  2. `rh_excluir_colaborador`: apaga ficha SEM histórico (o cadastro errado
--     de hoje). Com qualquer registro — ponto, folha, férias, avaliação,
--     documento, fechamento — recusa e manda arquivar, que é a régua de
--     offboarding da casa. Nada de cascade apagando histórico em silêncio.
-- Idempotente.

-- ── CPF só dígitos: a comparação não pode depender de máscara ───────────────
create or replace function rh_cpf_digitos(t text)
returns text language sql immutable as $$
  select nullif(regexp_replace(coalesce(t, ''), '\D', '', 'g'), '');
$$;

-- Quem já tem este CPF na org (ignora a própria ficha ao editar).
create or replace function rh_cpf_em_uso(p_org uuid, p_cpf text, p_ignora uuid default null)
returns rh_colaborador language sql stable security definer set search_path to 'public' as $$
  select c.* from rh_colaborador c
   where c.org_id = p_org
     and rh_cpf_digitos(c.cpf) is not distinct from rh_cpf_digitos(p_cpf)
     and rh_cpf_digitos(p_cpf) is not null
     and (p_ignora is null or c.id <> p_ignora)
   limit 1;
$$;
revoke execute on function rh_cpf_em_uso(uuid, text, uuid) from public, anon;
grant  execute on function rh_cpf_em_uso(uuid, text, uuid) to authenticated;

-- ── Bloqueio na porta de entrada ───────────────────────────────────────────
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

-- ── Reativar quem voltou: a ficha antiga volta a valer ─────────────────────
create or replace function rh_reativar_colaborador(p_id uuid, p_admissao date default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_colaborador where id = p_id;
  if v_org is null then raise exception 'Colaborador não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  -- Só o cadastro volta. O ACESSO continua sendo concessão explícita em
  -- Membros (regra da 179: voltar a 'ativo' nunca devolve login sozinho).
  update rh_colaborador
     set status = 'ativo', arquivado = false, data_demissao = null,
         aviso_previo_ini = null, aviso_previo_fim = null, aviso_previo_modo = null,
         data_admissao = coalesce(p_admissao, data_admissao),
         updated_at = now()
   where id = p_id;
end $$;
revoke execute on function rh_reativar_colaborador(uuid, date) from public, anon;
grant  execute on function rh_reativar_colaborador(uuid, date) to authenticated;

-- ── Excluir ficha SEM histórico (o cadastro errado) ─────────────────────────
-- Prévia e exclusão compartilham a mesma contagem: a tela diz exatamente o que
-- impede, em vez de um "não pode" seco.
create or replace function rh_impacto_excluir_colaborador(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare c rh_colaborador; v jsonb := '{}'::jsonb; n int; v_total int := 0;
begin
  select * into c from rh_colaborador where id = p_id;
  if c.id is null then return jsonb_build_object('pode', false, 'motivo', 'Colaborador não encontrado'); end if;
  if not rh_can(c.org_id) then return jsonb_build_object('pode', false, 'motivo', 'Acesso negado'); end if;

  select count(*) into n from rh_ponto where colaborador_id = p_id;
  if n > 0 then v := v || jsonb_build_object('ponto', n); v_total := v_total + n; end if;
  select count(*) into n from rh_folha where colaborador_id = p_id;
  if n > 0 then v := v || jsonb_build_object('folha', n); v_total := v_total + n; end if;
  select count(*) into n from rh_ferias where colaborador_id = p_id;
  if n > 0 then v := v || jsonb_build_object('ferias', n); v_total := v_total + n; end if;
  select count(*) into n from rh_justificativa where colaborador_id = p_id;
  if n > 0 then v := v || jsonb_build_object('justificativas', n); v_total := v_total + n; end if;
  select count(*) into n from rh_documento where colaborador_id = p_id;
  if n > 0 then v := v || jsonb_build_object('documentos', n); v_total := v_total + n; end if;
  select count(*) into n from rh_evento where colaborador_id = p_id;
  if n > 0 then v := v || jsonb_build_object('eventos', n); v_total := v_total + n; end if;
  select count(*) into n from rh_fechamento_run_linha where colaborador_id = p_id;
  if n > 0 then v := v || jsonb_build_object('fechamentos', n); v_total := v_total + n; end if;
  select count(*) into n from rh_aval_convite where avaliado_id = p_id;
  if n > 0 then v := v || jsonb_build_object('avaliacoes', n); v_total := v_total + n; end if;

  if v_total > 0 then
    return jsonb_build_object('pode', false, 'historico', v, 'total', v_total,
      'motivo', 'Esta pessoa já tem histórico no Flow. Arquive a ficha em vez de excluir — excluir apagaria o histórico junto.');
  end if;
  return jsonb_build_object('pode', true, 'nome', c.nome, 'total', 0);
end $$;
revoke execute on function rh_impacto_excluir_colaborador(uuid) from public, anon;
grant  execute on function rh_impacto_excluir_colaborador(uuid) to authenticated;

create or replace function rh_excluir_colaborador(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c rh_colaborador; v_prev jsonb;
begin
  select * into c from rh_colaborador where id = p_id;
  if c.id is null then raise exception 'Colaborador não encontrado'; end if;
  if not rh_can(c.org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  v_prev := rh_impacto_excluir_colaborador(p_id);
  if not coalesce((v_prev->>'pode')::boolean, false) then
    raise exception '%', coalesce(v_prev->>'motivo', 'Não é possível excluir');
  end if;
  -- Jornada personalizada nasce junto da ficha e não é histórico: sai com ela.
  delete from rh_jornada where colaborador_id = p_id;
  delete from rh_colaborador where id = p_id;
  return jsonb_build_object('ok', true, 'nome', c.nome);
end $$;
revoke execute on function rh_excluir_colaborador(uuid) from public, anon;
grant  execute on function rh_excluir_colaborador(uuid) to authenticated;

-- ── Garantia no banco (além da RPC) ────────────────────────────────────────
-- Só cria se não houver duplicado pendente — hoje existe um (a Vanessa em
-- dobro). Depois de resolvido na tela, rodar de novo cria o índice.
do $$
declare n int;
begin
  select count(*) into n from (
    select org_id, rh_cpf_digitos(cpf) d from rh_colaborador
     where rh_cpf_digitos(cpf) is not null
     group by 1, 2 having count(*) > 1) t;
  if n = 0 then
    create unique index if not exists rh_colaborador_cpf_uk
      on rh_colaborador (org_id, rh_cpf_digitos(cpf))
      where rh_cpf_digitos(cpf) is not null;
  else
    raise notice 'Índice único de CPF NÃO criado: % CPF(s) duplicado(s) pendente(s). Resolva na tela e reaplique.', n;
  end if;
end $$;

notify pgrst, 'reload schema';
