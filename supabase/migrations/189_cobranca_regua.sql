-- 189_cobranca_regua.sql
-- Auditoria 02/08, Financeiro #1: "Régua de cobrança para no D+3 e Inadimplentes
-- é vitrine sem ação". Medido em produção em 03/08 antes de escrever isto:
--
--   · 0 de 14 clientes com cobranca_auto ligado  → a régua nunca disparou nada
--   · org_settings.payment_info VAZIO            → o e-mail sairia sem como pagar
--   · os 6 recebíveis vencidos são origem='conta_azul' — e o cobranca_payload
--     antigo fazia JOIN por mídia/produção → cobria 29 de 643 lançamentos.
--     Mesmo ligando o opt-in, o payload continuaria devolvendo ZERO.
--
-- O elo que faltava é o vínculo lançamento → cliente. `contato_nome` é texto
-- livre vindo do Conta Azul ("Opera Empreendimentos") e não bate com o nome do
-- cliente no Flow ("Opera"): das 85 grafias distintas, só 7 casam por nome.
-- Por isso aqui entram três coisas juntas: coluna `workspace_id` no lançamento,
-- um de-para de grafias (`cliente_aliases`) e um trigger que resolve o vínculo
-- em TODO caminho de escrita — em vez de editar as ~10 RPCs que criam lançamento.
--
-- Idempotente.

-- ── 1. Vínculo lançamento → cliente ─────────────────────────────────────────
-- Primeiro FK de `lancamentos` para `workspaces`: não cria ambiguidade de embed
-- no PostgREST (o problema da 085 só aparece com DOIS FKs pra mesma tabela).
alter table lancamentos add column if not exists workspace_id uuid references workspaces(id) on delete set null;
create index if not exists idx_lanc_workspace on lancamentos(workspace_id) where workspace_id is not null;

-- Promessa de pagamento: enquanto a data prometida não vencer, a régua se cala.
alter table lancamentos add column if not exists promessa_data date;
alter table lancamentos add column if not exists promessa_obs  text;

-- ── 2. De-para de grafias ───────────────────────────────────────────────────
-- unaccent() é STABLE (depende do dicionário), então normalizar só serve pra
-- comparar — nunca pra indexar. O alias é gravado já normalizado.
create or replace function fin_norm_nome(p text)
returns text language sql stable set search_path = public as $$
  select nullif(btrim(lower(unaccent(coalesce(p, '')))), '')
$$;

create table if not exists cliente_aliases (
  org_id       uuid not null references organizations(id) on delete cascade,
  alias        text not null,                     -- contato_nome normalizado
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  primary key (org_id, alias)
);
alter table cliente_aliases enable row level security;
drop policy if exists "fin read cliente_aliases" on cliente_aliases;
create policy "fin read cliente_aliases" on cliente_aliases for select using (fin_can(org_id));

-- Resolve o cliente de um lançamento, na ordem: documento de origem → de-para →
-- nome/razão social/fantasia idênticos. Devolve null quando não dá pra afirmar.
create or replace function fin_resolve_workspace(
  p_org uuid, p_origem_tipo text, p_origem_id uuid, p_contato text
) returns uuid language plpgsql stable set search_path = public as $$
declare v uuid; n text;
begin
  if p_origem_tipo = 'midia' then
    select workspace_id into v from midias where id = p_origem_id;
  elsif p_origem_tipo in ('producao', 'fee') then
    select workspace_id into v from producao where id = p_origem_id;
  end if;
  if v is not null then return v; end if;

  n := fin_norm_nome(p_contato);
  if n is null then return null; end if;

  select workspace_id into v from cliente_aliases where org_id = p_org and alias = n;
  if v is not null then return v; end if;

  select w.id into v from workspaces w
   where w.org_id = p_org and coalesce(w.archived, false) = false
     and n in (fin_norm_nome(w.name), fin_norm_nome(w.legal_name), fin_norm_nome(w.trade_name))
   limit 1;
  return v;
end $$;

-- Trigger em vez de mexer em create_lancamento/promover_extrato/gerar_lancamentos_*/
-- lancar_midia/…: uma regra só, sem risco de um caminho novo esquecer o vínculo.
-- `workspace_id` já preenchido nunca é sobrescrito (vínculo manual vence).
create or replace function _lanc_set_workspace() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.workspace_id is null then
    new.workspace_id := fin_resolve_workspace(new.org_id, new.origem_tipo, new.origem_id, new.contato_nome);
  end if;
  return new;
