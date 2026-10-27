-- 378 — a Flávia conduz o fechamento do ponto/folha (27/10/2026)
--
-- O Rafael: antes de fechar, (1) nenhuma aprovação de ponto pendente no ciclo,
-- (2) o time confirma os espelhos, (3) VA/VT do mês (dia útil × valor; quem entrou
-- no meio do mês, proporcional), (4) fechar quem falta (sócios sem envio) e mandar
-- à Ocvel o texto padrão. A Flávia não tem papel de RH: estas funções abrem SÓ o
-- fechamento para a usuária de um agente com token vivo (fin_agente_folha), e só
-- depois do Sim do Rafael na mesa (quem chama é a Digitais). Salário não sai daqui;
-- o CPF só vai no pacote que o próprio Flow monta e envia à contabilidade.

-- Quem chama é um agente (token vivo da org) com acesso financeiro.
create or replace function public.fin_agente_folha(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select fin_can(p_org)
     and exists (select 1 from agente_tokens t where t.user_id = auth.uid() and t.org_id = p_org and t.revogado_em is null);
$$;
revoke execute on function public.fin_agente_folha(uuid) from public, anon, authenticated;

-- Guarda do fechamento: RH OU o agente (resto do corpo idêntico ao vivo).

CREATE OR REPLACE FUNCTION public.rh_fechar_ciclo(p_org_id uuid, p_competencia date, p_pessoas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
declare
  v_ini date; v_fim date; v_run uuid; v_comp date;
  item jsonb; r jsonb; v_colab uuid; v_pini date; v_pfim date; v_n int := 0;
  v_dup text;
begin
  if not (rh_can(p_org_id) or fin_agente_folha(p_org_id)) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_pessoas is null or jsonb_array_length(p_pessoas) = 0 then
    raise exception 'Selecione ao menos uma pessoa para fechar o ciclo';
  end if;
  select ini, fim into v_ini, v_fim from rh_periodo_fechamento(p_org_id, p_competencia);
  v_comp := date_trunc('month', p_competencia)::date;

  -- Ninguém entra em DOIS fechamentos vigentes da mesma competência.
  select l.nome into v_dup
    from rh_fechamento_run rr
    join rh_fechamento_run_linha l on l.run_id = rr.id
   where rr.org_id = p_org_id and rr.competencia = v_comp and rr.status <> 'reaberto'
     and l.colaborador_id in (select (x->>'id')::uuid from jsonb_array_elements(p_pessoas) x)
   limit 1;
  if v_dup is not null then
    raise exception '% já está em um fechamento desta competência. Reabra aquele fechamento para refazer.', v_dup;
  end if;

  -- Run reaberto na competência: refaz ELE; senão, nasce um novo (o primeiro
  -- ou um complementar — o modelo é o mesmo).
  select id into v_run from rh_fechamento_run
   where org_id = p_org_id and competencia = v_comp and status = 'reaberto'
   order by fechado_em limit 1;

  if v_run is null then
    insert into rh_fechamento_run (org_id, competencia, ini, fim, fechado_por)
    values (p_org_id, v_comp, v_ini, v_fim, auth.uid())
    returning id into v_run;
  else
    delete from rh_fechamento_run_linha where run_id = v_run;
    update rh_fechamento_run
       set status = 'fechado', versao = versao + 1,
           fechado_por = auth.uid(), fechado_em = now(), ini = v_ini, fim = v_fim
     where id = v_run;
  end if;

  for item in select * from jsonb_array_elements(p_pessoas) loop
    v_colab := (item->>'id')::uuid;
    perform 1 from rh_colaborador where id = v_colab and org_id = p_org_id;
    if not found then raise exception 'Colaborador fora da organização'; end if;
    v_pini := coalesce((item->>'ini')::date, v_ini);
    v_pfim := coalesce((item->>'fim')::date, v_fim);
    if v_pfim < v_pini then raise exception 'Período da pessoa está invertido'; end if;

    r := rh_fechamento_linha_calc(v_colab, v_pini, v_pfim);
    insert into rh_fechamento_run_linha
      (run_id, colaborador_id, nome, cpf, cargo, ini, fim,
       hn_min, he50_min, he100_min, faltas_min, total_min, quitacao_min, pendente_min, dias_com_ponto)
    values
      (v_run, v_colab, r->>'nome', r->>'cpf', r->>'cargo', v_pini, v_pfim,
       (r->>'hn_min')::int, (r->>'he50_min')::int, (r->>'he100_min')::int, (r->>'faltas_min')::int,
       (r->>'total_min')::int, (r->>'quitacao_min')::int, (r->>'pendente_min')::int, (r->>'dias_com_ponto')::int);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('run_id', v_run, 'linhas', v_n);
end $fn$;

create or replace function public.rh_fechamento_marcar_envio(p_run uuid, p_destinatarios text[], p_vr numeric, p_vt numeric, p_corpo text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $fn$
declare v_org uuid;
begin
  select org_id into v_org from rh_fechamento_run where id = p_run;
  if v_org is null then raise exception 'Fechamento não encontrado'; end if;
  if not (rh_can(v_org) or fin_agente_folha(v_org)) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update rh_fechamento_run
     set status = 'enviado', enviado_em = now(), destinatarios = p_destinatarios,
         envios = envios + 1, vr_valor = p_vr, vt_valor = p_vt, corpo = p_corpo
   where id = p_run;
end $fn$;

create or replace function public.rh_fechamento_sem_envio(p_run uuid, p_sem_envio boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $fn$
declare v_org uuid; v_status text;
begin
  select org_id, status into v_org, v_status from rh_fechamento_run where id = p_run;
  if v_org is null then raise exception 'Fechamento não encontrado'; end if;
  if not (rh_can(v_org) or fin_agente_folha(v_org)) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  -- Já enviado não vira "sem envio": o e-mail existe e o histórico não mente.
  if coalesce(p_sem_envio, false) and v_status = 'enviado' then
    raise exception 'Este ciclo já foi enviado à contabilidade';
  end if;
  update rh_fechamento_run set sem_envio = coalesce(p_sem_envio, false) where id = p_run;
end $fn$;

-- Situação da folha do ciclo que acabou de terminar: quem falta fechar, aprovações
-- de ponto pendentes no ciclo, dias úteis do mês (VA/VT) por pessoa e o último envio
-- (valores e texto) como referência. Sem CPF nem salário.
create or replace function public.fin_folha_situacao(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_hoje date := fin_hoje();
  v_comp date := date_trunc('month', v_hoje)::date;
  v_ini date; v_fim date; v_mes_ini date; v_mes_fim date;
  v jsonb;
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select ini, fim into v_ini, v_fim from rh_periodo_fechamento(p_org, v_comp);
  if v_fim >= v_hoje then  -- ciclo do mês ainda correndo: a folha da vez é a do anterior
    v_comp := (v_comp - interval '1 month')::date;
    select ini, fim into v_ini, v_fim from rh_periodo_fechamento(p_org, v_comp);
  end if;
  v_mes_ini := v_comp;
  v_mes_fim := (v_comp + interval '1 month - 1 day')::date;

  select jsonb_build_object(
    'competencia', to_char(v_comp, 'YYYY-MM'), 'ini', v_ini, 'fim', v_fim,
    'dias_uteis_mes', (select count(*) from generate_series(v_mes_ini, v_mes_fim, '1 day') d where fin_dia_util(p_org, d::date)),
    'pessoas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'nome', c.nome, 'vinculo', c.tipo_vinculo,
        'admissao', c.data_admissao, 'demissao', c.data_demissao, 'status', c.status,
        'fechado', exists (select 1 from rh_fechamento_run r join rh_fechamento_run_linha l on l.run_id = r.id
                            where r.org_id = p_org and r.competencia = v_comp and r.status <> 'reaberto' and l.colaborador_id = c.id),
        'dias_uteis_mes', (select count(*) from generate_series(greatest(coalesce(c.data_admissao, v_mes_ini), v_mes_ini),
                                                               least(coalesce(c.data_demissao, v_mes_fim), v_mes_fim), '1 day') d
                            where fin_dia_util(p_org, d::date))
      ) order by c.nome)
        from rh_colaborador c
       where c.org_id = p_org and not c.arquivado and coalesce(c.entra_fechamento, true)
         and coalesce(c.data_admissao, v_ini) <= v_fim
         and (c.status <> 'desligado' or c.data_demissao >= v_ini)), '[]'::jsonb),
    'justificativas_pendentes', coalesce((
      select jsonb_agg(jsonb_build_object('nome', c.nome, 'data', j.data_ini, 'tipo', j.tipo) order by j.data_ini)
        from rh_justificativa j join rh_colaborador c on c.id = j.colaborador_id
       where j.org_id = p_org and j.status = 'pendente' and j.data_ini <= v_fim and j.data_fim >= v_ini), '[]'::jsonb),
    'ultimo_envio', (
      select jsonb_build_object('competencia', to_char(r.competencia, 'YYYY-MM'), 'vr_valor', r.vr_valor, 'vt_valor', r.vt_valor, 'corpo', r.corpo,
             'dias_uteis_mes', (select count(*) from generate_series(r.competencia, (r.competencia + interval '1 month - 1 day')::date, '1 day') d where fin_dia_util(p_org, d::date)))
        from rh_fechamento_run r
       where r.org_id = p_org and r.status = 'enviado' and r.vr_valor is not null
       order by r.enviado_em desc limit 1)
  ) into v;
  return v;
end $fn$;
revoke execute on function public.fin_folha_situacao(uuid) from public, anon;
grant execute on function public.fin_folha_situacao(uuid) to authenticated;

-- Pacote do envio (snapshot com CPF + destinatários): só o servidor do Flow lê,
-- na operação de envio do agente — a Digitais nunca recebe isto.
create or replace function public.fin_folha_pacote(p_run uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare v_org uuid; v jsonb;
begin
  select org_id into v_org from rh_fechamento_run where id = p_run;
  if v_org is null or not fin_agente_folha(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select jsonb_build_object(
    'id', r.id, 'org_id', r.org_id, 'competencia', r.competencia, 'ini', r.ini, 'fim', r.fim, 'status', r.status, 'enviado_em', r.enviado_em,
    'sem_envio', r.sem_envio,
    'linhas', coalesce((select jsonb_agg(to_jsonb(l) - 'run_id' - 'id') from rh_fechamento_run_linha l where l.run_id = r.id), '[]'::jsonb),
    'destinatarios', (select to_jsonb(coalesce(os.rh_contabil_emails, '{}')) from org_settings os where os.org_id = r.org_id),
    'logo_url', (select os.logo_url from org_settings os where os.org_id = r.org_id))
    into v from rh_fechamento_run r where r.id = p_run;
  return v;
end $fn$;
revoke execute on function public.fin_folha_pacote(uuid) from public, anon;
grant execute on function public.fin_folha_pacote(uuid) to authenticated;

notify pgrst, 'reload schema';
