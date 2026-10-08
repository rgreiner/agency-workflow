-- 335: a ficha de admissão preenchida pelo próprio candidato (08/10/2026).
--
-- Segunda etapa da esteira (334). Decisão do Rafael: quem preenche é o
-- candidato, no mesmo link — são dados que só ele tem (mãe, RG, PIS, CTPS,
-- banco) e que hoje ele manda por WhatsApp para alguém digitar de novo.
--
-- Mesmas regras da 334: só pelo token, só flow_auth executa, e nada de id
-- vindo do browser. A ficha só aceita escrita DEPOIS do aceite e ANTES da
-- efetivação — link de proposta recusada ou de gente já contratada é só leitura.
-- Idempotente.

/** Grava a ficha (rascunho ou final). `p_final` marca que o candidato terminou. */
create or replace function rh_admissao_salvar_ficha(p_token text, p_ficha jsonb, p_final boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a rh_admissao;
begin
  select * into a from rh_admissao where token = p_token;
  if a.id is null then return jsonb_build_object('ok', false, 'erro', 'link'); end if;
  if a.aceita_em is null then return jsonb_build_object('ok', false, 'erro', 'sem_aceite'); end if;
  if a.status in ('efetivada', 'cancelada') then return jsonb_build_object('ok', false, 'erro', 'encerrada'); end if;
  if jsonb_typeof(p_ficha) <> 'object' then return jsonb_build_object('ok', false, 'erro', 'formato'); end if;

  update rh_admissao set
    ficha = p_ficha,
    -- `ficha_em` é o carimbo de "terminei": rascunho não avisa ninguém.
    ficha_em = case when p_final then now() else ficha_em end,
    status = case when p_final then 'ficha' else status end,
    updated_at = now()
  where id = a.id;

  if p_final then
    insert into notifications (user_id, org_id, type, data)
    select a.created_by, a.org_id, 'admissao_ficha',
           jsonb_build_object('nome', a.nome, 'cargo', a.cargo,
                              'href', '/' || o.slug || '/rh/contratacoes')
      from organizations o where o.id = a.org_id and a.created_by is not null;
  end if;

  return jsonb_build_object('ok', true, 'final', p_final);
end $$;

/** Anexo do candidato. O arquivo já foi gravado no volume; aqui entra a referência. */
create or replace function rh_admissao_add_doc(p_token text, p_tipo text, p_nome text, p_chave text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a rh_admissao; v_id uuid;
begin
  select * into a from rh_admissao where token = p_token;
  if a.id is null or a.aceita_em is null then return jsonb_build_object('ok', false, 'erro', 'link'); end if;
  if a.status in ('efetivada', 'cancelada') then return jsonb_build_object('ok', false, 'erro', 'encerrada'); end if;
  -- Teto por processo: o link é público, e sem limite vira depósito de arquivo.
  if (select count(*) from rh_admissao_doc where admissao_id = a.id) >= 20 then
    return jsonb_build_object('ok', false, 'erro', 'limite');
  end if;

  insert into rh_admissao_doc (admissao_id, tipo, nome, chave)
  values (a.id, left(coalesce(nullif(p_tipo, ''), 'outro'), 40), left(p_nome, 160), p_chave)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

/** O candidato tira um anexo que subiu errado (só o dele, e só pelo token). */
create or replace function rh_admissao_del_doc(p_token text, p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a rh_admissao; v_chave text;
begin
  select * into a from rh_admissao where token = p_token;
  if a.id is null or a.status in ('efetivada', 'cancelada') then
    return jsonb_build_object('ok', false, 'erro', 'link');
  end if;
  delete from rh_admissao_doc where id = p_id and admissao_id = a.id returning chave into v_chave;
  if v_chave is null then return jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); end if;
  -- O arquivo no volume fica: quem apaga é a limpeza do processo (LGPD, 334).
  return jsonb_build_object('ok', true);
end $$;

/** Leitura de um anexo pelo RH: devolve a chave só para quem tem rh_can. */
create or replace function rh_admissao_doc_chave(p_id uuid)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare v_chave text; v_org uuid;
begin
  select d.chave, a.org_id into v_chave, v_org
    from rh_admissao_doc d join rh_admissao a on a.id = d.admissao_id
   where d.id = p_id;
  if v_chave is null then return null; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return v_chave;
end $$;

revoke execute on function rh_admissao_salvar_ficha(text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function rh_admissao_add_doc(text, text, text, text) from public, anon, authenticated;
revoke execute on function rh_admissao_del_doc(text, uuid) from public, anon, authenticated;
grant execute on function rh_admissao_salvar_ficha(text, jsonb, boolean) to flow_auth;
grant execute on function rh_admissao_add_doc(text, text, text, text) to flow_auth;
grant execute on function rh_admissao_del_doc(text, uuid) to flow_auth;
-- Esta é do RH logado (e do servidor, que serve o arquivo).
revoke execute on function rh_admissao_doc_chave(uuid) from public, anon;
grant execute on function rh_admissao_doc_chave(uuid) to authenticated, flow_auth;

notify pgrst, 'reload schema';
