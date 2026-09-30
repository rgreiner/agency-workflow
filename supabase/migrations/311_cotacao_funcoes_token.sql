-- 311_cotacao_funcoes_token.sql
-- A página do fornecedor (/cotacao/<token>) fala com o banco pela conexão direta,
-- que no VPS é o papel `flow_auth` — sem BYPASSRLS e com grant só nas tabelas de
-- auth. A 310 assumiu superusuário e a página caiu com "permission denied for
-- table cotacao_convites" no primeiro acesso (30/09).
--
-- Em vez de abrir producao/fornecedores/notifications para o flow_auth, o acesso
-- vira 4 funções SECURITY DEFINER que só aceitam o TOKEN e só são executáveis pelo
-- flow_auth. Atenção à armadilha da casa: DEFAULT PRIVILEGES dá EXECUTE a anon e
-- authenticated em toda função nova, então o revoke é dos três.
--
-- Idempotente.

-- 1) Tudo que a página precisa, a partir do token. `trava` = true bloqueia a linha
--    do orçamento até o fim da transação (quem chama vai gravar a resposta nela).
create or replace function cotacao_por_token(p_token text, p_trava boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_prod uuid;
begin
  select c.producao_id into v_prod
    from cotacao_convites cv join cotacoes c on c.id = cv.cotacao_id
   where cv.token = p_token;
  if v_prod is null then return null; end if;
  if p_trava then perform 1 from producao where id = v_prod for update; end if;

  select jsonb_build_object(
    'id', cv.id, 'org_id', cv.org_id, 'cotacao_id', cv.cotacao_id, 'fornecedor_id', cv.fornecedor_id,
    'producao_id', c.producao_id, 'titulo', p.titulo, 'agencia', o.name, 'org_slug', o.slug,
    'responsavel', pr.full_name, 'responsavel_email', pr.email,
    'mensagem', c.mensagem, 'prazo_resposta', to_char(c.prazo_resposta, 'YYYY-MM-DD'), 'encerrada', c.encerrada,
    'itens', c.itens, 'anexos', c.anexos,
    'fornecedor', jsonb_build_object('nome', f.name, 'tax_id', f.tax_id, 'emails', f.emails, 'telefones', f.telefones),
    'resposta', cv.resposta, 'resposta_anexos', cv.resposta_anexos, 'dados_fornecedor', cv.dados_fornecedor,
    'respondido_em', cv.respondido_em, 'recusado_em', cv.recusado_em, 'aberto_em', cv.aberto_em,
    'detalhe_itens', coalesce(p.detalhe->'itens', 'null'::jsonb)
  ) into v
    from cotacao_convites cv
    join cotacoes c on c.id = cv.cotacao_id
    join producao p on p.id = c.producao_id
    join organizations o on o.id = cv.org_id
    join fornecedores f on f.id = cv.fornecedor_id
    left join profiles pr on pr.id = coalesce(p.responsavel_id, c.created_by)
   where cv.token = p_token;
  return v;
end $$;

-- 2) "Abriu o link".
create or replace function cotacao_marcar_aberto(p_token text)
returns void language sql security definer set search_path = public as $$
  update cotacao_convites set aberto_em = coalesce(aberto_em, now()) where token = p_token;
$$;

-- Aviso na caixa de quem pediu (responsável do orçamento + quem enviou a cotação).
create or replace function cotacao_notificar(p_convite uuid, p_recusou boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, org_id, type, data)
  select distinct u, c.org_id, 'cotacao_resposta',
         jsonb_build_object('fornecedor', f.name, 'orcamento', p.titulo, 'recusou', p_recusou,
                            'href', '/' || o.slug || '/producao/orcamento/' || p.id)
    from cotacao_convites cv
    join cotacoes c on c.id = cv.cotacao_id
    join producao p on p.id = c.producao_id
    join organizations o on o.id = c.org_id
    join fornecedores f on f.id = cv.fornecedor_id
    cross join lateral unnest(array[p.responsavel_id, c.created_by]) as u
   where cv.id = p_convite and u is not null
     and exists (select 1 from organization_members m where m.org_id = c.org_id and m.user_id = u);
end $$;

-- 3) Recusa ("não vamos cotar desta vez") — só enquanto não respondeu.
create or replace function cotacao_recusar(p_token text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  update cotacao_convites
     set recusado_em = now(), aberto_em = coalesce(aberto_em, now()),
         resposta = jsonb_build_object('recusa', left(coalesce(p_motivo, ''), 500))
   where token = p_token and respondido_em is null
  returning id into v_id;
  if v_id is not null then perform cotacao_notificar(v_id, true); end if;
end $$;

-- 4) Proposta. O servidor já saneou a resposta e calculou os itens do orçamento
--    com a proposta aplicada (lib/cotacao.ts) — na MESMA transação em que travou a
--    linha pela função 1. Aqui só se grava: a resposta no convite, `detalhe.itens`
--    no orçamento (nada mais do orçamento muda) e os contatos que o fornecedor
--    informou (e-mail/telefone somam; CNPJ só quando veio um válido).
create or replace function cotacao_gravar_resposta(
  p_token text, p_resposta jsonb, p_anexos jsonb, p_dados jsonb,
  p_itens jsonb, p_emails jsonb, p_telefones jsonb, p_tax_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_cv cotacao_convites%rowtype; v_prod uuid;
begin
  select * into v_cv from cotacao_convites where token = p_token;
  if v_cv.id is null then raise exception 'Convite inválido'; end if;
  select producao_id into v_prod from cotacoes where id = v_cv.cotacao_id;

  update cotacao_convites
     set resposta = p_resposta, resposta_anexos = coalesce(p_anexos, '[]'::jsonb), dados_fornecedor = p_dados,
         respondido_em = now(), recusado_em = null, aberto_em = coalesce(aberto_em, now())
   where id = v_cv.id;

  if jsonb_typeof(p_itens) = 'array' then
    update producao set detalhe = jsonb_set(coalesce(detalhe, '{}'::jsonb), '{itens}', p_itens), updated_at = now()
     where id = v_prod;
  end if;

  if jsonb_typeof(p_emails) = 'array' or jsonb_typeof(p_telefones) = 'array' or nullif(p_tax_id, '') is not null then
    update fornecedores
       set emails = case when jsonb_typeof(p_emails) = 'array' then p_emails else emails end,
           telefones = case when jsonb_typeof(p_telefones) = 'array' then p_telefones else telefones end,
           tax_id = coalesce(nullif(p_tax_id, ''), tax_id),
           updated_at = now()
     where id = v_cv.fornecedor_id;
  end if;

  perform cotacao_notificar(v_cv.id, false);
end $$;

-- Só o servidor (flow_auth) executa. Revogar dos TRÊS: os DEFAULT PRIVILEGES deste
-- banco dão EXECUTE a anon e authenticated em toda função nova.
revoke execute on function cotacao_por_token(text, boolean) from public, anon, authenticated;
revoke execute on function cotacao_marcar_aberto(text) from public, anon, authenticated;
revoke execute on function cotacao_notificar(uuid, boolean) from public, anon, authenticated;
revoke execute on function cotacao_recusar(text, text) from public, anon, authenticated;
revoke execute on function cotacao_gravar_resposta(text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function cotacao_por_token(text, boolean) to flow_auth;
grant execute on function cotacao_marcar_aberto(text) to flow_auth;
grant execute on function cotacao_recusar(text, text) to flow_auth;
grant execute on function cotacao_gravar_resposta(text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text) to flow_auth;

notify pgrst, 'reload schema';
