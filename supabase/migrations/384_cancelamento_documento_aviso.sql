-- 384 — Cancelamento de documento (MX/PP) com aviso aos contatos pela Flávia.
--
-- Origem (27/10/2026): o cliente cancelou MX já autorizadas (É O Amor — 1639, 1640,
-- 1641, 1645). Cancelar a MX só trocava a situação: os lançamentos de comissão
-- seguiam em aberto e a Flávia (que só lê lançamento em aberto) ia pedir NF e
-- cobrar o veículo. E a exclusão pela tela de Lançamentos ESTORNA o faturamento
-- (a MX volta para "A faturar") — serve para refaturar, não para cancelar.
--
-- Agora:
--  · documento_cancelamentos guarda o que foi removido (foto dos lançamentos) e
--    a quem avisar — é o rastro que sobra depois de o lançamento sumir;
--  · cancelar_documento_midia remove os lançamentos SEM estornar (a MX fica
--    Cancelada) e recusa se algum já foi movimentado (baixa, conciliação);
--  · a Flávia lê fin_cancelamentos_avisar e marca o envio por canal em
--    fin_cancelamento_avisado (e-mail e WhatsApp, cada um uma vez).

create table if not exists public.documento_cancelamentos (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  origem_tipo   text not null check (origem_tipo in ('midia', 'producao')),
  origem_id     uuid not null,
  documento     text,                       -- "MX 1639"
  titulo        text,
  cliente       text,
  contato_tipo  text,                       -- veiculo | fornecedor | cliente
  contato_id    uuid,
  contato_nome  text,
  valor         numeric(14,2) not null default 0,
  lancamentos   jsonb not null default '[]'::jsonb,   -- foto do que foi removido
  cancelado_em  timestamptz not null default now(),
  cancelado_por uuid,
  aviso_email_em    timestamptz,
  aviso_email_para  text,
  aviso_whats_em    timestamptz,
  aviso_whats_para  text,
  aviso_dispensado  boolean not null default false
);
create unique index if not exists documento_cancelamentos_doc_contato
  on public.documento_cancelamentos (origem_tipo, origem_id, coalesce(contato_tipo, ''), coalesce(contato_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists documento_cancelamentos_org on public.documento_cancelamentos (org_id, cancelado_em desc);

alter table public.documento_cancelamentos enable row level security;
drop policy if exists "Financeiro lê cancelamentos" on public.documento_cancelamentos;
create policy "Financeiro lê cancelamentos" on public.documento_cancelamentos
  for select using (fin_can(org_id));
-- Escrita só pelas funções abaixo (SECURITY DEFINER).

-- ── Núcleo: registra e remove (sem checar quem chama — helper interno) ─────────
create or replace function public._doc_cancelar_lancamentos(p_origem_tipo text, p_origem_id uuid, p_user uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_bloq text; v_n int := 0; v_org uuid; v_doc text; v_titulo text; v_cliente text;
begin
  if p_origem_tipo = 'midia' then
    select m.org_id, nullif(btrim(coalesce(m.serie, 'MX') || ' ' || coalesce(m.numero::text, '')), ''), m.titulo, w.name
      into v_org, v_doc, v_titulo, v_cliente
      from midias m left join workspaces w on w.id = m.workspace_id where m.id = p_origem_id;
  else
    select p.org_id, nullif(btrim(coalesce(p.serie, 'PP') || ' ' || coalesce(p.numero::text, '')), ''), p.titulo, w.name
      into v_org, v_doc, v_titulo, v_cliente
      from producao p left join workspaces w on w.id = p.workspace_id where p.id = p_origem_id;
  end if;
  if v_org is null then raise exception 'Documento não encontrado'; end if;

  select string_agg(distinct b, ' ') into v_bloq from (
    select _lancamento_bloqueio_exclusao(l.id) b from lancamentos l
     where l.org_id = v_org and l.origem_tipo = p_origem_tipo and l.origem_id = p_origem_id
  ) t where b is not null;
  if v_bloq is not null then
    raise exception 'Este documento já tem lançamento movimentado — fale com o financeiro: %', v_bloq;
  end if;

  -- Uma linha por contato do documento (veículo da comissão, cliente da produção…).
  insert into documento_cancelamentos
    (org_id, origem_tipo, origem_id, documento, titulo, cliente, contato_tipo, contato_id, contato_nome, valor, lancamentos, cancelado_por)
  select v_org, p_origem_tipo, p_origem_id, v_doc, v_titulo, v_cliente,
         l.contato_tipo, l.contato_id, max(l.contato_nome), sum(l.valor),
         jsonb_agg(jsonb_build_object('id', l.id, 'descricao', l.descricao, 'valor', l.valor, 'vencimento', l.vencimento,
                                      'competencia', l.competencia, 'origem_parte', l.origem_parte, 'tipo', l.tipo) order by l.vencimento),
         p_user
    from lancamentos l
   where l.org_id = v_org and l.origem_tipo = p_origem_tipo and l.origem_id = p_origem_id
   group by l.contato_tipo, l.contato_id
  on conflict do nothing;

  delete from lancamentos
   where org_id = v_org and origem_tipo = p_origem_tipo and origem_id = p_origem_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'documento', v_doc, 'removidos', v_n);
end $$;
revoke execute on function public._doc_cancelar_lancamentos(text, uuid, uuid) from public, anon, authenticated;

-- ── Cancelar a MX: tira os lançamentos e deixa Cancelada (não estorna) ────────
create or replace function public.cancelar_documento_midia(p_user_id uuid, p_midia_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from midias m join organization_members om on om.org_id = m.org_id
     where m.id = p_midia_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  v := _doc_cancelar_lancamentos('midia', p_midia_id, p_user_id);
  update midias set situacao = 'cancelado', updated_at = now() where id = p_midia_id;
  return v;
end $$;
revoke execute on function public.cancelar_documento_midia(uuid, uuid) from public, anon;
grant execute on function public.cancelar_documento_midia(uuid, uuid) to authenticated;

-- ── Flávia: o que falta avisar ─────────────────────────────────────────────
create or replace function public.fin_cancelamentos_avisar(p_org uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(row_to_json(t) order by t.contato, t.documento), '[]'::jsonb) into v from (
    select c.id, c.origem_tipo, c.documento, c.titulo, c.cliente, c.contato_tipo, c.contato_id,
           coalesce(f.name, ve.name, w.name, c.contato_nome) as contato,
           k->>'nome' as contato_nome, k->>'email' as email, k->>'telefone' as telefone,
           c.valor::float8 as valor, c.lancamentos, c.cancelado_em,
           c.aviso_email_em is not null as email_feito, c.aviso_whats_em is not null as whats_feito
      from documento_cancelamentos c
      left join fornecedores f on c.contato_tipo = 'fornecedor' and f.id = c.contato_id
      left join veiculos ve    on c.contato_tipo = 'veiculo'    and ve.id = c.contato_id
      left join workspaces w   on c.contato_tipo = 'cliente'    and w.id = c.contato_id
      cross join lateral (select _fin_contato_cadastro(coalesce(f.emails, ve.emails), coalesce(f.telefones, ve.telefones)) as k) kk
     where c.org_id = p_org and not c.aviso_dispensado
       and c.contato_tipo in ('veiculo', 'fornecedor')
       and ((c.aviso_email_em is null and k->>'email' is not null)
         or (c.aviso_whats_em is null and k->>'telefone' is not null))
  ) t;
  return v;
end $$;
revoke execute on function public.fin_cancelamentos_avisar(uuid) from public, anon;
grant execute on function public.fin_cancelamentos_avisar(uuid) to authenticated;

-- ── Flávia: marca o aviso de um canal como feito ───────────────────────────
create or replace function public.fin_cancelamento_avisado(p_id uuid, p_canal text, p_destino text)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from documento_cancelamentos where id = p_id;
  if v_org is null then raise exception 'Cancelamento não encontrado'; end if;
  if not fin_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_canal = 'email' then
    update documento_cancelamentos set aviso_email_em = now(), aviso_email_para = p_destino where id = p_id;
  elsif p_canal = 'whatsapp' then
    update documento_cancelamentos set aviso_whats_em = now(), aviso_whats_para = p_destino where id = p_id;
  else
    raise exception 'Canal inválido';
  end if;
end $$;
revoke execute on function public.fin_cancelamento_avisado(uuid, text, text) from public, anon;
grant execute on function public.fin_cancelamento_avisado(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
