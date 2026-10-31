-- 398 — Auditoria de 31/10/2026, Onda 1: fechar o que estava aberto.
--
-- Medido em produção antes de escrever (nada aqui é teoria):
--  · 96 funções próprias executáveis por `anon` (a regra da casa é SÓ get_invite_info);
--  · 135 funções fora de `portal_*` executáveis pelo papel `portal` (o cliente);
--  · 3 SECURITY DEFINER sem guarda chamáveis por qualquer membro logado:
--      rh_delete_documento (apaga documento de RH; nenhuma tela chama),
--      fin_encerrar_documento / fin_impacto_encerrar_doc (conferem o cargo do
--      `p_user_id` que o CLIENTE manda — a classe de bug do P0 de 22/07),
--      gerar_lancamento_midia (helper de lancar_midia; gera lançamento de comissão);
--  · 19 funções sem chamador no código, em outra função, policy, view ou trigger;
--  · 1 trigger function sem trigger (rh_marcacao_sem_update) — handle_new_user TEM
--    trigger em auth.users e FICA;
--  · 2 tabelas _relink_backup_* (cópias de julho) sem RLS, legíveis por membro;
--  · 3 helpers de RLS marcados VOLATILE (o planner chama por linha);
--  · is_org_member e my_org_rank, os helpers mais usados em policy, sem search_path.
--
-- Idempotente. Reaplicar não muda nada.

-- ── 1. Guardas ─────────────────────────────────────────────────────────────────
-- Antes, `p_user_id` era aceito como veio: bastava mandar o id de um owner para
-- passar. Agora o id tem que ser o da própria sessão (auth.uid()).

create or replace function public.fin_impacto_encerrar_doc(p_user_id uuid, p_lancamento_id uuid, p_a_partir date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare l record; v_n int; v_total numeric; v_fica int; v_fica_total numeric; v_bloq text;
begin
  if p_user_id is distinct from auth.uid() then
    return jsonb_build_object('pode', false, 'motivo', 'Acesso negado');
  end if;
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then return jsonb_build_object('pode', false, 'motivo', 'Lançamento não encontrado'); end if;
  if l.origem_tipo not in ('producao', 'midia') then
    return jsonb_build_object('pode', false, 'motivo', 'Só documentos parcelados (Fee, produção, mídia) são encerrados assim.');
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = l.org_id and user_id = p_user_id and arquivado = false
      and role in ('owner','admin','manager')
  ) then return jsonb_build_object('pode', false, 'motivo', 'Acesso negado'); end if;

  -- Alvo: parcelas do MESMO documento a partir da data. Se alguma delas já foi
  -- movimentada, o encerramento pararia no meio — recusa dizendo qual.
  select string_agg(distinct b, ' ') into v_bloq from (
    select _lancamento_bloqueio_exclusao(l2.id) b from lancamentos l2
     where l2.org_id = l.org_id and l2.origem_tipo = l.origem_tipo
       and l2.origem_id = l.origem_id and l2.vencimento >= p_a_partir
  ) t where b is not null;
  if v_bloq is not null then
    return jsonb_build_object('pode', false, 'motivo',
      'Há parcela já movimentada a partir desta data: ' || v_bloq);
  end if;

  select count(*), coalesce(sum(valor), 0) into v_n, v_total
    from lancamentos
   where org_id = l.org_id and origem_tipo = l.origem_tipo
     and origem_id = l.origem_id and vencimento >= p_a_partir;
  if coalesce(v_n, 0) = 0 then
    return jsonb_build_object('pode', false, 'motivo', 'Nenhuma parcela em aberto a partir desta data.');
  end if;

  select count(*), coalesce(sum(valor), 0) into v_fica, v_fica_total
    from lancamentos
   where org_id = l.org_id and origem_tipo = l.origem_tipo
     and origem_id = l.origem_id and vencimento < p_a_partir;

  return jsonb_build_object(
    'pode', true, 'remove', v_n, 'valor_removido', round(v_total, 2),
    'fica', v_fica, 'valor_final', round(v_fica_total, 2), 'a_partir', p_a_partir);
end $function$;

