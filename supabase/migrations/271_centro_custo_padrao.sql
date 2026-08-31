-- 271_centro_custo_padrao.sql
-- O centro de custo do rendimento sai do CÓDIGO e vira CADASTRO (correção do
-- Rafael, 29/08): "importante não definir em código, isso pode ser definido
-- pelo centro de custo da empresa ou uma medida padrão".
--
-- A 270 resolvia o sintoma usando `organizations.name` — funciona para a One a
-- One por coincidência de grafia, mas é regra escondida em função. Agora o
-- próprio cadastro de centros (`org_settings.finance_centros_custo`, editado
-- em Financeiro → Categorias e centros) marca qual é o centro DA CASA:
-- `{"nome": "One a One", "cor": "...", "padrao": true}`.
--
-- Serve para todo lançamento sem cliente — hoje o rendimento conciliado, amanhã
-- qualquer despesa da casa que precise de um centro. Sem nenhum marcado, o
-- campo fica vazio como antes (nada é inventado).
-- Idempotente.

-- Helper de leitura: o primeiro centro ATIVO marcado como padrão.
create or replace function fin_centro_padrao(p_org uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select c->>'nome'
    from org_settings s,
         jsonb_array_elements(coalesce(s.finance_centros_custo, '[]'::jsonb)) c
   where s.org_id = p_org
     and coalesce((c->>'padrao')::boolean, false)
     and not coalesce((c->>'arquivado')::boolean, false)
     and nullif(btrim(coalesce(c->>'nome', '')), '') is not null
   limit 1;
$$;
revoke execute on function fin_centro_padrao(uuid) from public, anon;
grant  execute on function fin_centro_padrao(uuid) to authenticated;

-- Semeia o que já é verdade no dado (não no código): o centro da casa é o que
-- as 42 conciliações antigas usavam. Só marca se ninguém marcou ainda.
update org_settings s
   set finance_centros_custo = (
     select jsonb_agg(
       case when fin_chave_nome(coalesce(c->>'nome', '')) = fin_chave_nome(o.name)
            then c || jsonb_build_object('padrao', true) else c end)
       from jsonb_array_elements(s.finance_centros_custo) c)
  from organizations o
 where o.id = s.org_id
   and jsonb_typeof(s.finance_centros_custo) = 'array'
   and not exists (
     select 1 from jsonb_array_elements(s.finance_centros_custo) c2
      where coalesce((c2->>'padrao')::boolean, false));


-- ── importar_ofx passa a ler o cadastro, não o nome da org ─────────────────
CREATE OR REPLACE FUNCTION public.importar_ofx(p_org_id uuid, p_conta_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      insert into lancamentos (org_id, tipo, origem_tipo, descricao, valor, vencimento, competencia, situacao, conta_id, categoria, centro_custo)
      values (p_org_id, 'entrada', 'ofx', 'Rendimento', v_valor, r.data_mov, r.data_mov, 'em_aberto', p_conta_id, 'Rendimentos',
              -- Rendimento de aplicação é receita DA CASA: o centro vem do
              -- CADASTRO (centro marcado como padrão em Financeiro →
              -- Categorias e centros), nunca de regra em código — mig. 271.
              -- Ninguém marcado ⇒ null, como era antes: nada é inventado.
              fin_centro_padrao(p_org_id))
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
end; $function$;

notify pgrst, 'reload schema';
