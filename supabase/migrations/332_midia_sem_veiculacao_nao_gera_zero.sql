-- Mídia só de produção não gera linha de veiculação zerada.
--
-- A MX 1654 (É o Amor, produção de uma lona) é a primeira mídia faturada sem
-- veiculação: valor do documento 0, produção R$ 980 x 15% = R$ 147. Saíram DOIS
-- lançamentos — a comissão de produção, certa, e uma "Desconto Padrão Agência"
-- de R$ 0,00 ao lado dela. Na tela de Lançamentos parece documento duplicado.
--
-- A assimetria estava escrita no próprio corpo da função: a parte (2), da
-- produção, já testava `v_prod_comissao > 0`; a parte (1), da veiculação, não
-- testava nada. Agora as duas usam a mesma régua.
--
-- Isto NÃO afrouxa a trava de digitação: `lancar_midia` continua recusando
-- quando veiculação E produção somam zero, pedindo "Faturar sem comissão"
-- explícito. O que muda é só o caso em que uma das duas tem valor e a outra não.

CREATE OR REPLACE FUNCTION public.gerar_lancamento_midia(p_midia_id uuid, p_conta_id uuid DEFAULT NULL::uuid, p_categoria text DEFAULT NULL::text, p_centro_custo text DEFAULT NULL::text, p_forma text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m record;
  v_comissao numeric(14,2);
  v_venc date;
  v_pagador text; v_ct text; v_cn text; v_cid uuid;
  v_prod_total numeric(14,2); v_prod_comissao numeric(14,2);
  v_prod_ct text; v_prod_cn text; v_forn_nome text; v_prod_cid uuid; v_forn_id uuid;
  v_cat text; v_centro text;
begin
  select mi.*, w.name as cliente_nome, ve.name as veiculo_nome
    into m
    from midias mi
    join workspaces w on w.id = mi.workspace_id
    left join veiculos ve on ve.id = mi.veiculo_id
    where mi.id = p_midia_id;
  if not found then return; end if;
  if m.situacao <> 'faturado' then return; end if;

  if m.veiculo_id is null then
    raise exception 'A mídia % não tem veículo — sem veículo não dá para gerar o lançamento da comissão. Informe o veículo na mídia e fature de novo.',
      coalesce(nullif(concat_ws(' ', m.serie, m.numero), ''), m.titulo, p_midia_id::text)
      using errcode = '23502';
  end if;

  v_cat    := coalesce(p_categoria, 'Comissão');
  v_centro := coalesce(p_centro_custo, m.cliente_nome);

  v_venc := _midia_vencimento(m.prazo, m.data_base, m.dias_agencia);

  v_pagador := case
    when m.faturamento in ('valor_bruto','liquido_contra_agencia') then 'veiculo'
    when m.faturamento = 'valor_bruto_comissao_cliente' then 'cliente'
    else 'cliente'
  end;
  -- Guarda o ID do cadastro, não só o nome: é o que dá rastreabilidade ao
  -- lançamento e o que a emissão da NFS-e usa para achar o tomador sem adivinhar.
  if v_pagador = 'veiculo' then v_ct := 'veiculo'; v_cn := m.veiculo_nome; v_cid := m.veiculo_id;
  else v_ct := 'cliente'; v_cn := m.cliente_nome; v_cid := m.workspace_id; end if;

  -- (1) Comissão da VEICULAÇÃO.
  v_comissao := round(coalesce(m.valor,0) * coalesce(m.desconto_pct,0) / 100.0, 2);
  -- `v_comissao > 0` espelha a guarda que a parte de PRODUÇÃO (2) já tinha.
  -- Sem ela, mídia só-produção gerava uma segunda linha de R$ 0,00 ao lado da
  -- comissão de produção — duas linhas para um documento com uma receita só.
  if v_comissao > 0 and not exists (
    select 1 from lancamentos
     where origem_tipo = 'midia' and origem_id = p_midia_id
       and coalesce(origem_parte,'veiculacao') = 'veiculacao'
  ) then
    insert into lancamentos (
      org_id, tipo, origem_tipo, origem_id, origem_parte, contato_tipo, contato_id, contato_nome,
      descricao, valor, vencimento, competencia, situacao,
      conta_id, categoria, centro_custo, forma_pagamento, created_by
    ) values (
      m.org_id, 'entrada', 'midia', p_midia_id, 'veiculacao', v_ct, v_cid, v_cn,
      'Desconto Padrão Agência', v_comissao, v_venc, m.data_base, 'em_aberto',
      p_conta_id, v_cat, v_centro, p_forma, m.created_by
    );
  end if;

  -- (2) Comissão da PRODUÇÃO — só quando há valor e percentual informados.
  v_prod_total := round(
    _br_num(m.detalhe->>'producao_valor')
    * greatest(coalesce(nullif(_br_num(m.detalhe->>'producao_quantidade'), 0), 1), 1), 2);
  v_prod_comissao := round(v_prod_total * _br_num(m.detalhe->>'producao_comissao_pct') / 100.0, 2);

  if v_prod_comissao > 0 and not exists (
    select 1 from lancamentos
     where origem_tipo = 'midia' and origem_id = p_midia_id and origem_parte = 'producao'
  ) then
    if coalesce(m.detalhe->>'producao_tipo', 'no_veiculo') = 'de_terceiros' then
      v_forn_id := nullif(m.detalhe->>'producao_fornecedor_id','')::uuid;
      select f.name into v_forn_nome from fornecedores f where f.id = v_forn_id;
      v_prod_ct  := case when v_forn_nome is null then 'veiculo' else 'fornecedor' end;
      v_prod_cn  := coalesce(v_forn_nome, m.veiculo_nome);
      v_prod_cid := coalesce(v_forn_id, m.veiculo_id);
    else
      v_prod_ct := 'veiculo'; v_prod_cn := m.veiculo_nome; v_prod_cid := m.veiculo_id;
    end if;

    insert into lancamentos (
      org_id, tipo, origem_tipo, origem_id, origem_parte, contato_tipo, contato_id, contato_nome,
      descricao, valor, vencimento, competencia, situacao,
      conta_id, categoria, centro_custo, forma_pagamento, created_by
    ) values (
      m.org_id, 'entrada', 'midia', p_midia_id, 'producao', v_prod_ct, v_prod_cid, v_prod_cn,
      'Comissão de produção', v_prod_comissao, v_venc, m.data_base, 'em_aberto',
      p_conta_id, v_cat, v_centro, p_forma, m.created_by
    );
  end if;
end; $function$;

notify pgrst, 'reload schema';
