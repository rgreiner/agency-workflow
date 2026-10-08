-- 337: a ficha continua aberta depois de efetivar (08/10/2026).
--
-- Caso real, no primeiro uso: o Rafael criou a proposta, o Leonardo aceitou e
-- o Rafael efetivou NA HORA (é o que faz sentido — ele quer a pessoa no RH).
-- A 335 recusava escrita na ficha com o processo 'efetivada': o candidato
-- preencheria tudo e levaria "este processo já foi encerrado" ao enviar.
--
-- Efetivar é sobre a EMPRESA (a pessoa já é do time); preencher a ficha é
-- sobre o CANDIDATO e pode acontecer depois. As duas coisas deixam de brigar:
-- a ficha só fecha quando o processo é cancelado, e o que chegar depois
-- completa a ficha do RH em vez de se perder.
-- Idempotente.

create or replace function rh_admissao_salvar_ficha(p_token text, p_ficha jsonb, p_final boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a rh_admissao; v_cpf text;
begin
  select * into a from rh_admissao where token = p_token;
  if a.id is null then return jsonb_build_object('ok', false, 'erro', 'link'); end if;
  if a.aceita_em is null then return jsonb_build_object('ok', false, 'erro', 'sem_aceite'); end if;
  if a.status = 'cancelada' then return jsonb_build_object('ok', false, 'erro', 'encerrada'); end if;
  if jsonb_typeof(p_ficha) <> 'object' then return jsonb_build_object('ok', false, 'erro', 'formato'); end if;

  update rh_admissao set
    ficha = p_ficha,
    -- `ficha_em` é o carimbo de "terminei": rascunho não avisa ninguém.
    ficha_em = case when p_final then now() else ficha_em end,
    -- Efetivada continua efetivada: o status anda para 'ficha' só quem ainda
    -- não virou cadastro.
    status = case when p_final and status not in ('efetivada', 'cancelada') then 'ficha' else status end,
    updated_at = now()
  where id = a.id;

  if p_final then
    -- Ficha que chega DEPOIS da efetivação completa o cadastro: preenche só o
    -- que está vazio na ficha do RH — o que o RH digitou tem a palavra final.
    if a.colaborador_id is not null then
      v_cpf := nullif(regexp_replace(coalesce(p_ficha->'documentos'->>'cpf', ''), '\D', '', 'g'), '');
      update rh_colaborador c set
        cpf      = coalesce(c.cpf, v_cpf),
        email    = coalesce(c.email, nullif(p_ficha->'endereco'->>'email', '')),
        telefone = coalesce(c.telefone, nullif(p_ficha->'endereco'->>'celular', '')),
        updated_at = now()
      where c.id = a.colaborador_id;
    end if;

    insert into notifications (user_id, org_id, type, data)
    select a.created_by, a.org_id, 'admissao_ficha',
           jsonb_build_object('nome', a.nome, 'cargo', a.cargo,
                              'href', '/' || o.slug || '/rh/contratacoes')
      from organizations o where o.id = a.org_id and a.created_by is not null;
  end if;

  return jsonb_build_object('ok', true, 'final', p_final);
end $$;

/** Anexo: mesma régua. Se a ficha do RH já existe, o documento vai direto pra lá. */
create or replace function rh_admissao_add_doc(p_token text, p_tipo text, p_nome text, p_chave text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a rh_admissao; v_id uuid; v_tipo text;
begin
  select * into a from rh_admissao where token = p_token;
  if a.id is null or a.aceita_em is null then return jsonb_build_object('ok', false, 'erro', 'link'); end if;
  if a.status = 'cancelada' then return jsonb_build_object('ok', false, 'erro', 'encerrada'); end if;
  if (select count(*) from rh_admissao_doc where admissao_id = a.id) >= 20 then
    return jsonb_build_object('ok', false, 'erro', 'limite');
  end if;

  v_tipo := left(coalesce(nullif(p_tipo, ''), 'outro'), 40);
  insert into rh_admissao_doc (admissao_id, tipo, nome, chave)
  values (a.id, v_tipo, left(p_nome, 160), p_chave)
  returning id into v_id;

  -- Anexo que chega depois da efetivação não pode ficar só aqui.
  if a.colaborador_id is not null then
    insert into rh_documento (org_id, colaborador_id, tipo, nome, chave, created_by)
    values (a.org_id, a.colaborador_id, v_tipo, coalesce(nullif(p_nome, ''), v_tipo), p_chave, a.created_by);
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

revoke execute on function rh_admissao_salvar_ficha(text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function rh_admissao_add_doc(text, text, text, text) from public, anon, authenticated;
grant execute on function rh_admissao_salvar_ficha(text, jsonb, boolean) to flow_auth;
grant execute on function rh_admissao_add_doc(text, text, text, text) to flow_auth;

notify pgrst, 'reload schema';
