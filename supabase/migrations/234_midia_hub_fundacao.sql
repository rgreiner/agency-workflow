-- 234_midia_hub_fundacao.sql
-- Hub de Mídia, fase 1: o vínculo cliente↔operação, o catálogo de rotinas e a
-- ativação que instancia as rotinas como TAREFAS RECORRENTES NORMAIS no
-- workspace do cliente.
--
-- O problema que isto resolve (medido em 14/08): as 16 rotinas da mídia vivem
-- num workspace-balde chamado "Mídia", com o cliente real preso no título
-- (`[Comil] Otimização…`). Consequência: as horas da mídia (36 tarefas em 60
-- dias, régua de horas por abertura de tarefa) caem no custo do cliente ERRADO,
-- e toda campanha do balde acusa "sem pasta" desde 03/08.
--
-- A régua (decisões do Rafael, 14/08):
--  · RECRIAR, não migrar: as rotinas nascem novas nos clientes reais e o balde
--    fica intocado até ele validar e virar a chave na segunda (17/08).
--  · A rotina continua sendo TAREFA: recorrência, digest, atrasadas e horas
--    saem de graça. O Hub não é uma segunda caixa de entrada.
--  · Rotina mensal tem DIA FIXO (o boleto é "lembrar no dia 3"), não "30 dias
--    depois da última conclusão".
--
-- Idempotente.

-- ── 1. Gate próprio do Hub ───────────────────────────────────────────────────
-- Não dá para reusar `op_midias`: ele é o gate do COMERCIAL de mídia (PI/MX) e
-- está ligado também no cargo "Revisão". O Hub é a operação da mídia.
alter table org_positions add column if not exists op_midia_hub boolean not null default false;

-- Liga no cargo de mídia que já existe (idempotente: só onde ainda está falso).
update org_positions set op_midia_hub = true
 where lower(name) in ('midia', 'mídia') and op_midia_hub = false;

/** Pode operar o Hub de Mídia? owner/admin, ver-tudo, ou o toggle do cargo. */
create or replace function midia_can(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from organization_members m
      left join org_positions p on p.id = m.position_id
     where m.org_id = p_org
       and m.user_id = auth.uid()
       and m.arquivado = false
       and (m.role in ('owner', 'admin') or coalesce(p.op_ver_tudo, false) or coalesce(p.op_midia_hub, false))
  );
$$;
revoke execute on function midia_can(uuid) from public, anon;
grant  execute on function midia_can(uuid) to authenticated;

-- ── 2. Operação de mídia por cliente ─────────────────────────────────────────
-- Year-scoped como o blueprint de pastas manda: a campanha de operação e a
-- pasta do ano são de UM ano; virar o ano é criar a operação do ano seguinte,
-- nunca renomear a anterior.
create table if not exists midia_cliente (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  ano             int  not null,
  ativo           boolean not null default true,
  -- campanha "Mídia · Operação <ano>" no workspace do cliente: é ali que as
  -- tarefas de rotina nascem.
  campaign_id     uuid references campaigns(id) on delete set null,
  -- pasta do cliente no drive compartilhado "Mídia" (outro drive do Clientes)
  drive_folder_id text,
  plano_url       text,
  specs_url       text,
  crm_url         text,
  observacao      text,
  created_at      timestamptz not null default now(),
  created_by      uuid references profiles(id)
);
create unique index if not exists midia_cliente_uk on midia_cliente (workspace_id, ano);
create index if not exists midia_cliente_org_idx on midia_cliente (org_id, ativo);

alter table midia_cliente enable row level security;
drop policy if exists midia_cliente_read on midia_cliente;
create policy midia_cliente_read on midia_cliente for select using (midia_can(org_id));
-- Escrita só pelas RPCs abaixo.

-- ── 3. Catálogo de rotinas da org ────────────────────────────────────────────
-- O catálogo é da ORG (não do cliente): "geração de boletos" é a mesma rotina
-- em todo cliente, o que muda é onde ela é instanciada.
create table if not exists midia_rotina (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  nome           text not null,
  descricao      text,
  -- mesmos valores de activities.recurrence (recurrence_interval)
  frequencia     text not null default 'monthly',
  -- Mensal com DIA FIXO: o boleto é "lembrar no dia 3", não "30 dias depois".
  dia_mes        int check (dia_mes between 1 and 28),
  -- Semanal: 0=domingo … 6=sábado (padrão do `extract(dow)`).
  dia_semana     int check (dia_semana between 0 and 6),
  -- Para onde a tarefa VOLTA ao recorrer (e onde ela nasce).
  status_retorno text not null default 'midia',
  -- Subpasta canônica no drive Mídia que essa rotina alimenta (fase de pastas).
  pasta          text,
  -- Sugerida por padrão ao ativar um cliente novo?
  padrao         boolean not null default true,
  ordem          int not null default 100,
  ativo          boolean not null default true,
  created_at     timestamptz not null default now()
);
create unique index if not exists midia_rotina_uk on midia_rotina (org_id, nome);
create index if not exists midia_rotina_org_idx on midia_rotina (org_id, ordem);

