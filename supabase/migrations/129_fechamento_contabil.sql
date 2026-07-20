-- 129_fechamento_contabil.sql
-- Envio mensal pra contabilidade: extrato bancário + recebimentos do mês.
-- O disparo NÃO é automático — o cron abre o fechamento e avisa na caixa de
-- entrada; alguém do Financeiro confere e confirma, e só então o e-mail sai.
-- Relatório contábil saindo sem ninguém olhar transforma erro em problema fiscal.
-- Idempotente.

-- ── 1) Arquivo original do OFX ──────────────────────────────────────────────
-- A contabilidade quer o documento do banco, não a nossa renderização. Hoje o
-- import só guarda os movimentos parseados; o arquivo é descartado. Passa a ser
-- guardado no volume de uploads e anexado no envio.
create table if not exists ofx_arquivos (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  conta_id    uuid references contas_financeiras(id) on delete set null,
  nome        text not null,          -- nome original do arquivo
  caminho     text not null,          -- relativo ao volume (bucket ofx/)
  periodo_ini date,
  periodo_fim date,
  bytes       integer,
  created_at  timestamptz not null default now(),
  created_by  uuid references profiles(id) on delete set null
);
create index if not exists idx_ofx_arq_org_periodo on ofx_arquivos(org_id, periodo_fim desc);

alter table ofx_arquivos enable row level security;
drop policy if exists "Finance read ofx_arquivos" on ofx_arquivos;
create policy "Finance read ofx_arquivos" on ofx_arquivos
  for select using (
    exists (select 1 from organization_members om
            where om.org_id = ofx_arquivos.org_id and om.user_id = auth.uid()
              and (om.can_finance or om.role in ('owner','admin')))
  );
drop policy if exists "Finance write ofx_arquivos" on ofx_arquivos;
create policy "Finance write ofx_arquivos" on ofx_arquivos
  for insert with check (
    exists (select 1 from organization_members om
            where om.org_id = ofx_arquivos.org_id and om.user_id = auth.uid()
              and (om.can_finance or om.role in ('owner','admin')))
  );
grant select, insert on ofx_arquivos to anon, authenticated;

-- ── 2) Fechamento mensal ────────────────────────────────────────────────────
create table if not exists fechamento_contabil (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  competencia    text not null,                        -- 'YYYY-MM'
  status         text not null default 'pendente',     -- pendente|enviado|erro
  confirmado_por uuid references profiles(id) on delete set null,
  confirmado_em  timestamptz,
  enviado_em     timestamptz,
  destinatarios  text[],
  erro           text,
  created_at     timestamptz not null default now(),
  unique (org_id, competencia)                          -- 1 fechamento por mês
);

alter table fechamento_contabil enable row level security;
drop policy if exists "Finance read fechamento" on fechamento_contabil;
create policy "Finance read fechamento" on fechamento_contabil
  for select using (
    exists (select 1 from organization_members om
            where om.org_id = fechamento_contabil.org_id and om.user_id = auth.uid()
              and (om.can_finance or om.role in ('owner','admin')))
  );
grant select on fechamento_contabil to anon, authenticated;
-- Escrita só via RPC/server action (security definer), igual btg_movements.

-- ── 3) Configuração por org ─────────────────────────────────────────────────
alter table org_settings add column if not exists contabil_emails text[] not null default '{}';
alter table org_settings add column if not exists contabil_dia integer not null default 5;
alter table org_settings add column if not exists contabil_ativo boolean not null default false;

-- ── 4) Abre o fechamento e avisa a caixa de entrada ─────────────────────────
-- Chamada pelo cron (protegido por secret). Sem p_user_id de propósito, mesmo
-- padrão de notify_due_soon. Idempotente: se o mês já foi aberto, não duplica
-- nem re-notifica.
create or replace function abrir_fechamento_contabil(p_org_id uuid, p_competencia text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_novos int := 0;
begin
  insert into fechamento_contabil (org_id, competencia)
  values (p_org_id, p_competencia)
  on conflict (org_id, competencia) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('criado', false, 'notificados', 0);
  end if;

  insert into notifications (user_id, org_id, type, actor_id, data)
  select om.user_id, p_org_id, 'fechamento_contabil', null,
         jsonb_build_object('competencia', p_competencia, 'fechamento_id', v_id)
  from organization_members om
  where om.org_id = p_org_id
    and (om.can_finance or om.role in ('owner','admin'));
  get diagnostics v_novos = row_count;

  return jsonb_build_object('criado', true, 'notificados', v_novos);
end $$;

grant execute on function abrir_fechamento_contabil(uuid, text) to anon, authenticated;

-- ── 5) Marca o resultado do envio ───────────────────────────────────────────
-- A tabela não tem policy de update (escrita só por RPC). Quem chama é a server
-- action, já gated por assertFinanceAccess — mas conferimos a permissão aqui
-- também, porque a RPC é security definer e roda com privilégio.
create or replace function marcar_fechamento_enviado(
  p_org_id uuid, p_competencia text, p_user_id uuid,
  p_destinatarios text[] default null, p_erro text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from organization_members om
    where om.org_id = p_org_id and om.user_id = p_user_id
      and (om.can_finance or om.role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;

  if p_erro is not null then
    update fechamento_contabil
       set status = 'erro', erro = p_erro
     where org_id = p_org_id and competencia = p_competencia;
  else
    update fechamento_contabil
       set status = 'enviado', erro = null,
           confirmado_por = p_user_id, confirmado_em = now(), enviado_em = now(),
           destinatarios = p_destinatarios
     where org_id = p_org_id and competencia = p_competencia;
  end if;
end $$;

grant execute on function marcar_fechamento_enviado(uuid, text, uuid, text[], text) to anon, authenticated;

notify pgrst, 'reload schema';
