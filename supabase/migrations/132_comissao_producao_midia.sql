-- 132_comissao_producao_midia.sql
-- Comissão da PRODUÇÃO da Mídia Externa vira lançamento próprio.
--
-- Caso real (Rafael, 21/07/2026): outdoor em que a REDE opera a mídia por
-- R$ 1.000 pagando 20% de comissão, e a OUTMAR (impressão da lona) cobra R$ 350
-- pagando 15% sobre a produção. São DOIS pagadores e DUAS notas — por isso dois
-- lançamentos, não um valor somado.
--
-- Quem paga a comissão de produção:
--   producao_tipo = 'no_veiculo'   → o próprio veículo (ele produziu)
--   producao_tipo = 'de_terceiros' → o fornecedor escolhido no form (novo campo
--                                    detalhe.producao_fornecedor_id)
-- Em ambos quem paga é o FORNECEDOR do serviço, então o termo é "Comissão"
-- (honorários é quando quem paga é o cliente — não é o caso aqui).
--
-- Idempotente.

-- ── Discriminador das duas partes do mesmo documento ────────────────────────
-- Sem isto o "Atualizar do documento" (ressincronizar_lancamento) sobrescreveria
-- o lançamento da produção com o valor da veiculação: ele acha o lançamento pela
-- mídia e não sabe qual das duas partes está atualizando.
alter table lancamentos add column if not exists origem_parte text;  -- 'veiculacao' | 'producao' | null (legado)

-- Lançamentos de mídia que já existem são todos de veiculação (a produção nunca
-- gerou lançamento até aqui).
update lancamentos set origem_parte = 'veiculacao'
 where origem_tipo = 'midia' and origem_parte is null;

-- ── Número vindo de campo de texto do form ──────────────────────────────────
-- O detalhe da mídia é jsonb com o texto que a pessoa digitou ("1.234,56").
-- Esta função espelha EXATAMENTE o parseMoney do app (lib/midia.ts): tira todos
-- os pontos e troca a vírgula por ponto. Tem que ser idêntico — se o banco
-- interpretar diferente da tela, o valor conferido não é o valor lançado.
create or replace function _br_num(p text) returns numeric
language plpgsql immutable as $$
declare t text;
begin
  t := nullif(btrim(coalesce(p, '')), '');
  if t is null then return 0; end if;
  t := replace(replace(t, '.', ''), ',', '.');
  return coalesce(t::numeric, 0);
exception when others then
  return 0;   -- texto impossível não pode derrubar o faturamento
end $$;

grant execute on function _br_num(text) to anon, authenticated;

-- ── Vencimento da mídia (mesma conta usada nos dois lançamentos) ────────────
create or replace function _midia_vencimento(p_prazo text, p_data_base date, p_dias_agencia int)
returns date language sql immutable as $$
  select case
    when p_data_base is null then null
    else (case
      when p_prazo = 'a_vista' then p_data_base
      when p_prazo = '10_dfm' then (date_trunc('month', p_data_base) + interval '1 month - 1 day')::date + 10
      when p_prazo = '15_dfm' then (date_trunc('month', p_data_base) + interval '1 month - 1 day')::date + 15
      when p_prazo = '20_dfm' then (date_trunc('month', p_data_base) + interval '1 month - 1 day')::date + 20
      when p_prazo = '30_dfm' then (date_trunc('month', p_data_base) + interval '1 month - 1 day')::date + 30
      else p_data_base
    end) + coalesce(p_dias_agencia, 0)
  end
$$;

grant execute on function _midia_vencimento(text, date, int) to anon, authenticated;

