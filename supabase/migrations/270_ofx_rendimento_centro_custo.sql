-- 270_ofx_rendimento_centro_custo.sql
-- O rendimento conciliado automaticamente nascia SEM centro de custo, e o
-- financeiro reeditava um lançamento por dia (relato do Rafael, 29/08).
-- Medido: 43 lançamentos de 'Rendimentos', 42 com "One a One" preenchido à
-- MÃO e o do dia 30/08 ainda vazio — o trabalho manual estava só escondido.
--
-- Causa numa linha: o INSERT do ramo `eh_rendimento` em `importar_ofx` não
-- listava `centro_custo`. Rendimento de aplicação é receita DA CASA, então o
-- centro é a própria agência — vem de `organizations.name` (multi-tenant),
-- que aqui já casa exatamente com a grafia usada nas 42 linhas.
--
-- A função é recriada a partir da definição VIVA do banco, com essa única
-- mudança. Backfill no fim: o que já entrou sem centro é preenchido.
-- Idempotente.

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
              -- Rendimento de aplicação é receita DA CASA: o centro de custo é
              -- a própria agência (mig. 270). Sem isso nascia vazio e o
              -- financeiro reeditava todo dia.
              (select o.name from organizations o where o.id = p_org_id))
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

-- ── Backfill: rendimentos que já entraram sem centro ────────────────────────
update lancamentos l
   set centro_custo = o.name
  from organizations o
 where o.id = l.org_id
   and l.categoria = 'Rendimentos'
   and l.origem_tipo = 'ofx'
   and nullif(btrim(coalesce(l.centro_custo, '')), '') is null;

notify pgrst, 'reload schema';
