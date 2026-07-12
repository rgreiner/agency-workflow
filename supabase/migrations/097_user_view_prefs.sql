-- 097_user_view_prefs.sql
-- Preferências de view por usuário (colunas + filtros salvos) no banco, pra seguir a
-- pessoa entre máquinas. Antes só em localStorage (por dispositivo). RLS: cada um lê/
-- grava só o seu (via auth.uid()); o localStorage vira cache/fallback. Idempotente.

create table if not exists user_view_prefs (
  user_id    uuid not null references profiles(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  view       text not null,                         -- ex.: 'views/lista', 'views/atendimento', 'views/gantt'
  prefs      jsonb not null default '{}'::jsonb,     -- { cols:{visible,order}, presets:[...] }
  updated_at timestamptz not null default now(),
  primary key (user_id, org_id, view)
);

alter table user_view_prefs enable row level security;

drop policy if exists "own view prefs" on user_view_prefs;
create policy "own view prefs" on user_view_prefs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

notify pgrst, 'reload schema';
