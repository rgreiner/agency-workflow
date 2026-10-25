-- 361 — NF de fornecedor/veículo que não chegou (PP e PI/MX) — Flávia cobra
--
-- Decisão do Rafael (25/10/2026): para cada título de comissão de produção (PP)
-- ou mídia (MX/PI) cujo fornecedor/veículo ainda não mandou a NF (anexo NF com
-- emitente 'fornecedor'), a Flávia pede:
--   1. por E-MAIL, 5 dias úteis antes do vencimento (cópia para o financeiro@);
--   2. pelo WHATSAPP, se em 2 dias úteis não chegou;
--   3. depois do vencimento, um lembrete a cada 3 dias úteis.
-- Tudo em lote aprovado pelo Rafael (Digitais). O registro é cobranca_avisos
-- com bucket 'nf_email' / 'nf_whats' / 'nf_lembrete_N' — some sozinho quando a
-- NF é anexada, porque a lista só traz título SEM NF do fornecedor.

-- Soma n dias úteis (n negativo = para trás).
create or replace function public.fin_dias_uteis_add(p_org uuid, p_data date, p_n int)
returns date
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare d date := p_data; passo int := sign(p_n); faltam int := abs(p_n);
begin
  while faltam > 0 loop
    d := d + passo;
    if fin_dia_util(p_org, d) then faltam := faltam - 1; end if;
  end loop;
  return d;
end $$;
revoke execute on function public.fin_dias_uteis_add(uuid, date, int) from public, anon;
grant execute on function public.fin_dias_uteis_add(uuid, date, int) to authenticated;

-- Dias úteis em (a, b].
create or replace function public.fin_dias_uteis_entre(p_org uuid, p_a date, p_b date)
returns int
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::int from generate_series(p_a + 1, p_b, interval '1 day') d where fin_dia_util(p_org, d::date);
$$;
revoke execute on function public.fin_dias_uteis_entre(uuid, date, date) from public, anon;
grant execute on function public.fin_dias_uteis_entre(uuid, date, date) to authenticated;