end $$;
drop trigger if exists trg_lanc_workspace on lancamentos;
create trigger trg_lanc_workspace before insert or update of contato_nome, origem_tipo, origem_id
  on lancamentos for each row execute function _lanc_set_workspace();

update lancamentos l
   set workspace_id = fin_resolve_workspace(l.org_id, l.origem_tipo, l.origem_id, l.contato_nome)
 where l.workspace_id is null;

-- ── 3. Configuração da régua ────────────────────────────────────────────────
-- Chave-geral separada do opt-in por cliente: desligar aqui para o disparo
-- inteiro sem ter que mexer em 14 cadastros.
alter table org_settings add column if not exists cobranca_ativa boolean not null default false;
alter table org_settings add column if not exists cobranca_regua jsonb;

create or replace function fin_regua_default() returns jsonb
language sql immutable as $$ select '[-3,0,3,7,15,30,60,90]'::jsonb $$;

-- 'd-3' | 'd0' | 'd+7' — mesmo formato dos avisos já gravados.
create or replace function fin_bucket(p_offset int) returns text
language sql immutable as $$
  select case when p_offset < 0 then 'd' || p_offset::text
              when p_offset = 0 then 'd0'
              else 'd+' || p_offset::text end
$$;

-- ── 4. Histórico de aviso ───────────────────────────────────────────────────
alter table cobranca_avisos add column if not exists id          uuid not null default gen_random_uuid();
alter table cobranca_avisos add column if not exists canal       text not null default 'auto';  -- auto | manual | baseline
alter table cobranca_avisos add column if not exists email       text;
alter table cobranca_avisos add column if not exists enviado_por uuid;
alter table cobranca_avisos add column if not exists nota        text;

-- A PK era (lancamento_id, bucket) — impedia mais de uma cobrança manual do
-- mesmo título. Vira surrogate + índice único só para o que é régua.
do $$ begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'cobranca_avisos'::regclass and contype = 'p'
       and pg_get_constraintdef(oid) like 'PRIMARY KEY (lancamento_id%'
  ) then
    alter table cobranca_avisos drop constraint cobranca_avisos_pkey;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'cobranca_avisos'::regclass and contype = 'p') then
    alter table cobranca_avisos add constraint cobranca_avisos_pkey primary key (id);
  end if;
end $$;
create unique index if not exists cobranca_avisos_regua_uniq
  on cobranca_avisos (lancamento_id, bucket) where canal <> 'manual';

drop policy if exists "finance read cobranca_avisos" on cobranca_avisos;
create policy "finance read cobranca_avisos" on cobranca_avisos for select using (fin_can(org_id));

-- ── 5. O payload da régua ───────────────────────────────────────────────────
-- Regra: para cada recebível em aberto escolhe o MAIOR degrau já alcançado e
-- ainda não enviado. Título que nasce com 90 dias de atraso recebe UM aviso
-- (o de D+90), nunca a escada inteira retroativa — e no dia seguinte, nada.
-- Silenciado por: régua desligada, payment_info vazio, cliente sem opt-in ou
-- sem e-mail, promessa de pagamento em dia, e o que já foi avisado.
create or replace function cobranca_payload()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not (is_cron() or is_psql_direto()) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v from (
    with cfg as (
      select o.id as org_id, o.slug as org_slug, o.name as org_name,
             coalesce(os.payment_info, '') as payment_info,
             coalesce(os.cobranca_ativa, false) as ativa,
             coalesce(os.cobranca_regua, fin_regua_default()) as regua
        from organizations o
        left join org_settings os on os.org_id = o.id
    ),
    base as (
      select l.id, c.org_slug, c.org_name, c.payment_info, c.regua,
             w.name as cliente, w.finance_email as email,
             coalesce(nullif(l.descricao, ''), 'Cobrança') as descricao,
             round(l.valor - coalesce(l.valor_realizado, 0), 2) as falta,
             l.vencimento, (current_date - l.vencimento) as atraso
        from lancamentos l
        join cfg c        on c.org_id = l.org_id
        join workspaces w on w.id = l.workspace_id
       where l.tipo = 'entrada' and l.situacao = 'em_aberto'
         and c.ativa and c.payment_info <> ''
         and w.cobranca_auto and coalesce(w.finance_email, '') <> ''
         and l.vencimento is not null
         and round(l.valor - coalesce(l.valor_realizado, 0), 2) > 0
         and (l.promessa_data is null or l.promessa_data < current_date)
    ),
    escolha as (
      select b.*, (select max(x::int) from jsonb_array_elements_text(b.regua) x where x::int <= b.atraso) as passo
        from base b
    )
    select e.id as lancamento_id, fin_bucket(e.passo) as bucket,
           e.org_slug, e.org_name, e.cliente, e.email, e.descricao,
           e.falta::float8 as valor, e.vencimento::text as vencimento,
           e.atraso as dias, e.payment_info
      from escolha e
     where e.passo is not null
       and not exists (
         select 1 from cobranca_avisos ca
          where ca.lancamento_id = e.id and ca.canal <> 'manual' and ca.bucket = fin_bucket(e.passo))
  ) t;
  return v;
