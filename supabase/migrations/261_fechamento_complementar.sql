-- 261_fechamento_complementar.sql
-- FECHAMENTO COMPLEMENTAR na mesma competência (pedido do Rafael, 27/08).
--
-- Caso real: o ciclo de agosto fechou PARCIAL — duas funcionárias saem dia
-- 31/08 e ficaram de fora de propósito, para fechar depois com o período
-- esticado até a demissão e ir num SEGUNDO e-mail à contabilidade.
--
-- O modelo era 1 run por competência (unique org+competencia) e "já fechado"
-- bloqueava refechar. Agora:
--   • N runs por competência: quem fechou vira card; quem falta continua na
--     tabela viva; fechar os demais cria um run COMPLEMENTAR com envio
--     próprio, que entra no histórico como os outros.
--   • A mesma PESSOA não pode estar em dois fechamentos vigentes da mesma
--     competência (run reaberto não conta — ele está sendo refeito).
--   • Havendo um run 'reaberto' na competência, fechar REGENERA ele (delete
--     linhas + versão nova) — comportamento que já existia.

alter table rh_fechamento_run drop constraint if exists rh_fechamento_run_org_id_competencia_key;
create index if not exists rh_fechamento_run_org_comp_idx2 on rh_fechamento_run (org_id, competencia);

create or replace function rh_fechar_ciclo(p_org_id uuid, p_competencia date, p_pessoas jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_ini date; v_fim date; v_run uuid; v_comp date;
  item jsonb; r jsonb; v_colab uuid; v_pini date; v_pfim date; v_n int := 0;
  v_dup text;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
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
end $$;
revoke execute on function rh_fechar_ciclo(uuid, date, jsonb) from public, anon;
grant  execute on function rh_fechar_ciclo(uuid, date, jsonb) to authenticated;

notify pgrst, 'reload schema';
