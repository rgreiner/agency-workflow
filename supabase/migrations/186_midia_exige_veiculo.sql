-- 186_midia_exige_veiculo.sql
-- Auditoria 02/08 — Financeiro: "mídia sem veículo fatura sem gerar lançamento —
-- o dinheiro some em silêncio".
--
-- `gerar_lancamento_midia` buscava a mídia com INNER JOIN em `veiculos` e, se não
-- achasse, dava `return` calado. `lancar_midia` marca situacao='faturado' ANTES de
-- chamar a geradora — então o documento saía da fila de faturamento como se
-- tivesse sido faturado e nada entrava no caixa. Mesmo buraco que a migration 144
-- fechou do lado da produção (valor zero), e que ficou aberto do lado da mídia.
--
-- Regra do Rafael (03/08): não deve existir lançamento de mídia sem veículo.
-- Então a validação vira ERRO na hora de faturar, não silêncio depois.
--
-- Medido antes de aplicar: 3 mídias faturadas em produção, todas com veículo e
-- todas com lançamento — nenhum estrago pra reparar, a mudança é preventiva.
-- Idempotente.

-- ── gerar_lancamento_midia: LEFT JOIN + erro explícito ──────────────────────
-- A ordem importa: rascunho (situação <> 'faturado') tem que continuar saindo
-- limpo mesmo sem veículo — `update_midia` chama esta função a cada edição. Só
-- depois de confirmar que a mídia está faturada é que a falta de veículo vira erro.
create or replace function gerar_lancamento_midia(
  p_midia_id uuid, p_conta_id uuid default null, p_categoria text default null,
  p_centro_custo text default null, p_forma text default null
) returns void language plpgsql security definer set search_path to 'public' as $$
declare
  m record;
  v_comissao numeric(14,2);
  v_venc date;
  v_pagador text; v_ct text; v_cn text;
  v_prod_total numeric(14,2); v_prod_comissao numeric(14,2);
  v_prod_ct text; v_prod_cn text; v_forn_nome text;
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
  if v_pagador = 'veiculo' then v_ct := 'veiculo'; v_cn := m.veiculo_nome;
  else v_ct := 'cliente'; v_cn := m.cliente_nome; end if;

  -- (1) Comissão da VEICULAÇÃO.
  v_comissao := round(coalesce(m.valor,0) * coalesce(m.desconto_pct,0) / 100.0, 2);
  if not exists (
    select 1 from lancamentos
     where origem_tipo = 'midia' and origem_id = p_midia_id
       and coalesce(origem_parte,'veiculacao') = 'veiculacao'
  ) then
    insert into lancamentos (
      org_id, tipo, origem_tipo, origem_id, origem_parte, contato_tipo, contato_nome,
      descricao, valor, vencimento, competencia, situacao,
      conta_id, categoria, centro_custo, forma_pagamento, created_by
    ) values (
      m.org_id, 'entrada', 'midia', p_midia_id, 'veiculacao', v_ct, v_cn,
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
      select f.name into v_forn_nome from fornecedores f
       where f.id = nullif(m.detalhe->>'producao_fornecedor_id','')::uuid;
      v_prod_ct := case when v_forn_nome is null then 'veiculo' else 'fornecedor' end;
      v_prod_cn := coalesce(v_forn_nome, m.veiculo_nome);
    else
      v_prod_ct := 'veiculo'; v_prod_cn := m.veiculo_nome;
    end if;

    insert into lancamentos (
      org_id, tipo, origem_tipo, origem_id, origem_parte, contato_tipo, contato_nome,
      descricao, valor, vencimento, competencia, situacao,
      conta_id, categoria, centro_custo, forma_pagamento, created_by
    ) values (
      m.org_id, 'entrada', 'midia', p_midia_id, 'producao', v_prod_ct, v_prod_cn,
      'Comissão de produção', v_prod_comissao, v_venc, m.data_base, 'em_aberto',
      p_conta_id, v_cat, v_centro, p_forma, m.created_by
    );
  end if;
end; $$;

-- ── lancar_midia: confere ANTES de marcar como faturado ─────────────────────
-- Validar depois não adianta: o `update` já teria tirado a mídia da fila.
create or replace function lancar_midia(
  p_user_id uuid, p_midia_id uuid, p_conta_id uuid default null,
  p_categoria text default null, p_centro_custo text default null, p_forma text default null
) returns void language plpgsql security definer set search_path to 'public' as $$
declare m record; v_doc text; v_comissao numeric(14,2); v_prod numeric(14,2);
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from midias mi
    join organization_members om on om.org_id = mi.org_id
    where mi.id = p_midia_id and om.user_id = p_user_id
      and om.role in ('owner','admin','manager') and om.arquivado = false
  ) then raise exception 'Acesso negado'; end if;

  select * into m from midias where id = p_midia_id;
  if not found then raise exception 'Mídia não encontrada'; end if;
  v_doc := coalesce(nullif(concat_ws(' ', m.serie, m.numero), ''), m.titulo, 'esta mídia');

  if m.veiculo_id is null then
    raise exception 'Não dá para faturar % sem veículo: a comissão é cobrada do veículo ou do cliente por conta dele, e sem isso o lançamento não nasce. Informe o veículo na mídia primeiro.', v_doc
      using errcode = '23502';
  end if;

  -- Faturar sem comissão nenhuma marcaria o documento como faturado e não geraria
  -- lançamento — o mesmo sumiço silencioso, por outro caminho. A 144 já fez isso
  -- do lado da produção.
  v_comissao := round(coalesce(m.valor,0) * coalesce(m.desconto_pct,0) / 100.0, 2);
  v_prod := round(
    round(_br_num(m.detalhe->>'producao_valor')
      * greatest(coalesce(nullif(_br_num(m.detalhe->>'producao_quantidade'), 0), 1), 1), 2)
    * _br_num(m.detalhe->>'producao_comissao_pct') / 100.0, 2);
  if coalesce(v_comissao,0) + coalesce(v_prod,0) <= 0 then
    raise exception 'A comissão de % está zerada: valor do documento %, desconto % por cento. Faturar assim tiraria o documento da fila sem gerar nada no caixa — confira os dois campos.',
      v_doc, coalesce(m.valor,0), coalesce(m.desconto_pct,0)
      using errcode = '23514';
  end if;

  update midias set situacao = 'faturado', updated_at = now() where id = p_midia_id;
  perform gerar_lancamento_midia(p_midia_id, p_conta_id, p_categoria, p_centro_custo, p_forma);
end; $$;

revoke execute on function lancar_midia(uuid, uuid, uuid, text, text, text) from public, anon;
grant execute on function lancar_midia(uuid, uuid, uuid, text, text, text) to authenticated;

-- A geradora não recebe usuário nem confere nada: é auxiliar, chamada de dentro
-- de quem já conferiu. Ninguém deve alcançá-la pelo PostgREST — mesma classe das
-- quatro RPCs fechadas na 183 (o default privilege do VPS dá execute a anon em
-- toda função nova, então tem que revogar de public E de anon).
revoke execute on function gerar_lancamento_midia(uuid, uuid, text, text, text) from public, anon;

notify pgrst, 'reload schema';
