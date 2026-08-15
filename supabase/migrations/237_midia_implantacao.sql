-- 237_midia_implantacao.sql
-- Hub de Mídia, fase 3: a implantação de um cliente — acessos, documentos,
-- social e pixel/CRM.
--
-- Por que NÃO é um checklist de tarefa (a razão do modelo, não capricho):
-- "temos o Meta Business do cliente X" é ESTADO, e estado REGRIDE. A senha é
-- trocada, a permissão cai, o gerente sai da conta — e o item volta a pendente
-- meses depois de a tarefa de implantação estar concluída e arquivada. Um
-- checklist dentro de uma tarefa morre com a tarefa; isto sobrevive e continua
-- consultável ("de quais clientes temos o acesso ao Ads?").
--
-- Idempotente.

create table if not exists midia_implantacao_item (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  bloco      text not null check (bloco in ('acessos', 'documentos', 'social', 'pixel_crm')),
  nome       text not null,
  descricao  text,
  ordem      int not null default 100,
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists midia_implantacao_item_uk on midia_implantacao_item (org_id, bloco, nome);
create index if not exists midia_implantacao_item_org_idx on midia_implantacao_item (org_id, bloco, ordem);

alter table midia_implantacao_item enable row level security;
drop policy if exists midia_implantacao_item_read on midia_implantacao_item;
create policy midia_implantacao_item_read on midia_implantacao_item for select using (midia_can(org_id));

-- Estado por cliente. Sem linha = 'pendente' (o padrão é não ter), então
-- cliente novo não precisa de seed nenhum para aparecer com a lista inteira.
create table if not exists midia_implantacao_estado (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  item_id       uuid not null references midia_implantacao_item(id) on delete cascade,
  -- 'na' = não se aplica a este cliente (ele não tem LinkedIn, por exemplo):
  -- sai da conta do percentual em vez de ficar pendente para sempre.
  estado        text not null default 'pendente'
                check (estado in ('pendente', 'ok', 'na', 'perdido')),
  nota          text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references profiles(id)
);
create unique index if not exists midia_implantacao_estado_uk on midia_implantacao_estado (workspace_id, item_id);
create index if not exists midia_implantacao_estado_org_idx on midia_implantacao_estado (org_id, estado);

alter table midia_implantacao_estado enable row level security;
drop policy if exists midia_implantacao_estado_read on midia_implantacao_estado;
create policy midia_implantacao_estado_read on midia_implantacao_estado for select using (midia_can(org_id));

-- ── Semente dos 4 blocos ─────────────────────────────────────────────────────
insert into midia_implantacao_item (org_id, bloco, nome, ordem)
select o.id, d.bloco, d.nome, d.ordem
  from organizations o
 cross join (values
   ('acessos',    'Meta Business (Facebook/Instagram)',   10),
   ('acessos',    'Google Ads',                           20),
   ('acessos',    'Google Analytics',                     30),
   ('acessos',    'Google Tag Manager',                   40),
   ('acessos',    'Google Business Profile',              50),
   ('acessos',    'Site / painel do CMS',                 60),
   ('acessos',    'TikTok Ads',                           70),
   ('acessos',    'LinkedIn',                             80),
   ('documentos', 'Carta de agenciamento',                10),
   ('documentos', 'Contrato assinado',                    20),
   ('documentos', 'Dados cadastrais (CNPJ, endereço)',    30),
   ('documentos', 'Contato do financeiro do cliente',     40),
   ('social',     'Instagram',                            10),
   ('social',     'Facebook',                             20),
   ('social',     'LinkedIn',                             30),
   ('social',     'YouTube',                              40),
   ('social',     'TikTok',                               50),
   ('pixel_crm',  'Pixel da Meta instalado',              10),
   ('pixel_crm',  'Tag do Google instalada',              20),
   ('pixel_crm',  'Conversões configuradas',              30),
   ('pixel_crm',  'Cliente criado no CRM',                40),
   ('pixel_crm',  'Formulários integrados ao CRM',        50)
 ) as d(bloco, nome, ordem)
 on conflict (org_id, bloco, nome) do nothing;

-- ── Marcar um item ───────────────────────────────────────────────────────────
create or replace function midia_implantacao_marcar(
  p_workspace_id uuid, p_item_id uuid, p_estado text, p_nota text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from workspaces where id = p_workspace_id;
  if v_org is null then raise exception 'Cliente não encontrado'; end if;
  if not midia_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_estado not in ('pendente', 'ok', 'na', 'perdido') then raise exception 'Estado inválido'; end if;

  insert into midia_implantacao_estado (org_id, workspace_id, item_id, estado, nota, atualizado_por)
  values (v_org, p_workspace_id, p_item_id, p_estado, nullif(btrim(coalesce(p_nota, '')), ''), auth.uid())
  on conflict (workspace_id, item_id) do update
    set estado = excluded.estado,
        -- Nota nula não apaga o que já estava escrito: quem só clicou no estado
        -- não queria perder a observação de quem escreveu antes.
        nota = coalesce(excluded.nota, midia_implantacao_estado.nota),
        atualizado_em = now(),
        atualizado_por = auth.uid();
end $$;
revoke execute on function midia_implantacao_marcar(uuid, uuid, text, text) from public, anon;
grant  execute on function midia_implantacao_marcar(uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
