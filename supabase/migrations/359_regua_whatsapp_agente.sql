-- 359 — Régua de cobrança e envio dos documentos do mês pelo WhatsApp (Flávia)
--
-- Decisão do Rafael (24/10/2026): a régua do Flow É a regra (degraus de
-- org_settings.cobranca_regua, padrão D-3, D0, D+3, D+7…) e a Flávia a executa
-- pelo WhatsApp — só em DIA ÚTIL (seg–sex e fora de rh_feriado). No 1º dia útil
-- do mês saem NF + boleto de cada cobrança do mês para o cliente.
--
-- O registro é o mesmo da régua por e-mail (cobranca_avisos, canal 'whatsapp'),
-- então um degrau já avisado não se repete por nenhum canal, e o "marco zero"
-- (canal baseline, mig. 189) continua fora do automático.
-- Portões: cliente com cobranca_auto (opt-in de cobrança automática) e telefone.
-- A chave-geral cobranca_ativa é do E-MAIL; a do WhatsApp é a alçada da Flávia.

-- "Hoje" em Brasília: current_date do banco é UTC e, depois das 21h, já é amanhã.
create or replace function public.fin_hoje()
returns date
language sql
stable
set search_path to 'public'
as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
grant execute on function public.fin_hoje() to authenticated;

-- Dia útil da org: seg–sex e não feriado do calendário do RH.
create or replace function public.fin_dia_util(p_org uuid, p_data date)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select extract(isodow from p_data) < 6
     and not exists (select 1 from rh_feriado f where f.org_id = p_org and f.data = p_data and f.tipo = 'feriado');
$$;
revoke execute on function public.fin_dia_util(uuid, date) from public, anon;
grant execute on function public.fin_dia_util(uuid, date) to authenticated;

create or replace function public.fin_primeiro_dia_util(p_org uuid, p_mes date)
returns date
language sql
stable
security definer
set search_path to 'public'
as $$
  select min(d)::date from generate_series(date_trunc('month', p_mes)::date, (date_trunc('month', p_mes) + interval '14 days')::date, interval '1 day') d
   where fin_dia_util(p_org, d::date);
$$;
revoke execute on function public.fin_primeiro_dia_util(uuid, date) from public, anon;
grant execute on function public.fin_primeiro_dia_util(uuid, date) to authenticated;

-- Telefone do financeiro do cliente: entrada da lista marcada "financeiro",
-- senão a 1ª da lista, senão o telefone principal. Nome = o que vem depois do "|".
create or replace function public._fin_whats_cliente(w workspaces)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with lista as (
    select e.t, e.i from jsonb_array_elements(coalesce(w.telefones, '[]'::jsonb)) with ordinality as e(t, i)
     where regexp_replace(coalesce(t->>'numero', ''), '\D', '', 'g') ~ '^\d{10,13}$'
  ), escolhido as (
    select t from lista order by (coalesce(t->>'tipo', '') ilike '%financ%') desc, i limit 1
  )
  select case
    when exists (select 1 from escolhido) then (
      select jsonb_build_object(
        'telefone', regexp_replace(t->>'numero', '\D', '', 'g'),
        'nome', coalesce(nullif(btrim(split_part(coalesce(t->>'tipo', ''), '|', 2)), ''), nullif(btrim(w.contact_name), ''), w.name))
      from escolhido)
    when regexp_replace(coalesce(w.phone, ''), '\D', '', 'g') ~ '^\d{10,13}$' then
      jsonb_build_object('telefone', regexp_replace(w.phone, '\D', '', 'g'), 'nome', coalesce(nullif(btrim(w.contact_name), ''), w.name))
    else null end;
$$;
revoke execute on function public._fin_whats_cliente(workspaces) from public, anon, authenticated;

-- Base comum: a receber em aberto, do cliente (mesma trava do cobranca_payload:
-- quem paga é o cliente — nome igual ou alias), com opt-in e telefone.
create or replace function public._fin_receber_whats(p_org uuid)
returns table (lancamento_id uuid, workspace_id uuid, cliente text, contato jsonb, descricao text,
               valor numeric, vencimento date, atraso int, anexos jsonb)
language sql
stable
security definer
set search_path to 'public'
as $$
  select l.id, w.id, w.name, _fin_whats_cliente(w),
         coalesce(nullif(l.descricao, ''), 'Cobrança'),
         round(l.valor - coalesce(l.valor_realizado, 0), 2),
         l.vencimento, (fin_hoje() - l.vencimento), l.anexos
    from lancamentos l
    join workspaces w on w.id = l.workspace_id
   where l.org_id = p_org and l.tipo = 'entrada' and l.situacao = 'em_aberto'
     and w.cobranca_auto and not w.archived
     and _fin_whats_cliente(w) is not null
     and l.vencimento is not null
     and round(l.valor - coalesce(l.valor_realizado, 0), 2) > 0
     and (l.promessa_data is null or l.promessa_data < fin_hoje())
     and (
       fin_norm_nome(l.contato_nome) = fin_norm_nome(w.name)
       or exists (select 1 from cliente_aliases a
                   where a.org_id = l.org_id and a.workspace_id = w.id and a.alias = fin_norm_nome(l.contato_nome))
     );
