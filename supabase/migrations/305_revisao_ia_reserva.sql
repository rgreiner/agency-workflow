-- 305_revisao_ia_reserva.sql
-- Chave de IA RESERVA da org (Configurações → Revisão IA): se a principal falhar
-- (sem crédito, chave recusada, provedor fora do ar), a mesma chamada tenta a
-- reserva. Mesmo tratamento da principal (304): cifrada no app, tabela fechada
-- para anon/authenticated, lida só pela conexão direta (flow_auth).

alter table org_ai_config add column if not exists backup_provider    text check (backup_provider in ('anthropic', 'gemini'));
alter table org_ai_config add column if not exists backup_model       text;
alter table org_ai_config add column if not exists backup_api_key_enc text;
alter table org_ai_config add column if not exists backup_key_hint    text;

revoke all on table org_ai_config from public, anon, authenticated;
