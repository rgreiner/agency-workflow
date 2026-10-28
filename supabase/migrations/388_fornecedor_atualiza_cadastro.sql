-- 388 — fornecedor atualiza o próprio cadastro por link (28/10/2026)
--
-- Pedido do Rafael: a Flávia manda a cada fornecedor um link para ele completar o
-- cadastro (contatos comercial e financeiro, o que fornece, cidade), para a cotação
-- achar quem chamar — e avisa que os pedidos de orçamento passam a ser todos pelo
-- sistema. Mesmas regras do link de cotação (mig. 310/311): e-mail e WhatsApp SOMAM,
-- CNPJ válido substitui, nome do fornecedor nunca muda. Conta bancária NÃO entra
-- (trocar conta por link é o golpe mais comum — fica com o Rafael).
--
-- A página pública (/fornecedor/<token>) fala pela conexão direta (`flow_auth`):
-- funções SECURITY DEFINER que só aceitam o token, executáveis só pelo flow_auth.
-- A Flávia gera e acompanha os convites pela API de agentes (fin_agente_folha).

create table if not exists fornecedor_cadastro_convites (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  fornecedor_id uuid not null references fornecedores(id) on delete cascade,
  token         text not null unique,
  criado_em     timestamptz not null default now(),
  enviado_em    timestamptz,
  canais        text[] not null default '{}',
  lembrete_em   timestamptz,
  aberto_em     timestamptz,
  respondido_em timestamptz,
  resposta      jsonb
);
create index if not exists fornecedor_cadastro_convites_forn on fornecedor_cadastro_convites (fornecedor_id);
alter table fornecedor_cadastro_convites enable row level security;
-- Só leitura para o financeiro; o token mora aqui, então anon não lê.
drop policy if exists "Finance read cadastro convites" on fornecedor_cadastro_convites;
create policy "Finance read cadastro convites" on fornecedor_cadastro_convites for select using (fin_can(org_id));
comment on table fornecedor_cadastro_convites is 'Link para o fornecedor atualizar o próprio cadastro (mig. 388). Token = credencial.';

-- ── Página pública (flow_auth) ──────────────────────────────────────────────

create or replace function fornecedor_cadastro_por_token(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'id', cv.id, 'org_id', cv.org_id, 'fornecedor_id', cv.fornecedor_id, 'agencia', o.name,
    'respondido_em', cv.respondido_em, 'resposta', cv.resposta,
    'fornecedor', jsonb_build_object('nome', f.name, 'razao', f.legal_name, 'tax_id', f.tax_id, 'tipo', f.tipo,
                                     'tags', coalesce(to_jsonb(f.tags), '[]'::jsonb), 'emails', coalesce(f.emails, '[]'::jsonb),
                                     'telefones', coalesce(f.telefones, '[]'::jsonb), 'enderecos', coalesce(f.enderecos, '[]'::jsonb)),
    -- Os tipos que a agência já usa: o fornecedor escolhe entre eles (é o filtro da cotação).
    'tipos', (select coalesce(jsonb_agg(t order by t), '[]'::jsonb) from (
                select distinct btrim(x.tipo) as t from fornecedores x
                 where x.org_id = cv.org_id and not x.archived and coalesce(btrim(x.tipo), '') not in ('', 'Outros')) s)
  ) into v
    from fornecedor_cadastro_convites cv
    join fornecedores f on f.id = cv.fornecedor_id and not f.archived
    join organizations o on o.id = cv.org_id
   where cv.token = p_token;
  return v;
end $$;

create or replace function fornecedor_cadastro_aberto(p_token text)
returns void language sql security definer set search_path = public as $$
  update fornecedor_cadastro_convites set aberto_em = coalesce(aberto_em, now()) where token = p_token;
$$;

