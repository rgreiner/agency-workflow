-- 187_centro_custo_folha_e_lote.sql
-- Auditoria 02/08 — Financeiro: "centro de custo obrigatório tem dois furos: a
-- folha nasce nula e o lote consegue limpar".
--
-- O centro de custo é a dimensão "de qual cliente vem (ou sai) o dinheiro" — é o
-- que sustenta a rentabilidade por cliente. O formulário e as actions de criação
-- exigem. Faltavam dois caminhos:
--
--   1) `rh_folha_aplicar` insere os lançamentos da folha (salário por pessoa e as
--      guias de INSS/FGTS) sem centro nenhum. Como a ponte folha→financeiro ainda
--      tem ZERO uso, o estrago não existe — mas ia aparecer inteiro no primeiro
--      mês em que ela rodasse, e folha é a maior despesa fixa da agência.
--      Custo da agência não é de cliente nenhum: o centro é a própria org. Não é
--      convenção inventada aqui — 530 dos lançamentos de hoje já usam "One a One"
--      (= organizations.name) exatamente com esse sentido.
--
--   2) `update_lancamentos_lote` fazia `nullif(p_data->>'centro_custo','')`, então
--      mandar vazio APAGAVA o centro de N lançamentos de uma vez — o único
--      caminho do sistema que desfazia a obrigatoriedade, e em lote. Agora vazio
--      significa "não mexe": limpar centro, se for mesmo o caso, é um a um.
--
-- Idempotente.