alter table midia_rotina enable row level security;
drop policy if exists midia_rotina_read on midia_rotina;
create policy midia_rotina_read on midia_rotina for select using (midia_can(org_id));

-- ── 4. Instância: rotina × cliente → a tarefa recorrente ─────────────────────
create table if not exists midia_cliente_rotina (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  midia_cliente_id uuid not null references midia_cliente(id) on delete cascade,
  rotina_id        uuid not null references midia_rotina(id) on delete cascade,
  -- A tarefa que a rotina virou. `on delete set null`: se alguém excluir a
  -- tarefa, o vínculo sobrevive como histórico e a rotina pode ser recriada.
  activity_id      uuid references activities(id) on delete set null,
  ativo            boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid references profiles(id)
);
create unique index if not exists midia_cliente_rotina_uk on midia_cliente_rotina (midia_cliente_id, rotina_id);

alter table midia_cliente_rotina enable row level security;
drop policy if exists midia_cliente_rotina_read on midia_cliente_rotina;
create policy midia_cliente_rotina_read on midia_cliente_rotina for select using (midia_can(org_id));

-- ── 5. Semente do catálogo (as rotinas que a One a One roda hoje) ────────────
-- Vieram da lista do Rafael + do que está em produção no balde. `on conflict do
-- nothing`: rodar de novo não sobrescreve o que ele já ajustou na tela.
insert into midia_rotina (org_id, nome, descricao, frequencia, dia_mes, dia_semana, status_retorno, pasta, ordem)
select o.id, d.nome, d.descricao, d.freq, d.dia_mes, d.dia_semana, 'midia', d.pasta, d.ordem
  from organizations o
 cross join (values
   ('Geração de boletos',
    'Recolher os boletos dos veículos, organizar na pasta do mês e enviar. Lembrete no dia 3.',
    'monthly', 3, null, 'Boletos Digitais', 10),
   ('NFs, check-in e relatório no CRM',
    'Subir as notas fiscais, o check-in de mídia e o Relatório de Autorização do mês no CRM do cliente.',
    'monthly', 6, null, 'Relatórios Mensais', 20),
   ('Aprovação ou adequação de investimento',
    'Atualizar o gasto do mês corrente e aprovar a verba do mês seguinte com o cliente.',
    'monthly', 25, null, 'Plano de Mídia', 30),
   ('Otimização de campanhas digitais',
    'Revisar entrega, criativos e verba das campanhas digitais em veiculação.',
    'weekly', null, 4, null, 40)
 ) as d(nome, descricao, freq, dia_mes, dia_semana, pasta, ordem)
 on conflict (org_id, nome) do nothing;

-- ── 6. Primeiro prazo de uma rotina ──────────────────────────────────────────
-- Mensal com dia fixo: a PRÓXIMA ocorrência daquele dia (hoje conta; passou,
-- vai para o mês seguinte). Semanal: o próximo dia da semana pedido (hoje conta).
-- Sem dia definido, cai em hoje — a tarefa nasce visível em vez de sumir.
create or replace function midia_primeiro_prazo(
  p_frequencia text, p_dia_mes int, p_dia_semana int, p_hoje date
) returns date language sql immutable as $$
  select case
    when p_dia_mes is not null then
      case when extract(day from p_hoje)::int <= p_dia_mes
           then date_trunc('month', p_hoje)::date + (p_dia_mes - 1)
           else (date_trunc('month', p_hoje) + interval '1 month')::date + (p_dia_mes - 1)
      end
    when p_dia_semana is not null then
      p_hoje + ((p_dia_semana - extract(dow from p_hoje)::int + 7) % 7)
    else p_hoje
  end;
$$;