-- ── Gera os lançamentos da mídia: veiculação + produção ─────────────────────
create or replace function gerar_lancamento_midia(p_midia_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m record;
  v_comissao numeric(14,2);
  v_venc date;
  v_pagador text; v_ct text; v_cn text;
  v_prod_total numeric(14,2); v_prod_comissao numeric(14,2);
  v_prod_ct text; v_prod_cn text; v_forn_nome text;
begin
  select mi.*, w.name as cliente_nome, ve.name as veiculo_nome
    into m
    from midias mi
    join workspaces w on w.id = mi.workspace_id
    join veiculos ve on ve.id = mi.veiculo_id
    where mi.id = p_midia_id;
  if not found then return; end if;
  if m.situacao <> 'faturado' then return; end if;

  v_venc := _midia_vencimento(m.prazo, m.data_base, m.dias_agencia);

  v_pagador := case
    when m.faturamento in ('valor_bruto','liquido_contra_agencia') then 'veiculo'
    when m.faturamento = 'valor_bruto_comissao_cliente' then 'cliente'
    else 'cliente'
  end;
  if v_pagador = 'veiculo' then v_ct := 'veiculo'; v_cn := m.veiculo_nome;
  else v_ct := 'cliente'; v_cn := m.cliente_nome; end if;

  -- (1) Comissão da VEICULAÇÃO — o que já existia.
  v_comissao := round(coalesce(m.valor,0) * coalesce(m.desconto_pct,0) / 100.0, 2);
  if not exists (
    select 1 from lancamentos
     where origem_tipo = 'midia' and origem_id = p_midia_id
       and coalesce(origem_parte,'veiculacao') = 'veiculacao'
  ) then
    insert into lancamentos (
      org_id, tipo, origem_tipo, origem_id, origem_parte, contato_tipo, contato_nome,
      descricao, valor, vencimento, competencia, situacao, created_by
    ) values (
      m.org_id, 'entrada', 'midia', p_midia_id, 'veiculacao', v_ct, v_cn,
      'Desconto Padrão Agência', v_comissao, v_venc, m.data_base, 'em_aberto', m.created_by
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
      -- Sem fornecedor escolhido não dá pra dizer de quem cobrar: cai no veículo
      -- e o lançamento fica visível pra correção, em vez de não existir.
      v_prod_ct := case when v_forn_nome is null then 'veiculo' else 'fornecedor' end;
      v_prod_cn := coalesce(v_forn_nome, m.veiculo_nome);
    else
      v_prod_ct := 'veiculo'; v_prod_cn := m.veiculo_nome;
    end if;

    insert into lancamentos (
      org_id, tipo, origem_tipo, origem_id, origem_parte, contato_tipo, contato_nome,
      descricao, valor, vencimento, competencia, situacao, created_by
    ) values (
      m.org_id, 'entrada', 'midia', p_midia_id, 'producao', v_prod_ct, v_prod_cn,
      'Comissão de produção', v_prod_comissao, v_venc, m.data_base, 'em_aberto', m.created_by
    );
  end if;
end; $$;

grant execute on function gerar_lancamento_midia(uuid) to anon, authenticated;

-- ── Ressincronizar respeitando a parte ──────────────────────────────────────
create or replace function ressincronizar_lancamento(p_user_id uuid, p_lancamento_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  l record; m record;
  v_valor numeric(14,2); v_venc date;
  v_pagador text; v_ct text; v_cn text;
  v_prod_total numeric(14,2); v_forn_nome text;
begin
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then return; end if;
  if not exists (
    select 1 from organization_members where org_id = l.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  if l.origem_tipo <> 'midia' or l.origem_id is null then
    update lancamentos set revisar = false, updated_at = now() where id = p_lancamento_id; return;
  end if;

  select mi.*, w.name as cliente_nome, ve.name as veiculo_nome into m
    from midias mi join workspaces w on w.id = mi.workspace_id join veiculos ve on ve.id = mi.veiculo_id
    where mi.id = l.origem_id;
  if not found then
    update lancamentos set revisar = false, updated_at = now() where id = p_lancamento_id; return;
  end if;

  v_venc := _midia_vencimento(m.prazo, m.data_base, m.dias_agencia);

  if coalesce(l.origem_parte, 'veiculacao') = 'producao' then
    -- Parte da PRODUÇÃO: valor e pagador saem do bloco de produção do documento.
    v_prod_total := round(
      _br_num(m.detalhe->>'producao_valor')
      * greatest(coalesce(nullif(_br_num(m.detalhe->>'producao_quantidade'), 0), 1), 1), 2);
    v_valor := round(v_prod_total * _br_num(m.detalhe->>'producao_comissao_pct') / 100.0, 2);
    if coalesce(m.detalhe->>'producao_tipo', 'no_veiculo') = 'de_terceiros' then
      select f.name into v_forn_nome from fornecedores f
       where f.id = nullif(m.detalhe->>'producao_fornecedor_id','')::uuid;
      v_ct := case when v_forn_nome is null then 'veiculo' else 'fornecedor' end;
      v_cn := coalesce(v_forn_nome, m.veiculo_nome);
    else
      v_ct := 'veiculo'; v_cn := m.veiculo_nome;
    end if;
  else
    -- Parte da VEICULAÇÃO.
    v_valor := round(coalesce(m.valor,0) * coalesce(m.desconto_pct,0) / 100.0, 2);
    v_pagador := case
      when m.faturamento in ('valor_bruto','liquido_contra_agencia') then 'veiculo'
      when m.faturamento = 'valor_bruto_comissao_cliente' then 'cliente'
      else 'cliente'
    end;
    if v_pagador = 'veiculo' then v_ct := 'veiculo'; v_cn := m.veiculo_nome;
    else v_ct := 'cliente'; v_cn := m.cliente_nome; end if;
  end if;

  update lancamentos set
    valor = v_valor, vencimento = v_venc, competencia = m.data_base,
    contato_tipo = v_ct, contato_nome = v_cn, revisar = false, updated_at = now()
  where id = p_lancamento_id;
end; $$;

grant execute on function ressincronizar_lancamento(uuid,uuid) to anon, authenticated;

notify pgrst, 'reload schema';
