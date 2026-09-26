-- 304_revisao_ia_config.sql
-- Revisão por IA sob demanda (botão "Revisar" na tarefa, ANTES de mover o status).
-- A config por org vive aqui: ligada/desligada, etapas onde o botão aparece,
-- provedor/modelo e a CHAVE da API cadastrada pela tela de Configurações.
--
-- A chave é segredo: a tabela só é lida/escrita pela CONEXÃO DIRETA do app (role
-- flow_auth), nunca pelo PostgREST — mesmo padrão do btg_connections (104/105).
-- RLS ligada e sem policy para anon/authenticated; a chave ainda vai cifrada
-- (AES-256-GCM, lib/ai/segredo.ts), então nem um dump do banco a expõe em claro.

create table if not exists org_ai_config (
  org_id      uuid primary key references organizations(id) on delete cascade,
  enabled     boolean not null default false,
  stages      jsonb   not null default '{"redacao": true, "design": true, "finalizacao": true}'::jsonb,
  provider    text    not null default 'anthropic' check (provider in ('anthropic', 'gemini')),
  model       text,
  api_key_enc text,
  key_hint    text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles(id) on delete set null
);

alter table org_ai_config enable row level security;

-- DEFAULT PRIVILEGES dão acesso a anon/authenticated em toda tabela nova: fecha
-- explicitamente (a RLS sem policy já bloqueia, isto é a segunda tranca).
revoke all on table org_ai_config from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'flow_auth') then
    grant usage on schema public to flow_auth;
    grant select, insert, update on table org_ai_config to flow_auth;
    drop policy if exists org_ai_config_flow_auth on org_ai_config;
    create policy org_ai_config_flow_auth on org_ai_config
      for all to flow_auth using (true) with check (true);
  end if;
end $$;

-- A revisão automática DEPOIS de avançar (review_gates, mig. 081) sai de cena:
-- o código novo não a dispara mais. A coluna fica (histórico), sem uso.

notify pgrst, 'reload schema';