-- ── 7. Ativar a mídia num cliente ────────────────────────────────────────────
-- Cria (ou reusa) a operação do ano e a campanha onde as rotinas vão morar.
-- SECURITY DEFINER + guard `midia_can`: quem não opera mídia não ativa nada.
create or replace function midia_ativar_cliente(
  p_workspace_id uuid, p_ano int default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid;
  v_ano  int := coalesce(p_ano, extract(year from (now() at time zone 'America/Sao_Paulo'))::int);
  v_id   uuid;
  v_camp uuid;
  v_nome text;
begin
  select org_id into v_org from workspaces where id = p_workspace_id;
  if v_org is null then raise exception 'Cliente não encontrado'; end if;
  if not midia_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  select id, campaign_id into v_id, v_camp
    from midia_cliente where workspace_id = p_workspace_id and ano = v_ano;

  -- A campanha de operação: nome canônico, uma por ano, nunca renomeada depois.
  v_nome := 'Mídia · Operação ' || v_ano;
  if v_camp is null then
    select id into v_camp from campaigns
     where workspace_id = p_workspace_id and name = v_nome and archived = false
     limit 1;
  end if;
  if v_camp is null then
    insert into campaigns (workspace_id, name, description, ano, created_by)
    values (p_workspace_id, v_nome, 'Rotinas de mídia do cliente (Hub de Mídia).', v_ano, auth.uid())
    returning id into v_camp;
  end if;

  if v_id is null then
    insert into midia_cliente (org_id, workspace_id, ano, campaign_id, created_by)
    values (v_org, p_workspace_id, v_ano, v_camp, auth.uid())
    returning id into v_id;
  else
    update midia_cliente set ativo = true, campaign_id = v_camp where id = v_id;
  end if;

  return v_id;
end $$;
revoke execute on function midia_ativar_cliente(uuid, int) from public, anon;
grant  execute on function midia_ativar_cliente(uuid, int) to authenticated;

-- ── 8. Aplicar rotinas: cria as tarefas recorrentes de verdade ───────────────
-- Uma tarefa por rotina, na campanha de operação, já com recorrência, status de
-- retorno e o primeiro prazo calculado pelo dia fixo. Reaplicar é seguro: rotina
-- que já tem tarefa VIVA é pulada (não duplica a pauta de ninguém).
create or replace function midia_aplicar_rotinas(
  p_midia_cliente_id uuid, p_rotina_ids uuid[], p_responsavel uuid default null
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid;
  v_camp  uuid;
  v_hoje  date := (now() at time zone 'America/Sao_Paulo')::date;
  v_r     record;
  v_act   uuid;
  v_due   date;
  v_n     int := 0;
begin
  select org_id, campaign_id into v_org, v_camp from midia_cliente where id = p_midia_cliente_id;
  if v_org is null then raise exception 'Operação de mídia não encontrada'; end if;
  if not midia_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if v_camp is null then raise exception 'Cliente sem campanha de operação'; end if;

  for v_r in
    select r.* from midia_rotina r
     where r.org_id = v_org and r.id = any(p_rotina_ids) and r.ativo
     order by r.ordem
  loop
    -- Já existe tarefa viva para esta rotina neste cliente? Então não recria.
    if exists (
      select 1 from midia_cliente_rotina cr
      join activities a on a.id = cr.activity_id
      where cr.midia_cliente_id = p_midia_cliente_id and cr.rotina_id = v_r.id
        and cr.ativo and a.archived = false
    ) then
      continue;
    end if;

    v_due := midia_primeiro_prazo(v_r.frequencia, v_r.dia_mes, v_r.dia_semana, v_hoje);

    insert into activities (campaign_id, title, description, status, due_date,
                            recurrence, recurrence_reset_status, created_by)
    values (v_camp, v_r.nome, coalesce(v_r.descricao, ''), v_r.status_retorno, v_due,
            v_r.frequencia, v_r.status_retorno, auth.uid())
    returning id into v_act;

    if p_responsavel is not null then
      insert into activity_assignees (activity_id, user_id)
      values (v_act, p_responsavel) on conflict do nothing;
    end if;

    insert into midia_cliente_rotina (org_id, midia_cliente_id, rotina_id, activity_id, created_by)
    values (v_org, p_midia_cliente_id, v_r.id, v_act, auth.uid())
    on conflict (midia_cliente_id, rotina_id)
      do update set activity_id = excluded.activity_id, ativo = true;

    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;
revoke execute on function midia_aplicar_rotinas(uuid, uuid[], uuid) from public, anon;
grant  execute on function midia_aplicar_rotinas(uuid, uuid[], uuid) to authenticated;

-- ── 9. Desligar uma rotina do cliente ────────────────────────────────────────
-- Só marca o vínculo como inativo. A TAREFA fica: arquivar trabalho em
-- andamento por causa de um toggle de configuração seria destruir dado alheio.
create or replace function midia_desativar_rotina(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from midia_cliente_rotina where id = p_id;
  if v_org is null then raise exception 'Vínculo não encontrado'; end if;
  if not midia_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update midia_cliente_rotina set ativo = false where id = p_id;
end $$;
revoke execute on function midia_desativar_rotina(uuid) from public, anon;
grant  execute on function midia_desativar_rotina(uuid) to authenticated;

-- ── 10. Editar os dados da operação (links e pasta) ──────────────────────────
create or replace function midia_atualizar_cliente(
  p_id uuid, p_plano_url text, p_specs_url text, p_crm_url text,
  p_drive_folder_id text, p_observacao text
) returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from midia_cliente where id = p_id;
  if v_org is null then raise exception 'Operação não encontrada'; end if;
  if not midia_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update midia_cliente
     set plano_url = nullif(btrim(coalesce(p_plano_url, '')), ''),
         specs_url = nullif(btrim(coalesce(p_specs_url, '')), ''),
         crm_url   = nullif(btrim(coalesce(p_crm_url, '')), ''),
         drive_folder_id = nullif(btrim(coalesce(p_drive_folder_id, '')), ''),
         observacao = nullif(btrim(coalesce(p_observacao, '')), '')
   where id = p_id;
end $$;
revoke execute on function midia_atualizar_cliente(uuid, text, text, text, text, text) from public, anon;
grant  execute on function midia_atualizar_cliente(uuid, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