end $$;

-- Marca o disparo (o cron chama depois do envio confirmado pela Resend).
create or replace function mark_cobranca_aviso(p_lancamento_id uuid, p_bucket text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_cron() or is_psql_direto()) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  insert into cobranca_avisos (lancamento_id, bucket, org_id, canal, email)
  select l.id, p_bucket, l.org_id, 'auto', w.finance_email
    from lancamentos l left join workspaces w on w.id = l.workspace_id
   where l.id = p_lancamento_id
  on conflict do nothing;
end $$;

-- ── 6. Ações da tela de Inadimplentes ───────────────────────────────────────
-- Cobrar agora: registra o envio manual (um por título cobrado). Não dedup —
-- cobrar duas vezes é decisão de quem clica, não erro.
create or replace function registrar_cobranca_manual(
  p_user_id uuid, p_lancamento_ids uuid[], p_email text
) returns int language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_n int;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select org_id into v_org from lancamentos where id = p_lancamento_ids[1];
  if v_org is null then raise exception 'Lançamento não encontrado'; end if;
  if not fin_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  insert into cobranca_avisos (lancamento_id, bucket, org_id, canal, email, enviado_por)
  select l.id, 'manual', l.org_id, 'manual', p_email, p_user_id
    from lancamentos l
   where l.id = any(p_lancamento_ids) and l.org_id = v_org;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function set_lancamento_promessa(
  p_user_id uuid, p_lancamento_id uuid, p_data date, p_obs text
) returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select org_id into v_org from lancamentos where id = p_lancamento_id;
  if v_org is null then raise exception 'Lançamento não encontrado'; end if;
  if not fin_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update lancamentos
     set promessa_data = p_data, promessa_obs = nullif(btrim(coalesce(p_obs, '')), ''), updated_at = now()
   where id = p_lancamento_id;
end $$;

