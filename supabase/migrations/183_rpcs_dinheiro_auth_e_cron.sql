-- 183_rpcs_dinheiro_auth_e_cron.sql
-- Auditoria 02/08 — "Segurança e acesso", achado 4: quatro RPCs que mexem em
-- dinheiro rodavam SEM nenhuma checagem de autorização, security definer e com
-- grant pra `anon`. Como o PostgREST está publicado na internet
-- (flow-api.oneaone.com.br), qualquer pessoa sem token podia:
--   importar_ofx               → inserir movimento bancário E lançamento
--   sync_btg_movements         → escrever no extrato
--   abrir_fechamento_contabil  → abrir competência e notificar o Financeiro
--   next_doc_numero            → queimar número da série fiscal
-- A varredura da migration 143 não pegou nenhuma delas porque só cobriu funções
-- que recebem `p_user_id`.
--
-- Duas destas são chamadas pelo CRON, que até hoje rodava como `anon` — era por
-- isso que elas não podiam exigir sessão. A saída é dar identidade ao cron: a
-- rota /api/cron passa a assinar um JWT curto com o claim `flow_cron` (mesmo
-- JWT_SECRET, mesmo molde do token do portal), e o SQL reconhece por is_cron().
-- De quebra isso conserta o job `fechamento-contabil`, que está falhando desde
-- 01/08 com "permission denied for table org_settings" (anon não lê a tabela).
--
-- Idempotente.

-- ── Quem é quem ─────────────────────────────────────────────────────────────
-- O claim só existe em token assinado pelo servidor com JWT_SECRET; ninguém de
-- fora consegue forjá-lo.
create or replace function is_cron()
returns boolean language sql stable as $$
  select coalesce(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'flow_cron') = 'true',
    false
  );
$$;
grant execute on function is_cron() to anon, authenticated;

-- Manutenção por psql direto (migration/DO block roda como `postgres`, sem JWT).
-- Dá pra usar session_user porque SECURITY DEFINER troca o current_user, não o
-- session_user — via PostgREST ele é sempre `authenticator`.
create or replace function is_psql_direto()
returns boolean language sql stable as $$
  select session_user = 'postgres';
$$;

-- ── importar_ofx: só quem tem Financeiro ────────────────────────────────────
create or replace function importar_ofx(p_org_id uuid, p_conta_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; v_btgid text; v_tipo text; v_valor numeric; v_lanc uuid; v_mov uuid;
  v_inserted int := 0; v_total int := 0;
begin
  if not (fin_can(p_org_id) or is_psql_direto()) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  for r in select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
    fitid text, data_mov date, valor numeric, tipo text, descricao text
  ) loop
    v_total := v_total + 1;
    if r.fitid is null or r.data_mov is null or r.valor is null then continue; end if;
    v_btgid := 'ofx:' || p_conta_id::text || ':' || r.fitid;
    if exists (select 1 from btg_movements where org_id = p_org_id and btg_id = v_btgid) then continue; end if;  -- dedup
    v_tipo := case when r.tipo in ('credit','debit') then r.tipo when r.valor < 0 then 'debit' else 'credit' end;
    v_valor := abs(r.valor);

    if eh_transferencia_interna(r.descricao) then
      -- varredura interna da conta remunerada: se anula, não concilia
      insert into btg_movements (org_id, fonte, conta_id, btg_id, tipo, valor, data_mov, descricao, categoria, status, raw)
      values (p_org_id, 'ofx', p_conta_id, v_btgid, v_tipo, v_valor, r.data_mov, r.descricao, 'Transferência interna', 'ignorado', jsonb_build_object('fitid', r.fitid));

    elsif v_tipo = 'credit' and eh_rendimento(r.descricao) then
      -- rendimento: cria a receita e concilia automaticamente
      insert into lancamentos (org_id, tipo, origem_tipo, descricao, valor, vencimento, competencia, situacao, conta_id, categoria)
      values (p_org_id, 'entrada', 'ofx', 'Rendimento', v_valor, r.data_mov, r.data_mov, 'em_aberto', p_conta_id, 'Rendimentos')
      returning id into v_lanc;
      insert into btg_movements (org_id, fonte, conta_id, btg_id, tipo, valor, data_mov, descricao, categoria, status, lancamento_id, raw)
      values (p_org_id, 'ofx', p_conta_id, v_btgid, v_tipo, v_valor, r.data_mov, r.descricao, 'Rendimentos', 'conciliado', v_lanc, jsonb_build_object('fitid', r.fitid))
      returning id into v_mov;
      insert into btg_conciliacao_itens (org_id, movement_id, lancamento_id, valor) values (p_org_id, v_mov, v_lanc, v_valor);
      perform _recompute_lanc_conciliacao(v_lanc);

    else
      insert into btg_movements (org_id, fonte, conta_id, btg_id, tipo, valor, data_mov, descricao, status, raw)
      values (p_org_id, 'ofx', p_conta_id, v_btgid, v_tipo, v_valor, r.data_mov, r.descricao, 'pendente', jsonb_build_object('fitid', r.fitid));
    end if;

    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_total - v_inserted, 'total', v_total);
