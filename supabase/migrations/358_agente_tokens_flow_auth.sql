-- 358 — a conexão direta do Flow (role flow_auth, a mesma do login) é quem
-- confere o token do agente; a 357 fechou a tabela para todo mundo, inclusive ela.
-- Só lê e marca o último uso — criar/revogar token continua sendo do postgres.
grant select on public.agente_tokens to flow_auth;
grant update (ultimo_uso_em) on public.agente_tokens to flow_auth;
-- A tabela tem RLS sem policy (ninguém via PostgREST); flow_auth não é dono nem
-- bypassrls, então precisa de policy própria — senão o grant lê zero linhas.
drop policy if exists "flow_auth le tokens" on public.agente_tokens;
create policy "flow_auth le tokens" on public.agente_tokens for select to flow_auth using (true);
drop policy if exists "flow_auth marca uso" on public.agente_tokens;
create policy "flow_auth marca uso" on public.agente_tokens for update to flow_auth using (true) with check (true);
