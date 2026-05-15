-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ──────────────────────────────────────────────
-- ENUMS
-- ──────────────────────────────────────────────

create type activity_status as enum (
  'briefing',
  'pendente_cliente',
  'planejamento',
  'insight',
  'redacao',
  'design',
  'edicao',
  'finalizacao',
  'revisao_interna',
  'validacao_atendimento',
  'orcamento',
  'producao_fornecedores',
  'producao_audiovisual',
  'validacao_midia',
  'midia',
  'social',
  'aprovacao_cliente',
  'implantacao_digital',
  'implantacao_off',
  'concluido'
);

create type activity_priority as enum ('low', 'medium', 'high', 'urgent');
create type activity_complexity as enum ('simple', 'medium', 'complex');
create type member_role as enum ('owner', 'admin', 'manager', 'member', 'viewer');
create type org_plan as enum ('free', 'starter', 'pro', 'enterprise');

-- ──────────────────────────────────────────────
-- ORGANIZATIONS (tenants)
-- ──────────────────────────────────────────────

create table organizations (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  slug          text not null unique,
  plan          org_plan not null default 'free',
  max_members   int not null default 5,
  logo_url      text,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ──────────────────────────────────────────────
-- PROFILES (extends Supabase auth.users)
-- ──────────────────────────────────────────────

create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  full_name     text,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ──────────────────────────────────────────────
-- ORGANIZATION MEMBERS
-- ──────────────────────────────────────────────

create table organization_members (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organizations(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  role          member_role not null default 'member',
  invited_by    uuid references profiles(id),
  joined_at     timestamptz not null default now(),
  unique(org_id, user_id)
);

-- ──────────────────────────────────────────────
-- WORKSPACES (clientes)
-- ──────────────────────────────────────────────

create table workspaces (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organizations(id) on delete cascade,
  name          text not null,
  description   text,
  color         text not null default '#6366f1',
  archived      boolean not null default false,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ──────────────────────────────────────────────
-- CAMPAIGNS (pastas dentro dos clientes)
-- ──────────────────────────────────────────────

create table campaigns (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  name          text not null,
  description   text,
  start_date    date,
  end_date      date,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ──────────────────────────────────────────────
-- ACTIVITIES (tarefas)
-- ──────────────────────────────────────────────

create table activities (
  id              uuid primary key default uuid_generate_v4(),
  campaign_id     uuid not null references campaigns(id) on delete cascade,
  title           text not null,
  description     text,
  status          activity_status not null default 'briefing',
  priority        activity_priority not null default 'medium',
  complexity      activity_complexity not null default 'medium',
  due_date        timestamptz,
  estimated_hours numeric(5,2),
  sort_order      int not null default 0,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ──────────────────────────────────────────────
-- ACTIVITY STATUS ASSIGNEES (responsável por status)
-- ──────────────────────────────────────────────

create table activity_status_assignees (
  id          uuid primary key default uuid_generate_v4(),
  activity_id uuid not null references activities(id) on delete cascade,
  status      activity_status not null,
  user_id     uuid not null references profiles(id) on delete cascade,
  unique(activity_id, status)
);

-- ──────────────────────────────────────────────
-- ACTIVITY HISTORY (auditoria de status)
-- ──────────────────────────────────────────────

create table activity_history (
  id            uuid primary key default uuid_generate_v4(),
  activity_id   uuid not null references activities(id) on delete cascade,
  from_status   activity_status,
  to_status     activity_status not null,
  changed_by    uuid references profiles(id),
  comment       text,
  changed_at    timestamptz not null default now()
);

-- ──────────────────────────────────────────────
-- ACTIVITY COMMENTS
-- ──────────────────────────────────────────────

create table activity_comments (
  id          uuid primary key default uuid_generate_v4(),
  activity_id uuid not null references activities(id) on delete cascade,
  user_id     uuid not null references profiles(id),
  content     text not null,
  attachments jsonb default '[]',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ──────────────────────────────────────────────
-- INVITATIONS
-- ──────────────────────────────────────────────

create table invitations (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references organizations(id) on delete cascade,
  email       text not null,
  role        member_role not null default 'member',
  token       text not null unique default encode(gen_random_bytes(32), 'hex'),
  invited_by  uuid references profiles(id),
  accepted_at timestamptz,
  expires_at  timestamptz not null default now() + interval '7 days',
  created_at  timestamptz not null default now()
);

-- ──────────────────────────────────────────────
-- UPDATED_AT TRIGGER
-- ──────────────────────────────────────────────

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at before update on organizations for each row execute function set_updated_at();
create trigger set_updated_at before update on profiles for each row execute function set_updated_at();
create trigger set_updated_at before update on workspaces for each row execute function set_updated_at();
create trigger set_updated_at before update on campaigns for each row execute function set_updated_at();
create trigger set_updated_at before update on activities for each row execute function set_updated_at();
create trigger set_updated_at before update on activity_comments for each row execute function set_updated_at();

-- ──────────────────────────────────────────────
-- AUTO-CREATE PROFILE ON SIGN UP
-- ──────────────────────────────────────────────

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ──────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ──────────────────────────────────────────────

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table organization_members enable row level security;
alter table workspaces enable row level security;
alter table campaigns enable row level security;
alter table activities enable row level security;
alter table activity_status_assignees enable row level security;
alter table activity_history enable row level security;
alter table activity_comments enable row level security;
alter table invitations enable row level security;

-- Helper: is current user a member of org?
create or replace function is_org_member(org uuid)
returns boolean as $$
  select exists (
    select 1 from organization_members
    where org_id = org and user_id = auth.uid()
  );
$$ language sql security definer stable;

-- Helper: current user role in org
create or replace function org_member_role(org uuid)
returns member_role as $$
  select role from organization_members
  where org_id = org and user_id = auth.uid()
  limit 1;
$$ language sql security definer stable;

-- Profiles: user sees own profile
create policy "Users can view own profile" on profiles for select using (id = auth.uid());
create policy "Users can update own profile" on profiles for update using (id = auth.uid());

-- Organizations: members can read
create policy "Org members can read org" on organizations for select using (is_org_member(id));
create policy "Owner/admin can update org" on organizations for update using (org_member_role(id) in ('owner', 'admin'));

-- Organization members
create policy "Org members can read members" on organization_members for select using (is_org_member(org_id));
create policy "Owner/admin can manage members" on organization_members for all using (org_member_role(org_id) in ('owner', 'admin'));

-- Workspaces
create policy "Org members can read workspaces" on workspaces for select using (is_org_member(org_id));
create policy "Manager+ can manage workspaces" on workspaces for all using (org_member_role(org_id) in ('owner', 'admin', 'manager'));

-- Campaigns
create policy "Org members can read campaigns" on campaigns for select
  using (exists (select 1 from workspaces w where w.id = workspace_id and is_org_member(w.org_id)));
create policy "Manager+ can manage campaigns" on campaigns for all
  using (exists (select 1 from workspaces w where w.id = workspace_id and org_member_role(w.org_id) in ('owner', 'admin', 'manager')));

-- Activities
create policy "Org members can read activities" on activities for select
  using (exists (
    select 1 from campaigns c
    join workspaces w on w.id = c.workspace_id
    where c.id = campaign_id and is_org_member(w.org_id)
  ));
create policy "Members can create activities" on activities for insert
  with check (exists (
    select 1 from campaigns c
    join workspaces w on w.id = c.workspace_id
    where c.id = campaign_id and is_org_member(w.org_id)
  ));
create policy "Members can update activities" on activities for update
  using (exists (
    select 1 from campaigns c
    join workspaces w on w.id = c.workspace_id
    where c.id = campaign_id and is_org_member(w.org_id)
  ));
create policy "Manager+ can delete activities" on activities for delete
  using (exists (
    select 1 from campaigns c
    join workspaces w on w.id = c.workspace_id
    where c.id = campaign_id and org_member_role(w.org_id) in ('owner', 'admin', 'manager')
  ));

-- Activity assignees, history, comments — same org membership check
create policy "Org members can read assignees" on activity_status_assignees for select
  using (exists (
    select 1 from activities a join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    where a.id = activity_id and is_org_member(w.org_id)
  ));
create policy "Members can manage assignees" on activity_status_assignees for all
  using (exists (
    select 1 from activities a join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    where a.id = activity_id and is_org_member(w.org_id)
  ));

create policy "Org members can read history" on activity_history for select
  using (exists (
    select 1 from activities a join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    where a.id = activity_id and is_org_member(w.org_id)
  ));
create policy "Members can insert history" on activity_history for insert
  with check (exists (
    select 1 from activities a join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    where a.id = activity_id and is_org_member(w.org_id)
  ));

create policy "Org members can read comments" on activity_comments for select
  using (exists (
    select 1 from activities a join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    where a.id = activity_id and is_org_member(w.org_id)
  ));
create policy "Members can manage own comments" on activity_comments for all
  using (user_id = auth.uid());

-- Invitations
create policy "Org admin can manage invitations" on invitations for all
  using (org_member_role(org_id) in ('owner', 'admin'));
create policy "Anyone can read invitation by token" on invitations for select
  using (true);

-- ──────────────────────────────────────────────
-- INDEXES
-- ──────────────────────────────────────────────

create index idx_org_members_user on organization_members(user_id);
create index idx_org_members_org on organization_members(org_id);
create index idx_workspaces_org on workspaces(org_id);
create index idx_campaigns_workspace on campaigns(workspace_id);
create index idx_activities_campaign on activities(campaign_id);
create index idx_activities_status on activities(status);
create index idx_activities_due_date on activities(due_date);
create index idx_activity_history_activity on activity_history(activity_id);
create index idx_activity_assignees_activity on activity_status_assignees(activity_id);