-- O servidor da página já saneou e SOMOU (e-mails/telefones/tags/endereço); aqui só grava.
create or replace function fornecedor_cadastro_gravar(
  p_token text, p_resposta jsonb, p_razao text, p_tax_id text, p_tipo text,
  p_tags text[], p_emails jsonb, p_telefones jsonb, p_enderecos jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_cv fornecedor_cadastro_convites;
begin
  select * into v_cv from fornecedor_cadastro_convites where token = p_token for update;
  if not found then raise exception 'Link inválido'; end if;
  update fornecedor_cadastro_convites set resposta = p_resposta, respondido_em = now(), aberto_em = coalesce(aberto_em, now())
   where id = v_cv.id;
  update fornecedores set
         legal_name = coalesce(nullif(btrim(p_razao), ''), legal_name),
         tax_id     = coalesce(nullif(p_tax_id, ''), tax_id),
         tipo       = case when coalesce(btrim(tipo), '') in ('', 'Outros') and nullif(btrim(p_tipo), '') is not null then btrim(p_tipo) else tipo end,
         tags       = coalesce(p_tags, tags),
         emails     = case when jsonb_typeof(p_emails) = 'array' then p_emails else emails end,
         telefones  = case when jsonb_typeof(p_telefones) = 'array' then p_telefones else telefones end,
         enderecos  = case when jsonb_typeof(p_enderecos) = 'array' then p_enderecos else enderecos end,
         updated_at = now()
   where id = v_cv.fornecedor_id;
end $$;

revoke execute on function fornecedor_cadastro_por_token(text) from public, anon, authenticated;
revoke execute on function fornecedor_cadastro_aberto(text) from public, anon, authenticated;
revoke execute on function fornecedor_cadastro_gravar(text, jsonb, text, text, text, text[], jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function fornecedor_cadastro_por_token(text) to flow_auth;
grant execute on function fornecedor_cadastro_aberto(text) to flow_auth;
grant execute on function fornecedor_cadastro_gravar(text, jsonb, text, text, text, text[], jsonb, jsonb, jsonb) to flow_auth;

-- ── Flávia (API de agentes) ─────────────────────────────────────────────────

-- Público da campanha: onda 1 = quem trabalhou com a agência (lançamento, pedido
-- ou cotação nos últimos 18 meses); onda 2 = o resto com e-mail ou telefone.
-- Fica de fora quem já respondeu ou já recebeu o convite.
create or replace function fin_cadastro_publico(p_org uuid, p_onda int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not fin_agente_folha(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  with ativos as (
    select contato_id as id from lancamentos where org_id = p_org and contato_tipo = 'fornecedor'
       and coalesce(vencimento, created_at::date) >= current_date - 540
    union select nullif(detalhe->>'fornecedor_id', '')::uuid from producao where org_id = p_org and created_at >= now() - interval '540 days'
    union select fornecedor_id from cotacao_convites where org_id = p_org and created_at >= now() - interval '540 days'
  )
  select coalesce(jsonb_agg(row_to_json(t) order by t.nome), '[]'::jsonb) into v from (
    select f.id as fornecedor_id, f.name as nome, f.tipo,
           (select lower(btrim(e->>'email')) from jsonb_array_elements(coalesce(f.emails, '[]')) with ordinality x(e, i)
             where coalesce(e->>'email', '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
             order by (coalesce(e->>'tipo', '') ~* 'comerc|vend|orc') desc, i limit 1) as email,
           (select regexp_replace(t->>'numero', '\D', '', 'g') from jsonb_array_elements(coalesce(f.telefones, '[]')) with ordinality x(t, i)
             where regexp_replace(coalesce(t->>'numero', ''), '\D', '', 'g') ~ '^\d{10,13}$'
               and regexp_replace(t->>'numero', '\D', '', 'g') !~ '^(55)?\d{2}[2-5]\d{7}$'   -- fixo não recebe WhatsApp
             order by (coalesce(t->>'tipo', '') ~* 'whats|comerc|cel') desc, i limit 1) as whatsapp,
           nullif(btrim(split_part(coalesce((select t->>'tipo' from jsonb_array_elements(coalesce(f.telefones, '[]')) t
                                             where coalesce(t->>'tipo', '') like '%|%' limit 1), ''), '|', 2)), '') as contato_nome,
           f.id in (select id from ativos) as ativo
      from fornecedores f
     where f.org_id = p_org and not f.archived
       and (p_onda = 2 or f.id in (select id from ativos))
       and not (p_onda = 2 and f.id in (select id from ativos))
       and not exists (select 1 from fornecedor_cadastro_convites c where c.fornecedor_id = f.id and (c.enviado_em is not null or c.respondido_em is not null))
  ) t where t.email is not null or t.whatsapp is not null;
  return v;
end $$;

-- Cria (ou reaproveita, se ainda não enviado) o convite de cada fornecedor e devolve o token.
create or replace function fin_cadastro_convites_gerar(p_org uuid, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not fin_agente_folha(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  insert into fornecedor_cadastro_convites (org_id, fornecedor_id, token)
  select p_org, f.id, encode(gen_random_bytes(32), 'hex')
    from fornecedores f
   where f.org_id = p_org and f.id = any(p_ids) and not f.archived
     and not exists (select 1 from fornecedor_cadastro_convites c where c.fornecedor_id = f.id);
  select coalesce(jsonb_agg(jsonb_build_object('convite_id', c.id, 'fornecedor_id', c.fornecedor_id, 'token', c.token,
                                               'enviado_em', c.enviado_em, 'respondido_em', c.respondido_em)), '[]'::jsonb)
    into v from fornecedor_cadastro_convites c where c.org_id = p_org and c.fornecedor_id = any(p_ids);
  return v;
end $$;

create or replace function fin_cadastro_marcar_envio(p_org uuid, p_convite uuid, p_canal text, p_lembrete boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not fin_agente_folha(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update fornecedor_cadastro_convites
     set enviado_em = coalesce(enviado_em, now()),
         canais = case when p_canal = any(canais) then canais else canais || p_canal end,
         lembrete_em = case when p_lembrete then now() else lembrete_em end
   where id = p_convite and org_id = p_org;
end $$;

-- Acompanhamento: quem recebeu, abriu, respondeu; e quem está no ponto do lembrete.
create or replace function fin_cadastro_convites(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not fin_agente_folha(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'convite_id', c.id, 'fornecedor_id', c.fornecedor_id, 'nome', f.name, 'token', c.token,
           'enviado_em', c.enviado_em, 'canais', c.canais, 'lembrete_em', c.lembrete_em,
           'aberto_em', c.aberto_em, 'respondido_em', c.respondido_em,
           'lembrar', c.enviado_em is not null and c.respondido_em is null and c.lembrete_em is null
                      and fin_dias_uteis_entre(p_org, (c.enviado_em at time zone 'America/Sao_Paulo')::date, fin_hoje()) >= 5)
           order by c.enviado_em desc nulls last), '[]'::jsonb)
    into v from fornecedor_cadastro_convites c join fornecedores f on f.id = c.fornecedor_id
   where c.org_id = p_org;
  return v;
end $$;

revoke execute on function fin_cadastro_publico(uuid, int) from public, anon;
revoke execute on function fin_cadastro_convites_gerar(uuid, uuid[]) from public, anon;
revoke execute on function fin_cadastro_marcar_envio(uuid, uuid, text, boolean) from public, anon;
revoke execute on function fin_cadastro_convites(uuid) from public, anon;
grant execute on function fin_cadastro_publico(uuid, int) to authenticated;
grant execute on function fin_cadastro_convites_gerar(uuid, uuid[]) to authenticated;
grant execute on function fin_cadastro_marcar_envio(uuid, uuid, text, boolean) to authenticated;
grant execute on function fin_cadastro_convites(uuid) to authenticated;

notify pgrst, 'reload schema';