-- Vincular cliente: grava o de-para E carimba todos os lançamentos com aquela
-- grafia. Uma vez por nome — o próximo import do Conta Azul já nasce vinculado.
create or replace function set_cliente_alias(
  p_user_id uuid, p_org_id uuid, p_contato text, p_workspace_id uuid
) returns int language plpgsql security definer set search_path = public as $$
declare n text; v_n int;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not fin_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  n := fin_norm_nome(p_contato);
  if n is null then raise exception 'Informe o nome do contato'; end if;
  if not exists (select 1 from workspaces where id = p_workspace_id and org_id = p_org_id) then
    raise exception 'Cliente não encontrado';
  end if;

  insert into cliente_aliases (org_id, alias, workspace_id, created_by)
  values (p_org_id, n, p_workspace_id, p_user_id)
  on conflict (org_id, alias) do update set workspace_id = excluded.workspace_id;

  update lancamentos set workspace_id = p_workspace_id, updated_at = now()
   where org_id = p_org_id and fin_norm_nome(contato_nome) = n
     and workspace_id is distinct from p_workspace_id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function set_cobranca_config(
  p_user_id uuid, p_org_id uuid, p_ativa boolean, p_regua jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare v_regua jsonb;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not fin_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  -- Régua vazia = régua sem degrau = e-mail nenhum. Melhor recusar do que
  -- deixar a tela dizer "salvo" e a cobrança silenciar.
  if p_regua is not null then
    select coalesce(jsonb_agg(distinct x::int order by x::int), '[]'::jsonb) into v_regua
      from jsonb_array_elements_text(p_regua) x where x ~ '^-?[0-9]+$';
    if jsonb_array_length(v_regua) = 0 then raise exception 'A régua precisa de ao menos um degrau'; end if;
  end if;

  insert into org_settings (org_id, cobranca_ativa, cobranca_regua)
  values (p_org_id, coalesce(p_ativa, false), coalesce(v_regua, fin_regua_default()))
  on conflict (org_id) do update
     set cobranca_ativa = coalesce(p_ativa, false),
         cobranca_regua = coalesce(v_regua, org_settings.cobranca_regua);
end $$;

-- Opt-in por cliente direto da tela de Inadimplentes (o cadastro completo do
-- cliente já tem o mesmo toggle, mas ninguém abre 14 fichas pra ligar a régua).
create or replace function set_cliente_cobranca_auto(
  p_user_id uuid, p_workspace_id uuid, p_ativo boolean
) returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select org_id into v_org from workspaces where id = p_workspace_id;
  if v_org is null then raise exception 'Cliente não encontrado'; end if;
  if not fin_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update workspaces set cobranca_auto = coalesce(p_ativo, false), updated_at = now() where id = p_workspace_id;
end $$;

-- ── 7. Passivo anterior: fora do automático ─────────────────────────────────
-- Decisão do Rafael (03/08): a régua "começa do zero". Sem isto, ligar o
-- opt-in mandaria um aviso de atraso de 136 dias pra Opera na manhã seguinte.
-- Marca TODOS os degraus dos títulos já vencidos hoje — assim nenhum degrau
-- futuro dispara para eles; a cobrança deles é pelo botão "Cobrar agora".
insert into cobranca_avisos (lancamento_id, bucket, org_id, canal, nota)
select l.id, fin_bucket(x::int), l.org_id, 'baseline', 'vencido antes da régua entrar no ar'
  from lancamentos l
  cross join jsonb_array_elements_text(fin_regua_default()) x
 where l.tipo = 'entrada' and l.situacao = 'em_aberto'
   and l.vencimento is not null and l.vencimento < current_date
on conflict do nothing;

-- ── 8. Grants ───────────────────────────────────────────────────────────────
-- Toda função nova nasce executável por anon neste VPS (pg_default_acl) e o
-- Postgres ainda concede a PUBLIC — revogar dos dois.
revoke execute on function cobranca_payload()                                   from public, anon;
revoke execute on function mark_cobranca_aviso(uuid, text)                      from public, anon;
revoke execute on function registrar_cobranca_manual(uuid, uuid[], text)        from public, anon;
revoke execute on function set_lancamento_promessa(uuid, uuid, date, text)      from public, anon;
revoke execute on function set_cliente_alias(uuid, uuid, text, uuid)            from public, anon;
revoke execute on function set_cobranca_config(uuid, uuid, boolean, jsonb)      from public, anon;
revoke execute on function set_cliente_cobranca_auto(uuid, uuid, boolean)       from public, anon;
grant  execute on function cobranca_payload()                                   to authenticated;
grant  execute on function mark_cobranca_aviso(uuid, text)                      to authenticated;
grant  execute on function registrar_cobranca_manual(uuid, uuid[], text)        to authenticated;
grant  execute on function set_lancamento_promessa(uuid, uuid, date, text)      to authenticated;
grant  execute on function set_cliente_alias(uuid, uuid, text, uuid)            to authenticated;
grant  execute on function set_cobranca_config(uuid, uuid, boolean, jsonb)      to authenticated;
grant  execute on function set_cliente_cobranca_auto(uuid, uuid, boolean)       to authenticated;
grant  execute on function fin_norm_nome(text)                                  to authenticated;
grant  execute on function fin_bucket(int)                                      to authenticated;
grant  execute on function fin_regua_default()                                  to authenticated;
grant  select  on cliente_aliases                                               to authenticated;

notify pgrst, 'reload schema';
