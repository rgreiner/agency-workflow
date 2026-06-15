-- ════════════════════════════════════════════════════════════════════
-- 021 — resolve ambiguidade de overload do create_activity
-- ════════════════════════════════════════════════════════════════════
-- A produção tinha 3 overloads de create_activity. O PostgREST self-hosted
-- (v14, mais estrito que o do Supabase) não consegue escolher entre a versão
-- text+date e a enum+timestamptz quando o app manda os params como string
-- ("Could not choose the best candidate function").
--
-- Mantemos só a overload **text+date** (10 params) — é a que casa naturalmente
-- com o input do app (strings + datas) e com o schema atual (activities.start_date
-- = date). Removemos as 2 legadas (enum+timestamptz, com e sem p_start_date).
-- ════════════════════════════════════════════════════════════════════

drop function if exists create_activity(uuid,uuid,text,text,activity_status,activity_priority,activity_complexity,timestamptz,numeric,timestamptz);
drop function if exists create_activity(uuid,uuid,text,text,activity_status,activity_priority,activity_complexity,timestamptz,numeric);