$$;
revoke execute on function public._fin_receber_whats(uuid) from public, anon, authenticated;

-- Degraus da régua devidos HOJE pelo WhatsApp (mesma escolha do cobranca_payload:
-- o maior degrau alcançado e ainda não avisado, sem escada retroativa).
create or replace function public.fin_regua_whatsapp(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v jsonb; v_regua jsonb;
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if not fin_dia_util(p_org, fin_hoje()) then return '[]'::jsonb; end if;
  select coalesce(os.cobranca_regua, fin_regua_default()) into v_regua from org_settings os where os.org_id = p_org;
  v_regua := coalesce(v_regua, fin_regua_default());

  select coalesce(jsonb_agg(row_to_json(t) order by t.dias desc), '[]'::jsonb) into v from (
    select b.lancamento_id, fin_bucket(p.passo) as bucket, p.passo, b.workspace_id, b.cliente,
           b.contato->>'nome' as contato_nome, b.contato->>'telefone' as telefone,
           b.descricao, b.valor::float8 as valor, b.vencimento::text as vencimento, b.atraso as dias
      from _fin_receber_whats(p_org) b
      cross join lateral (select max(x::int) as passo from jsonb_array_elements_text(v_regua) x where x::int <= b.atraso) p
     where p.passo is not null
       and not exists (select 1 from cobranca_avisos ca
                        where ca.lancamento_id = b.lancamento_id and ca.canal <> 'manual' and ca.bucket = fin_bucket(p.passo))
  ) t;
  return v;
end $$;
revoke execute on function public.fin_regua_whatsapp(uuid) from public, anon;
grant execute on function public.fin_regua_whatsapp(uuid) to authenticated;

-- Documentos do mês (NF + boleto) a partir do 1º dia útil: cobranças que vencem
-- neste mês com NF e boleto anexados e ainda não enviadas por WhatsApp. Quem
-- ficar pronto depois do dia 1 sai no dia útil seguinte.
create or replace function public.fin_documentos_whatsapp(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if not fin_dia_util(p_org, fin_hoje()) or fin_hoje() < fin_primeiro_dia_util(p_org, fin_hoje()) then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(row_to_json(t) order by t.vencimento), '[]'::jsonb) into v from (
    select b.lancamento_id, b.workspace_id, b.cliente,
           b.contato->>'nome' as contato_nome, b.contato->>'telefone' as telefone,
           b.descricao, b.valor::float8 as valor, b.vencimento::text as vencimento,
           (select n.numero from nota_fiscal n where n.lancamento_id = b.lancamento_id and n.status = 'autorizada' limit 1) as nf_numero,
           b.anexos
      from _fin_receber_whats(p_org) b
     where b.vencimento >= date_trunc('month', fin_hoje())::date
       and b.vencimento < (date_trunc('month', fin_hoje()) + interval '1 month')::date
       and exists (select 1 from jsonb_array_elements(b.anexos) x where x->>'tipo' = 'NF' and coalesce(x->>'url', '') <> '')
       and exists (select 1 from jsonb_array_elements(b.anexos) x where x->>'tipo' = 'Boleto' and coalesce(x->>'url', '') <> '')
       and not exists (select 1 from cobranca_avisos ca where ca.lancamento_id = b.lancamento_id and ca.bucket = 'documentos')
  ) t;
  return v;
end $$;
revoke execute on function public.fin_documentos_whatsapp(uuid) from public, anon;
grant execute on function public.fin_documentos_whatsapp(uuid) to authenticated;

-- Registro do envio (degrau da régua ou 'documentos'). Idempotente.
create or replace function public.fin_registrar_envio_whatsapp(p_lancamento_id uuid, p_bucket text, p_telefone text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_org uuid;
begin
  select org_id into v_org from lancamentos where id = p_lancamento_id;
  if v_org is null or not fin_can(v_org) then raise exception 'Título não encontrado'; end if;
  if coalesce(btrim(p_bucket), '') = '' then raise exception 'Degrau vazio'; end if;
  insert into cobranca_avisos (lancamento_id, bucket, org_id, canal, enviado_por, nota)
  select p_lancamento_id, p_bucket, v_org, 'whatsapp', auth.uid(), 'WhatsApp ' || coalesce(p_telefone, '')
   where not exists (select 1 from cobranca_avisos where lancamento_id = p_lancamento_id and bucket = p_bucket and canal = 'whatsapp');
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.fin_registrar_envio_whatsapp(uuid, text, text) from public, anon;
grant execute on function public.fin_registrar_envio_whatsapp(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