end; $$;

-- ── sync_btg_movements: Financeiro OU cron ──────────────────────────────────
create or replace function sync_btg_movements(p_org_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_inserted int := 0;
  v_updated  int := 0;
begin
  if not (fin_can(p_org_id) or is_cron() or is_psql_direto()) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  with rows as (
    select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      btg_id text, end_to_end_id text, tipo text, valor numeric,
      data_mov date, descricao text, categoria text, raw jsonb
    )
  ),
  ins as (
    insert into btg_movements (org_id, btg_id, end_to_end_id, tipo, valor, data_mov, descricao, categoria, raw)
    select p_org_id, r.btg_id, r.end_to_end_id, r.tipo, r.valor, r.data_mov, r.descricao, r.categoria, coalesce(r.raw, '{}'::jsonb)
    from rows r
    where r.btg_id is not null and r.data_mov is not null
    on conflict (org_id, btg_id) do update set
      end_to_end_id = excluded.end_to_end_id,
      tipo = excluded.tipo,
      valor = excluded.valor,
      descricao = excluded.descricao,
      categoria = excluded.categoria,
      raw = excluded.raw,
      updated_at = now()
    returning (xmax = 0) as is_insert
  )
  select count(*) filter (where is_insert), count(*) filter (where not is_insert)
    into v_inserted, v_updated from ins;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'total', v_inserted + v_updated);
end; $$;

-- ── abrir_fechamento_contabil: Financeiro OU cron ───────────────────────────
-- (Aproveita e para de notificar membro ARQUIVADO — regra da 178.)
create or replace function abrir_fechamento_contabil(p_org_id uuid, p_competencia text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_novos int := 0;
begin
  if not (fin_can(p_org_id) or is_cron() or is_psql_direto()) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  insert into fechamento_contabil (org_id, competencia)
  values (p_org_id, p_competencia)
  on conflict (org_id, competencia) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('criado', false, 'notificados', 0);
  end if;

  insert into notifications (user_id, org_id, type, actor_id, data)
  select om.user_id, p_org_id, 'fechamento_contabil', null,
         jsonb_build_object('competencia', p_competencia, 'fechamento_id', v_id)
  from organization_members om
  where om.org_id = p_org_id and om.arquivado = false
    and (om.can_finance or om.role in ('owner','admin'));
  get diagnostics v_novos = row_count;

  return jsonb_build_object('criado', true, 'notificados', v_novos);
end $$;

-- ── next_doc_numero: membro da org ──────────────────────────────────────────
-- Chamada de dentro de create_producao/create_midia/update_midia, que já rodam
-- com o JWT do usuário (guard da 143) — auth.uid() continua preenchido lá.
create or replace function next_doc_numero(p_org_id uuid, p_serie text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_num integer;
begin
  if not (is_org_member(p_org_id) or is_psql_direto()) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  insert into doc_series (org_id, serie, prefixo)
  values (p_org_id, p_serie, p_serie)
  on conflict (org_id, serie) do nothing;

  update doc_series
     set proximo_numero = proximo_numero + 1, updated_at = now()
   where org_id = p_org_id and serie = p_serie
   returning proximo_numero - 1 into v_num;

  return v_num;
end; $$;

-- ── Config contábil pro cron (a tabela não é legível sem membership) ────────
create or replace function cron_contabil_orgs()
returns table(org_id uuid, contabil_dia int, contabil_emails text[])
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (is_cron() or is_psql_direto()) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  return query
    select s.org_id, coalesce(s.contabil_dia, 5), coalesce(s.contabil_emails, '{}'::text[])
    from org_settings s
    where s.contabil_ativo;
end $$;
-- O VPS tem default privileges dando execute a anon nas funções novas, então
-- não basta revogar de public — tem que tirar dos dois.
revoke execute on function cron_contabil_orgs() from public, anon;
grant execute on function cron_contabil_orgs() to authenticated;

-- ── Tirar `anon` de quem mexe em dinheiro ───────────────────────────────────
-- Defesa em profundidade: mesmo que um guard caia numa recriação futura, sem
-- token não se chega na função. Chamada interna (de outra security definer)
-- continua funcionando: o privilégio é conferido contra o dono, `postgres`.
--
-- Tem que revogar de PUBLIC, não de `anon`: toda função nasce com EXECUTE pra
-- public, e `anon` herda dali — revogar só do papel não tira nada (medido: a
-- chamada anônima continuava entrando e só parava no guard).
revoke execute on function importar_ofx(uuid, uuid, jsonb)       from public, anon;
revoke execute on function sync_btg_movements(uuid, jsonb)       from public, anon;
revoke execute on function abrir_fechamento_contabil(uuid, text)  from public, anon;
revoke execute on function next_doc_numero(uuid, text)           from public, anon;
grant  execute on function importar_ofx(uuid, uuid, jsonb)      to authenticated;
grant  execute on function sync_btg_movements(uuid, jsonb)      to authenticated;
grant  execute on function abrir_fechamento_contabil(uuid, text) to authenticated;
grant  execute on function next_doc_numero(uuid, text)          to authenticated;

notify pgrst, 'reload schema';