-- Contato do cadastro de fornecedor/veículo: e-mail e telefone, preferindo o
-- que estiver marcado como financeiro.
create or replace function public._fin_contato_cadastro(p_emails jsonb, p_telefones jsonb)
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  select jsonb_build_object(
    'email', (select lower(btrim(e->>'email')) from jsonb_array_elements(coalesce(p_emails, '[]'::jsonb)) with ordinality as x(e, i)
               where coalesce(e->>'email', '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
               order by (coalesce(e->>'tipo', '') ilike '%financ%') desc, i limit 1),
    'telefone', (select regexp_replace(t->>'numero', '\D', '', 'g') from jsonb_array_elements(coalesce(p_telefones, '[]'::jsonb)) with ordinality as x(t, i)
               where regexp_replace(coalesce(t->>'numero', ''), '\D', '', 'g') ~ '^\d{10,13}$'
               order by (coalesce(t->>'tipo', '') ~* 'financ|whats') desc, i limit 1),
    'nome', (select nullif(btrim(split_part(coalesce(t->>'tipo', ''), '|', 2)), '') from jsonb_array_elements(coalesce(p_telefones, '[]'::jsonb)) t
               where coalesce(t->>'tipo', '') ilike '%financ%' limit 1));
$$;
revoke execute on function public._fin_contato_cadastro(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.fin_nf_fornecedor_pendente(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v jsonb; v_hoje date := fin_hoje();
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if not fin_dia_util(p_org, v_hoje) then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.fornecedor, t.vencimento), '[]'::jsonb) into v from (
    with base as (
      select l.id as lancamento_id, l.contato_tipo, l.contato_id,
             coalesce(f.name, ve.name) as fornecedor,
             _fin_contato_cadastro(coalesce(f.emails, ve.emails), coalesce(f.telefones, ve.telefones)) as contato,
             nullif(btrim(coalesce(d.doc_serie, '') || ' ' || coalesce(d.doc_numero::text, '')), '') as documento,
             coalesce(nullif(l.descricao, ''), 'Comissão') as descricao,
             l.valor::float8 as valor, l.vencimento
        from lancamentos l
        join lancamentos_doc d on d.id = l.id
        left join fornecedores f on l.contato_tipo = 'fornecedor' and f.id = l.contato_id and not f.archived
        left join veiculos ve    on l.contato_tipo = 'veiculo'    and ve.id = l.contato_id and not ve.archived
       where l.org_id = p_org and l.tipo = 'entrada' and l.situacao = 'em_aberto'
         and l.origem_tipo in ('producao', 'midia') and l.contato_tipo in ('fornecedor', 'veiculo')
         and l.vencimento is not null and coalesce(f.id, ve.id) is not null
         and not exists (select 1 from jsonb_array_elements(l.anexos) x where x->>'tipo' = 'NF' and x->>'emitente' = 'fornecedor')
         and v_hoje >= fin_dias_uteis_add(p_org, l.vencimento, -5)
    ), hist as (
      select b.*,
             (select max(sent_at) from cobranca_avisos ca where ca.lancamento_id = b.lancamento_id and ca.bucket = 'nf_email') as em_email,
             (select max(sent_at) from cobranca_avisos ca where ca.lancamento_id = b.lancamento_id and ca.bucket = 'nf_whats') as em_whats,
             (select max(sent_at) from cobranca_avisos ca where ca.lancamento_id = b.lancamento_id and ca.bucket like 'nf\_%') as ultimo,
             (select count(*) from cobranca_avisos ca where ca.lancamento_id = b.lancamento_id and ca.bucket like 'nf\_lembrete\_%') as lembretes
        from base b
    ), passo as (
      select h.*, case
          when h.em_email is null and h.em_whats is null and h.contato->>'email' is not null then 'nf_email'
          when h.em_whats is null and h.contato->>'telefone' is not null
               and (h.em_email is null or fin_dias_uteis_entre(p_org, (h.em_email at time zone 'America/Sao_Paulo')::date, v_hoje) >= 2) then 'nf_whats'
          when v_hoje > h.vencimento and h.ultimo is not null
               and fin_dias_uteis_entre(p_org, (h.ultimo at time zone 'America/Sao_Paulo')::date, v_hoje) >= 3 then 'nf_lembrete_' || (h.lembretes + 1)
        end as bucket
        from hist h
    )
    select p.lancamento_id, p.contato_tipo, p.contato_id, p.fornecedor,
           p.contato->>'nome' as contato_nome, p.contato->>'email' as email, p.contato->>'telefone' as telefone,
           p.documento, p.descricao, p.valor, p.vencimento::text as vencimento,
           (v_hoje - p.vencimento) as dias, p.bucket,
           case when p.bucket = 'nf_email' then 'email'
                when p.bucket = 'nf_whats' then 'whatsapp'
                when p.contato->>'telefone' is not null then 'whatsapp' else 'email' end as canal
      from passo p
     where p.bucket is not null
       and (p.contato->>'email' is not null or p.contato->>'telefone' is not null)
  ) t;
  return v;
end $$;
revoke execute on function public.fin_nf_fornecedor_pendente(uuid) from public, anon;
grant execute on function public.fin_nf_fornecedor_pendente(uuid) to authenticated;

-- Registro genérico do que o agente mandou (canal + destino). Idempotente.
create or replace function public.fin_registrar_envio_agente(p_lancamento_id uuid, p_bucket text, p_canal text, p_destino text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_org uuid;
begin
  select org_id into v_org from lancamentos where id = p_lancamento_id;
  if v_org is null or not fin_can(v_org) then raise exception 'Título não encontrado'; end if;
  if coalesce(btrim(p_bucket), '') = '' or p_canal not in ('whatsapp', 'email') then raise exception 'Envio inválido'; end if;
  insert into cobranca_avisos (lancamento_id, bucket, org_id, canal, email, enviado_por, nota)
  select p_lancamento_id, p_bucket, v_org, p_canal,
         case when p_canal = 'email' then p_destino end, auth.uid(),
         case when p_canal = 'whatsapp' then 'WhatsApp ' || coalesce(p_destino, '') end
   where not exists (select 1 from cobranca_avisos where lancamento_id = p_lancamento_id and bucket = p_bucket and canal = p_canal);
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.fin_registrar_envio_agente(uuid, text, text, text) from public, anon;
grant execute on function public.fin_registrar_envio_agente(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