create or replace function public.fin_encerrar_documento(p_user_id uuid, p_lancamento_id uuid, p_a_partir date, p_motivo text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare l record; v_prev jsonb; v_n int; v_novo numeric;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  -- fin_impacto_encerrar_doc confere o cargo (owner/admin/manager) na org do lançamento.
  v_prev := fin_impacto_encerrar_doc(p_user_id, p_lancamento_id, p_a_partir);
  if not coalesce((v_prev->>'pode')::boolean, false) then
    raise exception '%', coalesce(v_prev->>'motivo', 'Não é possível encerrar');
  end if;
  select * into l from lancamentos where id = p_lancamento_id;

  delete from lancamentos
   where org_id = l.org_id and origem_tipo = l.origem_tipo
     and origem_id = l.origem_id and vencimento >= p_a_partir;
  get diagnostics v_n = row_count;

  -- O documento SEGUE FATURADO e passa a valer o que foi realmente cobrado
  -- (decisão do Rafael): nada volta para a fila de Faturamento.
  select coalesce(sum(valor), 0) into v_novo
    from lancamentos
   where org_id = l.org_id and origem_tipo = l.origem_tipo and origem_id = l.origem_id;

  if l.origem_tipo = 'producao' then
    update producao set valor = v_novo, encerrado_em = p_a_partir,
           encerrado_motivo = nullif(btrim(coalesce(p_motivo, '')), '')
     where id = l.origem_id;
  else
    update midias set valor = v_novo, encerrado_em = p_a_partir,
           encerrado_motivo = nullif(btrim(coalesce(p_motivo, '')), '')
     where id = l.origem_id;
  end if;

  return jsonb_build_object('ok', true, 'removidas', v_n, 'valor_final', round(v_novo, 2));
end $function$;

-- Helper interno de lancar_midia (SECURITY DEFINER, roda como dono): não precisa de
-- grant para ninguém. Fechado para o PostgREST.
revoke execute on function public.gerar_lancamento_midia(uuid, uuid, text, text, text) from public, anon, authenticated, portal;

-- ── 2. Mortas ──────────────────────────────────────────────────────────────────
drop function if exists public.rh_delete_documento(uuid);
drop function if exists public.cancelar_documento_midia(uuid, uuid);
drop function if exists public.concluir_orcamento(uuid, uuid);
drop function if exists public.set_lancamento_situacao(uuid, uuid, text);
drop function if exists public.set_org_review_gates(uuid, uuid, jsonb);
drop function if exists public.rh_set_retencao(uuid, integer);
drop function if exists public.rh_envios_do_colaborador(uuid);
drop function if exists public.conciliar_btg_movimento(uuid, uuid, uuid);
drop function if exists public.regerar_lancamentos_midias(uuid, uuid);
drop function if exists public.gerar_lancamentos_pedido(uuid);
drop function if exists public.portal_criar_solicitacao(text, text, jsonb);
drop function if exists public.rh_comprovante_dia(uuid, date);
drop function if exists public.rh_cpf_valido(text);
drop function if exists public.rh_gerar_lancamentos_folha(uuid, date, numeric, date, numeric, date, numeric, date);
drop function if exists public.rh_registrar_evento_seguranca(uuid, uuid, text, text);
drop function if exists public.rh_marcacao_sem_update();

-- Ferramentas de manutenção (só psql): ficam, mas fechadas para a API.
revoke execute on function public.rh_assinatura_verificar_cadeia(uuid) from public, anon, authenticated, portal;
revoke execute on function public.rh_marcacao_verificar(uuid) from public, anon, authenticated, portal;
revoke execute on function public.restaurar_extrato(uuid, uuid, text) from public, anon, authenticated, portal;
revoke execute on function public.seed_finance_from_extrato(uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated, portal;

-- Cópias de segurança da troca de pastas (07/2026). O backup diário do banco guarda o
-- estado anterior se um dia for preciso.
drop table if exists public._relink_backup_20260725;
drop table if exists public._relink_backup_s3_20260728;

-- ── 3. Helpers de RLS ──────────────────────────────────────────────────────────
alter function public.is_coworker(uuid) stable;
alter function public.has_doc_access(uuid) stable;
alter function public.is_doc_org_member(uuid) stable;
alter function public.is_org_member(uuid) set search_path = public;
alter function public.my_org_rank(uuid) set search_path = public;

-- ── 4. anon e portal: só o que é deles ─────────────────────────────────────────
-- `has_function_privilege('anon', …)` também é verdadeiro quando o grant é de PUBLIC.
-- Por isso, onde PUBLIC ainda tem EXECUTE, o grant sai de PUBLIC e volta EXPLÍCITO
-- para `authenticated` (que o tinha por tabela) — o membro logado não perde nada.
-- Funções de extensão (pgcrypto, pg_trgm, uuid-ossp) ficam fora: defaults de coluna
-- dependem delas e nenhuma expõe dado.
do $$
declare r record; n_anon int := 0; n_portal int := 0; n_public int := 0;
begin
  for r in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args,
           has_function_privilege('public', p.oid, 'execute') as pub,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_ok,
           has_function_privilege('flow_auth', p.oid, 'execute') as fa_ok,
           has_function_privilege('portal', p.oid, 'execute') as portal_ok
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and has_function_privilege('anon', p.oid, 'execute')
       and p.proname <> 'get_invite_info'
  loop
    if r.pub then
      execute format('revoke execute on function public.%I(%s) from public', r.proname, r.args);
      n_public := n_public + 1;
      if r.auth_ok then execute format('grant execute on function public.%I(%s) to authenticated', r.proname, r.args); end if;
      if r.fa_ok then execute format('grant execute on function public.%I(%s) to flow_auth', r.proname, r.args); end if;
      if r.portal_ok and r.proname like 'portal\_%' then
        execute format('grant execute on function public.%I(%s) to portal', r.proname, r.args);
      end if;
    end if;
    execute format('revoke execute on function public.%I(%s) from anon', r.proname, r.args);
    n_anon := n_anon + 1;
  end loop;

  for r in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and has_function_privilege('portal', p.oid, 'execute')
       and p.proname not like 'portal\_%'
  loop
    execute format('revoke execute on function public.%I(%s) from portal', r.proname, r.args);
    n_portal := n_portal + 1;
  end loop;

  raise notice 'mig 398: anon revogado em % funções (% delas tinham grant de PUBLIC); portal revogado em %', n_anon, n_public, n_portal;
end $$;

-- A página /convite/[token] chama antes do login: o token é a credencial.
grant execute on function public.get_invite_info(uuid) to anon;

notify pgrst, 'reload schema';
