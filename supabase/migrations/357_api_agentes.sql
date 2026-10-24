-- 357 — API de agentes v1 (Digitais / Flávia)
--
-- Os funcionários digitais (repo rgreiner/digitais) operam o Flow só por
-- /api/agente/v1/<operação>. Cada agente é uma USUÁRIA do Flow (membro do
-- financeiro, sem senha — não entra pela tela); a rota troca o token do agente
-- por um JWT curto dessa usuária, então RLS, travas de mês fechado e autoria
-- valem igual às da tela.
--
-- 1. agente_tokens: o token do agente guardado só como sha256. Sem policy e sem
--    grant: só a conexão direta (servidor) lê. Revogar = preencher revogado_em.
-- 2. lancamento_historico: o que mudou num título por fora da edição normal
--    (prorrogação a pedido do cliente, anotação de conversa). A prorrogação
--    conta quantas vezes o vencimento já mudou — régua para o Rafael decidir.
-- 3. lancamento_prorrogar / lancamento_anotar: as duas escritas da v1.

create table if not exists public.agente_tokens (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  user_id       uuid not null,
  nome          text not null,
  token_hash    text not null unique,
  criado_em     timestamptz not null default now(),
  revogado_em   timestamptz,
  ultimo_uso_em timestamptz
);
alter table public.agente_tokens enable row level security;
revoke all on public.agente_tokens from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'portal') then
    execute 'revoke all on public.agente_tokens from portal';
  end if;
end $$;

create table if not exists public.lancamento_historico (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  lancamento_id  uuid not null references public.lancamentos(id) on delete cascade,
  tipo           text not null check (tipo in ('prorrogacao', 'nota')),
  texto          text not null,
  de             date,
  para           date,
  por            uuid,
  criado_em      timestamptz not null default now()
);
create index if not exists lancamento_historico_lanc on public.lancamento_historico (lancamento_id, criado_em);
alter table public.lancamento_historico enable row level security;
drop policy if exists "Finance read lancamento_historico" on public.lancamento_historico;
create policy "Finance read lancamento_historico" on public.lancamento_historico
  for select using (fin_can(org_id));
revoke insert, update, delete on public.lancamento_historico from public, anon, authenticated;
grant select on public.lancamento_historico to authenticated;

-- Nova data de vencimento SEM juros. Recusa título liquidado e data no passado;
-- mês fechado é recusado pelo trg_lanc_mes_fechado, como em qualquer edição.
create or replace function public.lancamento_prorrogar(p_lancamento_id uuid, p_nova_data date, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  l lancamentos%rowtype;
  v_n int;
begin
  select * into l from lancamentos where id = p_lancamento_id for update;
  if not found or not fin_can(l.org_id) then
    raise exception 'Título não encontrado';
  end if;
  if l.situacao <> 'em_aberto' then
    raise exception 'Título já liquidado — não dá para prorrogar';
  end if;
  if p_nova_data is null or p_nova_data < current_date then
    raise exception 'A nova data precisa ser hoje ou depois';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da prorrogação';
  end if;
  if l.vencimento = p_nova_data then
    raise exception 'O título já vence nessa data';
  end if;

  update lancamentos set vencimento = p_nova_data where id = l.id;
  insert into lancamento_historico (org_id, lancamento_id, tipo, texto, de, para, por)
  values (l.org_id, l.id, 'prorrogacao', btrim(p_motivo), l.vencimento, p_nova_data, auth.uid());

  select count(*) into v_n from lancamento_historico where lancamento_id = l.id and tipo = 'prorrogacao';
  return jsonb_build_object('titulo_id', l.id, 'vencimento', p_nova_data, 'prorrogacoes', v_n);
end;
$$;
revoke execute on function public.lancamento_prorrogar(uuid, date, text) from public, anon;
grant execute on function public.lancamento_prorrogar(uuid, date, text) to authenticated;

create or replace function public.lancamento_anotar(p_lancamento_id uuid, p_texto text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from lancamentos where id = p_lancamento_id;
  if v_org is null or not fin_can(v_org) then
    raise exception 'Título não encontrado';
  end if;
  if coalesce(btrim(p_texto), '') = '' then
    raise exception 'Anotação vazia';
  end if;
  insert into lancamento_historico (org_id, lancamento_id, tipo, texto, por)
  values (v_org, p_lancamento_id, 'nota', left(btrim(p_texto), 4000), auth.uid());
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.lancamento_anotar(uuid, text) from public, anon;
grant execute on function public.lancamento_anotar(uuid, text) to authenticated;

notify pgrst, 'reload schema';
