-- 117_comissao_termo.sql
-- Termo: usar SEMPRE "Comissão", nunca "BV" (bonificação por volume). A agência
-- trabalha com comissão fixa por contrato; "BV" (percentual que cresce com volume)
-- tem conotação indevida. Só troca o TEXTO visível — os identificadores internos de
-- dados (parcela tipo 'receber_bv', coluna bv_pct) ficam pra não quebrar o histórico.
-- Idempotente.

-- 1) Novos lançamentos passam a nascer com descrição "Comissão" (era "Comissão BV").
create or replace function gerar_lancamentos_producao(p_producao_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p record; forn_nome text; parc jsonb;
  v_tipo text; v_ct text; v_cn text; v_desc text;
begin
  select pr.*, w.name as cliente_nome into p
    from producao pr join workspaces w on w.id = pr.workspace_id
    where pr.id = p_producao_id;
  if not found then return; end if;
  if p.tipo not in ('pedido', 'fee', 'proposta') then return; end if;

  if exists (
    select 1 from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id and situacao in ('recebido','pago')
  ) then return; end if;

  delete from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id;

  if p.situacao <> 'faturado' then return; end if;

  select name into forn_nome from fornecedores where id = nullif(p.detalhe->>'fornecedor_id','')::uuid;

  for parc in select * from jsonb_array_elements(coalesce(p.detalhe->'parcelas', '[]'::jsonb)) loop
    v_tipo := parc->>'tipo';
    if v_tipo = 'receber_bv' then
      v_ct := 'fornecedor'; v_cn := coalesce(forn_nome, 'Fornecedor'); v_desc := 'Comissão';
    elsif v_tipo = 'receber_honorarios' then
      v_ct := 'cliente'; v_cn := p.cliente_nome; v_desc := 'Honorários';
    elsif v_tipo = 'receber_cliente' then
      v_ct := 'cliente'; v_cn := p.cliente_nome; v_desc := coalesce(nullif(p.titulo,''), case when p.tipo='fee' then 'Fee' else 'Proposta' end);
    else
      continue;
    end if;
    insert into lancamentos (
      org_id, tipo, origem_tipo, origem_id, contato_tipo, contato_nome,
      descricao, valor, vencimento, competencia, situacao, anexos, created_by
    ) values (
      p.org_id, 'entrada', 'producao', p_producao_id, v_ct, v_cn,
      v_desc, coalesce(nullif(parc->>'valor','')::numeric, 0), nullif(parc->>'vencimento','')::date,
      nullif(parc->>'vencimento','')::date, 'em_aberto', coalesce(p.anexos, '[]'::jsonb), p.created_by
    );
  end loop;
end; $$;

grant execute on function gerar_lancamentos_producao(uuid) to anon, authenticated;

-- 2) Lançamentos já gravados: renomeia "Comissão BV" -> "Comissão".
update lancamentos set descricao = 'Comissão' where descricao = 'Comissão BV';

notify pgrst, 'reload schema';
