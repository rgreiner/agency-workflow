-- 066_todos.sql
-- To-do pessoal: lista de anotações de cada usuário (por org), só ela mesma vê.
-- Aparece na sidebar direita da Caixa de entrada. RLS por dono (auth.uid()).
-- Idempotente.

create table if not exists todos (
  id         uuid primary key default uuid_generate_v4(),
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  texto      text not null,
  done       boolean not null default false,
  due_date   date,
  ordem      int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_todos_user on todos(user_id, org_id);

alter table todos enable row level security;

drop policy if exists "todos own select" on todos;
create policy "todos own select" on todos for select using (user_id = auth.uid());
drop policy if exists "todos own insert" on todos;
create policy "todos own insert" on todos for insert with check (user_id = auth.uid());
drop policy if exists "todos own update" on todos;
create policy "todos own update" on todos for update using (user_id = auth.uid());
drop policy if exists "todos own delete" on todos;
create policy "todos own delete" on todos for delete using (user_id = auth.uid());

grant select, insert, update, delete on todos to anon, authenticated;

drop trigger if exists set_todos_updated_at on todos;
create trigger set_todos_updated_at before update on todos
  for each row execute function set_updated_at();

notify pgrst, 'reload schema';
