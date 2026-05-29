-- ── Visual Boards ────────────────────────────────────────────────────────────
-- Canvas-based visual documents (Milanote-style) for building rich briefings.

create table visual_boards (
  id          uuid default gen_random_uuid() primary key,
  org_id      uuid not null references organizations(id) on delete cascade,
  workspace_id uuid references workspaces(id) on delete set null,
  title       text not null default 'Quadro sem título',
  data        jsonb not null default '{"elements":[],"arrows":[]}'::jsonb,
  created_by  uuid not null references profiles(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table visual_boards enable row level security;

create policy "org members can view boards" on visual_boards
  for select using (is_org_member(org_id));

create policy "org members can insert boards" on visual_boards
  for insert with check (is_org_member(org_id) and auth.uid() = created_by);

create policy "org members can update boards" on visual_boards
  for update using (is_org_member(org_id));

create policy "org members can delete boards" on visual_boards
  for delete using (is_org_member(org_id));

create index visual_boards_org_id_idx      on visual_boards(org_id);
create index visual_boards_workspace_id_idx on visual_boards(workspace_id);
create index visual_boards_created_by_idx   on visual_boards(created_by);
