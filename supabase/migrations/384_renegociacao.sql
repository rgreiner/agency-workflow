-- 384 — renegociação de títulos a receber (acordo parcelado) (27/10/2026)
--
-- Opera encerrou o contrato com R$ 30 mil vencidos; o Rafael autorizou a Flávia a
-- parcelar sem juros em até 12x. Até aqui não havia como: dar "recebido" no título
-- antigo falsearia o caixa e excluir apagaria o histórico. Agora os títulos de origem
-- ficam com situacao = 'renegociado' (saem do em aberto, do atraso e da régua; não
-- entram no realizado) e nascem N parcelas novas, um grupo só, com o cliente, a
-- categoria e o centro de custo do título de origem. Valor total preservado; a última
-- parcela absorve o arredondamento. Gate = fin_can.
create or replace function public.fin_renegociar(p_org uuid, p_titulos uuid[], p_parcelas int, p_primeiro_venc date, p_obs text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_total numeric; v_n int; v_base lancamentos; v_grupo uuid := gen_random_uuid();
  v_parcela numeric; i int; v_ids uuid[] := '{}'; v_id uuid; v_hoje date := fin_hoje(); v_docs text;
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_parcelas is null or p_parcelas < 1 or p_parcelas > 24 then raise exception 'Número de parcelas inválido (1 a 24)'; end if;
  if p_primeiro_venc is null or p_primeiro_venc < v_hoje then raise exception 'O primeiro vencimento precisa ser hoje ou depois'; end if;
  select count(*), sum(valor) into v_n, v_total from lancamentos
   where id = any(p_titulos) and org_id = p_org and tipo = 'entrada' and situacao = 'em_aberto' and transferencia_id is null;
  if v_n is null or v_n = 0 or v_n <> coalesce(array_length(p_titulos, 1), 0) then
    raise exception 'Todos os títulos precisam ser a receber, em aberto e desta organização';
  end if;
  -- base = o título com cliente vinculado (o mais recente); senão, o mais recente
  select * into v_base from lancamentos where id = any(p_titulos)
   order by (contato_tipo = 'cliente') desc nulls last, vencimento desc nulls last limit 1;
  select string_agg(coalesce(nullif(btrim(coalesce(d.doc_serie, '') || ' ' || coalesce(d.doc_numero::text, '')), ''), left(l.descricao, 30)) || ' (' || to_char(l.vencimento, 'DD/MM/YY') || ')', ', ' order by l.vencimento)
    into v_docs from lancamentos l left join lancamentos_doc d on d.id = l.id where l.id = any(p_titulos);
  v_parcela := round(v_total / p_parcelas, 2);
  for i in 1..p_parcelas loop
    insert into lancamentos (org_id, tipo, contato_tipo, contato_id, contato_nome, workspace_id, descricao, valor, vencimento,
                             situacao, categoria, centro_custo, conta_id, competencia, parcela_num, parcela_total, grupo_id,
                             origem_tipo, origem_ref, observacao, created_by)
    values (p_org, 'entrada', v_base.contato_tipo, v_base.contato_id, v_base.contato_nome, v_base.workspace_id,
            format('Acordo %s/%s — renegociação', i, p_parcelas),
            case when i < p_parcelas then v_parcela else v_total - v_parcela * (p_parcelas - 1) end,
            (p_primeiro_venc + make_interval(months => i - 1))::date, 'em_aberto', v_base.categoria, v_base.centro_custo, v_base.conta_id,
            date_trunc('month', (p_primeiro_venc + make_interval(months => i - 1)))::date, i, p_parcelas, v_grupo,
            'acordo', array_to_string(p_titulos, ','),
            concat_ws(' · ', 'Renegociação de: ' || v_docs, nullif(btrim(coalesce(p_obs, '')), '')), auth.uid())
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  update lancamentos set situacao = 'renegociado', promessa_data = null, updated_at = now(),
         observacao = concat_ws(' · ', nullif(observacao, ''), format('Renegociado em %s: acordo em %sx (grupo %s)', to_char(v_hoje, 'DD/MM/YYYY'), p_parcelas, v_grupo))
   where id = any(p_titulos);
  return jsonb_build_object('grupo', v_grupo, 'total', v_total, 'parcelas', p_parcelas, 'valor_parcela', v_parcela,
                            'primeiro_vencimento', p_primeiro_venc, 'ids', to_jsonb(v_ids), 'renegociados', v_docs);
end $$;
revoke execute on function public.fin_renegociar(uuid, uuid[], int, date, text) from public, anon;
grant execute on function public.fin_renegociar(uuid, uuid[], int, date, text) to authenticated;

notify pgrst, 'reload schema';
