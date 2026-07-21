-- 136: excluir lançamento com trava de verdade + estorno do faturamento.
--
-- Como era (063): delete_lancamento só checava `origem_tipo = 'manual'`. Não olhava
-- situação nem conciliação. Como btg_conciliacao_itens tem `on delete cascade` pro
-- lançamento, apagar um conciliado destruía o vínculo bancário EM SILÊNCIO e deixava
-- o btg_movements travado em 'conciliado' apontando pra um id morto — sem caminho de
-- volta a não ser desfazer_conciliacao_btg.
--
-- Como fica:
--  · pago/recebido, baixa parcial ou conciliado → recusa, com motivo.
--  · manual / conta_azul / ofx → apaga só ele.
--  · producao / midia → ESTORNA o documento inteiro: apaga TODAS as parcelas dele e
--    devolve o documento pra 'faturar' (volta a aparecer no Faturamento). Excluir
--    "uma parcela" de um Fee de 12 e deixar 11 órfãs esconderia dinheiro do fluxo.
--
-- conta_azul virou origem editável/apagável: a fonte morreu (plano cancelado em
-- 21/07/2026), não existe documento pra ressincronizar.

-- ── Motivo do bloqueio (null = pode excluir). Usado pela trava e pela prévia. ──
create or replace function _lancamento_bloqueio_exclusao(p_id uuid)
returns text language sql stable set search_path = public as $$
  select case
    when l.situacao in ('pago','recebido') then
      'Lançamento já ' || l.situacao || '. Reabra a baixa antes de excluir.'
    when coalesce(l.valor_realizado, 0) > 0 then
      'Lançamento tem baixa parcial registrada. Reabra a baixa antes de excluir.'
    when exists (select 1 from btg_conciliacao_itens i where i.lancamento_id = l.id) then
      'Lançamento está conciliado com o extrato do banco. Desfaça a conciliação antes de excluir.'
  end
  from lancamentos l where l.id = p_id;
$$;