-- ── 1) Folha nasce com o centro de custo da agência ─────────────────────────
create or replace function rh_folha_aplicar(
  p_org_id uuid, p_competencia date, p_salarios jsonb, p_inss numeric, p_venc_inss date,
  p_fgts numeric, p_venc_fgts date, p_inss_lanc uuid default null, p_fgts_lanc uuid default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_comp text := to_char(p_competencia, 'YYYY-MM');
  v_compbr text := to_char(p_competencia, 'MM/YYYY');
  v_vinc int := 0; v_cri int := 0; v_gui int := 0;
  v_centro text;
  s jsonb; v_ref text; v_val numeric; v_venc date; v_colab uuid; v_nome text; g record;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  -- Centro de custo da folha = a própria agência (custo interno, não de cliente).
  select name into v_centro from organizations where id = p_org_id;

  -- Salários por pessoa
  for s in select * from jsonb_array_elements(coalesce(p_salarios, '[]'::jsonb))
  loop
    if (s->>'acao') = 'ignorar' then continue; end if;
    v_colab := nullif(s->>'colaborador_id', '')::uuid;
    v_nome  := coalesce(nullif(s->>'nome', ''), 'Colaborador');
    v_val   := nullif(s->>'valor', '')::numeric;
    v_venc  := nullif(s->>'venc', '')::date;
    v_ref   := 'folha:' || v_comp || ':pessoa:' || coalesce(v_colab::text, rh_norm(v_nome));

    if (s->>'acao') = 'vincular' and nullif(s->>'lancamento_id', '') is not null then
      -- Previsto vira realizado: carimba a origem E atualiza valor/venc pelo da
      -- folha — só em aberto. Pago não muda de valor (só ganha o carimbo).
      -- O centro só é preenchido quando está vazio: escolha de quem lançou manda.
      update lancamentos set
        origem_tipo = 'folha', origem_ref = v_ref, competencia = p_competencia,
        valor = coalesce(v_val, valor), vencimento = coalesce(v_venc, vencimento),
        categoria = coalesce(nullif(categoria, ''), 'Salários'),
        centro_custo = coalesce(nullif(centro_custo, ''), v_centro), updated_at = now()
      where id = (s->>'lancamento_id')::uuid and org_id = p_org_id
        and coalesce(origem_tipo, '') <> 'folha' and situacao = 'em_aberto';
      if found then
        v_vinc := v_vinc + 1;
      else
        update lancamentos set
          origem_tipo = 'folha', origem_ref = v_ref, competencia = p_competencia,
          categoria = coalesce(nullif(categoria, ''), 'Salários'),
          centro_custo = coalesce(nullif(centro_custo, ''), v_centro), updated_at = now()
        where id = (s->>'lancamento_id')::uuid and org_id = p_org_id
          and coalesce(origem_tipo, '') <> 'folha';
        if found then v_vinc := v_vinc + 1; end if;
      end if;

    elsif (s->>'acao') = 'criar' then
      perform 1 from lancamentos where org_id = p_org_id and origem_tipo = 'folha' and origem_ref = v_ref;
      if found then
        update lancamentos set valor = coalesce(v_val, valor), vencimento = coalesce(v_venc, vencimento),
          competencia = p_competencia,
          centro_custo = coalesce(nullif(centro_custo, ''), v_centro), updated_at = now()
        where org_id = p_org_id and origem_tipo = 'folha' and origem_ref = v_ref and situacao = 'em_aberto';
      else
        insert into lancamentos (org_id, tipo, origem_tipo, origem_ref, contato_tipo, contato_nome,
          descricao, valor, vencimento, competencia, situacao, categoria, centro_custo, forma_pagamento, created_by)
        values (p_org_id, 'saida', 'folha', v_ref, 'colaborador', v_nome,
          'Folha — Salário ' || v_nome || ' ' || v_compbr, coalesce(v_val, 0), v_venc, p_competencia,
          'em_aberto', 'Salários', v_centro, 'transferencia', auth.uid());
        v_cri := v_cri + 1;
      end if;
    end if;
  end loop;

  -- Guias (INSS/FGTS) — incluem a parte dos sócios. Se veio o provisionado
  -- (p_*_lanc), adota: carimba a origem e atualiza pro valor real da guia.
  for g in
    select * from (values
      ('inss', 'Encargos - INSS', 'Folha — INSS ' || v_compbr, p_inss, p_venc_inss, p_inss_lanc),
      ('fgts', 'Encargos - FGTS', 'Folha — FGTS ' || v_compbr, p_fgts, p_venc_fgts, p_fgts_lanc)
    ) as t(corrente, categoria, descricao, valor, venc, lanc_id)
  loop
    if coalesce(g.valor, 0) <= 0 or g.venc is null then continue; end if;
    v_ref := 'folha:' || v_comp || ':' || g.corrente;

    if g.lanc_id is not null then
      -- Mantém a descrição/categoria do provisionado do Rafael; só valor/venc/origem.
      update lancamentos set origem_tipo = 'folha', origem_ref = v_ref,
        valor = g.valor, vencimento = g.venc, competencia = p_competencia,
        centro_custo = coalesce(nullif(centro_custo, ''), v_centro), updated_at = now()
      where id = g.lanc_id and org_id = p_org_id and situacao = 'em_aberto'
        and (coalesce(origem_tipo, '') <> 'folha' or origem_ref = v_ref);
      if found then v_gui := v_gui + 1; continue; end if;
    end if;

    perform 1 from lancamentos where org_id = p_org_id and origem_tipo = 'folha' and origem_ref = v_ref;
    if found then
      update lancamentos set valor = g.valor, vencimento = g.venc, competencia = p_competencia,
        descricao = g.descricao, categoria = g.categoria,
        centro_custo = coalesce(nullif(centro_custo, ''), v_centro), updated_at = now()
      where org_id = p_org_id and origem_tipo = 'folha' and origem_ref = v_ref and situacao = 'em_aberto';
    else
      insert into lancamentos (org_id, tipo, origem_tipo, origem_ref, contato_tipo, contato_nome,
        descricao, valor, vencimento, competencia, situacao, categoria, centro_custo, forma_pagamento, created_by)
      values (p_org_id, 'saida', 'folha', v_ref, 'outro', 'Folha de pagamento',
        g.descricao, g.valor, g.venc, p_competencia, 'em_aberto', g.categoria, v_centro, 'transferencia', auth.uid());
    end if;
    v_gui := v_gui + 1;
  end loop;

  return jsonb_build_object('vinculados', v_vinc, 'criados', v_cri, 'guias', v_gui);
end; $$;

-- ── 2) Lote não apaga mais o centro de custo ────────────────────────────────
-- Vazio agora quer dizer "não mexe neste campo". Os outros campos seguem
-- podendo ser limpos: conta e forma de pagamento não são obrigatórios, e
-- categoria já tem a própria trava na tela.
create or replace function update_lancamentos_lote(p_user_id uuid, p_ids uuid[], p_data jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_org uuid; v_atualizados int := 0; v_bloqueados int := 0; v_total int;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  v_total := coalesce(array_length(p_ids, 1), 0);
  if v_total = 0 then
    return jsonb_build_object('atualizados', 0, 'bloqueados', 0, 'total', 0);
  end if;

  -- Todos têm que ser da MESMA org, e o usuário precisa ter acesso a ela.
  select distinct org_id into v_org from lancamentos where id = any(p_ids);
  if v_org is null then raise exception 'Lançamentos não encontrados'; end if;
  if (select count(distinct org_id) from lancamentos where id = any(p_ids)) > 1 then
    raise exception 'Seleção mistura organizações';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = v_org and user_id = p_user_id
      and role in ('owner','admin','manager') and arquivado = false
  ) then raise exception 'Acesso negado'; end if;

  select count(*) into v_bloqueados from lancamentos
  where id = any(p_ids)
    and (situacao in ('pago','recebido') or coalesce(valor_realizado, 0) > 0);

  update lancamentos set
    conta_id        = case when p_data ? 'conta_id' then nullif(p_data->>'conta_id','')::uuid else conta_id end,
    categoria       = case when p_data ? 'categoria' then nullif(p_data->>'categoria','') else categoria end,
    -- centro_custo: só sobrescreve com valor NÃO vazio (vazio = não mexe)
    centro_custo    = coalesce(nullif(p_data->>'centro_custo',''), centro_custo),
    forma_pagamento = case when p_data ? 'forma_pagamento' then nullif(p_data->>'forma_pagamento','') else forma_pagamento end,
    nf_emitida      = coalesce((p_data->>'nf_emitida')::boolean, nf_emitida),
    boleto_gerado   = coalesce((p_data->>'boleto_gerado')::boolean, boleto_gerado),
    updated_at      = now()
  where id = any(p_ids)
    and situacao not in ('pago','recebido')
    and coalesce(valor_realizado, 0) = 0;
  get diagnostics v_atualizados = row_count;

  return jsonb_build_object(
    'atualizados', v_atualizados, 'bloqueados', v_bloqueados, 'total', v_total);
end $$;

revoke execute on function update_lancamentos_lote(uuid, uuid[], jsonb) from public, anon;
grant execute on function update_lancamentos_lote(uuid, uuid[], jsonb) to authenticated;

notify pgrst, 'reload schema';
