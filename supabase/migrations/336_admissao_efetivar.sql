-- 336: efetivar a contratação — o processo vira ficha no RH (08/10/2026).
--
-- Terceira etapa da esteira (334/335). Até aqui o candidato aceitou e preencheu
-- a ficha; aqui ele vira `rh_colaborador`, com a jornada da proposta e os
-- anexos que mandou. O CPF passa pela trava da mig. 273 (ficha duplicada) e,
-- se a pessoa já trabalhou na casa, a RPC avisa em vez de criar outra.
--
-- Nada de recriar regra: quem cria a ficha é `rh_upsert_colaborador` e quem
-- grava a jornada é `rh_upsert_jornada` — as mesmas das telas.
-- Idempotente.

create or replace function rh_admissao_efetivar(p_id uuid, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  a rh_admissao; v_colab uuid; v_cpf text; v_jor jsonb; v_padrao rh_jornada;
  v_admissao date; v_doc record; v_criadas int := 0;
begin
  select * into a from rh_admissao where id = p_id;
  if a.id is null then raise exception 'Processo não encontrado'; end if;
  if not rh_can(a.org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if a.aceita_em is null then raise exception 'A proposta ainda não foi aceita'; end if;
  if a.status = 'efetivada' then raise exception 'Este processo já virou ficha no RH'; end if;

  -- CPF: o da ficha do candidato, salvo se o RH corrigir na hora de efetivar.
  v_cpf := regexp_replace(coalesce(nullif(p_dados->>'cpf',''), a.ficha->'documentos'->>'cpf', ''), '\D', '', 'g');
  v_admissao := coalesce(nullif(p_dados->>'data_admissao','')::date, a.data_inicio,
                         (now() at time zone 'America/Sao_Paulo')::date);

  -- A ficha nasce pela MESMA função da tela: CPF único (mig. 273), reativação
  -- de quem volta e data_entrada_casa (mig. 294) vêm de lá.
  v_colab := rh_upsert_colaborador(a.org_id, null, jsonb_build_object(
    'nome', coalesce(nullif(p_dados->>'nome',''), a.nome),
    'cpf', nullif(v_cpf, ''),
    'email', coalesce(nullif(p_dados->>'email',''), a.ficha->'endereco'->>'email', a.email),
    'telefone', coalesce(nullif(p_dados->>'telefone',''), a.ficha->'endereco'->>'celular', a.telefone),
    'cargo', coalesce(nullif(p_dados->>'cargo',''), a.cargo),
    'tipo_vinculo', coalesce(nullif(p_dados->>'tipo_vinculo',''), a.tipo_vinculo),
    'data_admissao', v_admissao,
    'salario_atual', coalesce(nullif(p_dados->>'salario',''), a.salario::text),
    'status', 'ativo'));

  -- Jornada própria só quando difere da padrão da empresa: linha igual à
  -- padrão seria ruído no histórico de vigências (mig. 288).
  v_jor := a.jornada;
  select * into v_padrao from rh_jornada
   where org_id = a.org_id and colaborador_id is null and vigencia_ini <= v_admissao
   order by vigencia_ini desc limit 1;
  if v_jor is not null and v_jor ? 'entrada' and (
       v_padrao.id is null
       or v_padrao.entrada::text <> (v_jor->>'entrada') || ':00'
       or v_padrao.saida::text   <> (v_jor->>'saida') || ':00') then
    perform rh_upsert_jornada(a.org_id, v_colab, v_jor || jsonb_build_object('vigencia_ini', v_admissao));
  end if;

  -- Anexos do candidato viram documentos da ficha. O arquivo não se move: a
  -- chave já é privada (admissao-privado/) e a rota do RH serve os dois prefixos.
  for v_doc in select * from rh_admissao_doc where admissao_id = a.id loop
    insert into rh_documento (org_id, colaborador_id, tipo, nome, chave, created_by)
    values (a.org_id, v_colab, v_doc.tipo, coalesce(v_doc.nome, v_doc.tipo), v_doc.chave, auth.uid());
    v_criadas := v_criadas + 1;
  end loop;

  update rh_admissao set status = 'efetivada', colaborador_id = v_colab,
    efetivada_em = now(), updated_at = now()
  where id = a.id;

  return jsonb_build_object('ok', true, 'colaborador_id', v_colab, 'documentos', v_criadas,
                            'data_admissao', v_admissao);
end $$;

revoke execute on function rh_admissao_efetivar(uuid, jsonb) from public, anon;
grant execute on function rh_admissao_efetivar(uuid, jsonb) to authenticated;

-- Envio à contabilidade: fica registrado quando e para quem, como no
-- fechamento do ponto (reenvio é "versão corrigida", não um novo processo).
alter table rh_admissao add column if not exists contabil_em timestamptz;
alter table rh_admissao add column if not exists contabil_para text[];

create or replace function rh_admissao_marcar_contabil(p_id uuid, p_para text[])
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_admissao where id = p_id;
  if v_org is null then raise exception 'Processo não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update rh_admissao set contabil_em = now(), contabil_para = p_para, updated_at = now() where id = p_id;
end $$;

revoke execute on function rh_admissao_marcar_contabil(uuid, text[]) from public, anon;
grant execute on function rh_admissao_marcar_contabil(uuid, text[]) to authenticated;

notify pgrst, 'reload schema';