-- ── Prévia do impacto, pro modal de confirmação dizer o que vai acontecer ──
create or replace function impacto_excluir_lancamento(p_user_id uuid, p_lancamento_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l record; v_bloqueio text; v_serie text; v_numero int; v_n int; v_total numeric;
begin
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then return jsonb_build_object('pode', false, 'motivo', 'Lançamento não encontrado'); end if;
  if not exists (
    select 1 from organization_members
    where org_id = l.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then return jsonb_build_object('pode', false, 'motivo', 'Acesso negado'); end if;

  v_bloqueio := _lancamento_bloqueio_exclusao(l.id);
  if v_bloqueio is not null then
    return jsonb_build_object('pode', false, 'motivo', v_bloqueio);
  end if;

  if l.origem_tipo in ('producao','midia') then
    if l.origem_tipo = 'producao' then
      select p.serie, p.numero into v_serie, v_numero from producao p where p.id = l.origem_id;
    else
      select m.serie, m.numero into v_serie, v_numero from midias m where m.id = l.origem_id;
    end if;
    select count(*), coalesce(sum(valor), 0) into v_n, v_total
      from lancamentos where org_id = l.org_id and origem_tipo = l.origem_tipo and origem_id = l.origem_id;
    -- Uma parcela travada trava o estorno inteiro: não dá pra devolver ao faturamento
    -- um documento que já tem dinheiro recebido no meio.
    select string_agg(distinct b, ' ') into v_bloqueio from (
      select _lancamento_bloqueio_exclusao(l2.id) b from lancamentos l2
      where l2.org_id = l.org_id and l2.origem_tipo = l.origem_tipo and l2.origem_id = l.origem_id
    ) t where b is not null;
    if v_bloqueio is not null then
      return jsonb_build_object('pode', false, 'motivo',
        'Outra parcela deste documento já foi movimentada: ' || v_bloqueio);
    end if;
    return jsonb_build_object(
      'pode', true, 'escopo', 'documento',
      'doc_serie', v_serie, 'doc_numero', v_numero,
      'parcelas', v_n, 'valor_total', v_total);
  end if;

  return jsonb_build_object('pode', true, 'escopo', 'lancamento',
    'origem', l.origem_tipo, 'valor_total', l.valor, 'parcelas', 1);
end; $$;

-- ── Exclusão ──
-- Passa a devolver jsonb (a UI precisa saber se estornou o documento ou só apagou a
-- linha); `create or replace` não muda tipo de retorno, então dropa antes.
-- PostgREST é estrito com overload: tem que ficar 1 assinatura só.
drop function if exists delete_lancamento(uuid, uuid);
create or replace function delete_lancamento(p_user_id uuid, p_lancamento_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l record; v_bloqueio text; v_n int;
begin
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then return jsonb_build_object('ok', true, 'escopo', 'nada'); end if;
  if not exists (
    select 1 from organization_members
    where org_id = l.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  v_bloqueio := _lancamento_bloqueio_exclusao(l.id);
  if v_bloqueio is not null then raise exception '%', v_bloqueio; end if;

  -- Documento (produção/mídia): estorna o faturamento inteiro.
  if l.origem_tipo in ('producao','midia') then
    select string_agg(distinct b, ' ') into v_bloqueio from (
      select _lancamento_bloqueio_exclusao(l2.id) b from lancamentos l2
      where l2.org_id = l.org_id and l2.origem_tipo = l.origem_tipo and l2.origem_id = l.origem_id
    ) t where b is not null;
    if v_bloqueio is not null then
      raise exception 'Outra parcela deste documento já foi movimentada: %', v_bloqueio;
    end if;

    delete from lancamentos
     where org_id = l.org_id and origem_tipo = l.origem_tipo and origem_id = l.origem_id;
    get diagnostics v_n = row_count;

    -- 'faturar' = aguardando faturamento; é o que a tela Faturamento lista.
    if l.origem_tipo = 'producao' then
      update producao set situacao = 'faturar', updated_at = now() where id = l.origem_id;
    else
      update midias   set situacao = 'faturar', updated_at = now() where id = l.origem_id;
    end if;

    return jsonb_build_object('ok', true, 'escopo', 'documento', 'excluidos', v_n);
  end if;

  delete from lancamentos where id = p_lancamento_id;
  return jsonb_build_object('ok', true, 'escopo', 'lancamento', 'excluidos', 1);
end; $$;

-- ── update_lancamento: conta_azul passa a editar descrição/valor/contato como manual ──
create or replace function update_lancamento(p_user_id uuid, p_lancamento_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare l record; v_livre boolean;
begin
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then raise exception 'Lançamento não encontrado'; end if;
  if not exists (
    select 1 from organization_members
    where org_id = l.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  -- Texto/valor são livres quando NÃO existe documento vivo por trás. Em produção/mídia
  -- o documento é a fonte — editar aqui seria desfeito na próxima regeração.
  v_livre := l.origem_tipo in ('manual', 'conta_azul', 'ofx');

  update lancamentos set
    tipo            = case when v_livre then coalesce(nullif(p_data->>'tipo',''), tipo) else tipo end,
    contato_tipo    = case when v_livre and p_data ? 'contato_tipo' then nullif(p_data->>'contato_tipo','') else contato_tipo end,
    contato_nome    = case when v_livre and p_data ? 'contato_nome' then nullif(p_data->>'contato_nome','') else contato_nome end,
    descricao       = case when v_livre and p_data ? 'descricao' then nullif(p_data->>'descricao','') else descricao end,
    valor           = case when v_livre then coalesce(nullif(p_data->>'valor','')::numeric, valor) else valor end,
    -- campos do financeiro: editáveis em qualquer origem (inclui renegociar vencimento)
    vencimento      = case when p_data ? 'vencimento' then nullif(p_data->>'vencimento','')::date else vencimento end,
    competencia     = case when p_data ? 'competencia' then nullif(p_data->>'competencia','')::date else competencia end,
    conta_id        = case when p_data ? 'conta_id' then nullif(p_data->>'conta_id','')::uuid else conta_id end,
    categoria       = case when p_data ? 'categoria' then nullif(p_data->>'categoria','') else categoria end,
    centro_custo    = case when p_data ? 'centro_custo' then nullif(p_data->>'centro_custo','') else centro_custo end,
    forma_pagamento = case when p_data ? 'forma_pagamento' then nullif(p_data->>'forma_pagamento','') else forma_pagamento end,
    observacao      = case when p_data ? 'observacao' then nullif(p_data->>'observacao','') else observacao end,
    recorrente      = coalesce((p_data->>'recorrente')::boolean, recorrente),
    updated_at      = now()
  where id = p_lancamento_id;
end; $$;

notify pgrst, 'reload schema';
