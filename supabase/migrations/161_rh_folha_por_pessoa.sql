-- 161_rh_folha_por_pessoa.sql
-- Folha × Financeiro POR PESSOA (substitui o consolidado "Salários" da 149).
-- Cada empregado (categoria != 722) vira 1 lançamento "a pagar" (líquido, venc no
-- último dia útil do mês). Sócios (722) NÃO geram salário — só as guias (INSS/FGTS
-- consolidadas, incluem a parte deles). Mecânica venda→despesa: BUSCA um lançamento
-- manual já existente da pessoa no mês; se achar, VINCULA (carimba origem, não duplica);
-- se não, sugere CRIAR. Rastreável por origem_ref = folha:<comp>:pessoa:<colaborador_id>.
-- Idempotente.

-- ── Normaliza texto p/ casar nome (sem depender de unaccent) ──
create or replace function rh_norm(t text) returns text language sql immutable set search_path to 'public' as $$
  select lower(btrim(translate(coalesce(t, ''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
    'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')));
$$;

-- ── Plano de conciliação da competência (read-only): por pessoa, com o lançamento
--    candidato já encontrado. status = vinculado | achado | novo. ──
create or replace function rh_folha_plano(p_org_id uuid, p_competencia date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_ini date := date_trunc('month', p_competencia)::date;
  v_fim date := (date_trunc('month', p_competencia) + interval '1 month' - interval '1 day')::date;
  v_comp text := to_char(p_competencia, 'YYYY-MM');
  v_salarios jsonb := '[]'::jsonb;
  v_socios jsonb := '[]'::jsonb;
  r record; v_lanc record; v_status text; v_nome text;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  for r in
    select f.colaborador_id, coalesce(c.nome, f.nome) as nome, f.liquido, f.categoria
    from rh_folha f
    left join rh_colaborador c on c.id = f.colaborador_id
    where f.org_id = p_org_id and f.competencia = p_competencia
    order by coalesce(c.nome, f.nome)
  loop
    -- Sócio (pró-labore): não recebe salário; entra só nas guias.
    if r.categoria ilike '%722%' or r.categoria ilike '%individual%' then
      v_socios := v_socios || jsonb_build_object('nome', r.nome);
      continue;
    end if;
    if coalesce(r.liquido, 0) <= 0 then continue; end if;
    v_nome := r.nome;

    -- Já existe o lançamento de folha desta pessoa nesta competência? → vinculado.
    select id, valor, vencimento, situacao into v_lanc
    from lancamentos
    where org_id = p_org_id and origem_tipo = 'folha'
      and origem_ref = 'folha:' || v_comp || ':pessoa:' || r.colaborador_id
    limit 1;

    if found then
      v_status := 'vinculado';
    else
      -- Busca um lançamento manual da pessoa no mês (mesma lógica venda→despesa):
      -- saída, no mês da competência, ainda não amarrado a folha, casando por nome ou valor.
      select id, valor, vencimento, situacao into v_lanc
      from lancamentos
      where org_id = p_org_id and tipo = 'saida'
        and coalesce(origem_tipo, '') <> 'folha'
        and vencimento between v_ini and v_fim
        and (
          (r.colaborador_id is not null and rh_norm(contato_nome) = rh_norm(v_nome))
          or round(coalesce(valor, 0), 2) = round(r.liquido, 2)
        )
      order by (rh_norm(contato_nome) = rh_norm(v_nome)) desc, abs(coalesce(valor, 0) - r.liquido) asc
      limit 1;
      v_status := case when found then 'achado' else 'novo' end;
    end if;

    v_salarios := v_salarios || jsonb_build_object(
      'colaborador_id', r.colaborador_id, 'nome', v_nome, 'liquido', r.liquido,
      'status', v_status,
      'lancamento_id', case when v_status = 'novo' then null else v_lanc.id end,
      'lanc_valor',    case when v_status = 'novo' then null else v_lanc.valor end,
      'lanc_venc',     case when v_status = 'novo' then null else v_lanc.vencimento end,
      'lanc_situacao', case when v_status = 'novo' then null else v_lanc.situacao end);
  end loop;

  return jsonb_build_object('competencia', v_comp, 'salarios', v_salarios, 'socios', v_socios);
end; $$;
revoke execute on function rh_folha_plano(uuid, date) from public;
grant execute on function rh_folha_plano(uuid, date) to authenticated;

-- ── Aplica a conciliação: salários por pessoa (vincular/criar) + guias consolidadas ──
-- p_salarios: [{colaborador_id, nome, acao: 'vincular'|'criar'|'ignorar', lancamento_id?, valor, venc}]
create or replace function rh_folha_aplicar(
  p_org_id uuid, p_competencia date, p_salarios jsonb,
  p_inss numeric, p_venc_inss date, p_fgts numeric, p_venc_fgts date
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_comp text := to_char(p_competencia, 'YYYY-MM');
  v_compbr text := to_char(p_competencia, 'MM/YYYY');
  v_vinc int := 0; v_cri int := 0; v_gui int := 0;
  s jsonb; v_ref text; v_val numeric; v_venc date; v_colab uuid; v_nome text; g record;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;

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
      -- Carimba a origem no lançamento manual existente (não sobrescreve valor/venc do Rafael).
      update lancamentos set
        origem_tipo = 'folha', origem_ref = v_ref, competencia = p_competencia,
        categoria = coalesce(nullif(categoria, ''), 'Salários'), updated_at = now()
      where id = (s->>'lancamento_id')::uuid and org_id = p_org_id
        and coalesce(origem_tipo, '') <> 'folha';
      if found then v_vinc := v_vinc + 1; end if;

    elsif (s->>'acao') = 'criar' then
      perform 1 from lancamentos where org_id = p_org_id and origem_tipo = 'folha' and origem_ref = v_ref;
      if found then
        update lancamentos set valor = coalesce(v_val, valor), vencimento = coalesce(v_venc, vencimento),
          competencia = p_competencia, updated_at = now()
        where org_id = p_org_id and origem_tipo = 'folha' and origem_ref = v_ref and situacao = 'em_aberto';
      else
        insert into lancamentos (org_id, tipo, origem_tipo, origem_ref, contato_tipo, contato_nome,
          descricao, valor, vencimento, competencia, situacao, categoria, forma_pagamento, created_by)
        values (p_org_id, 'saida', 'folha', v_ref, 'colaborador', v_nome,
          'Folha — Salário ' || v_nome || ' ' || v_compbr, coalesce(v_val, 0), v_venc, p_competencia,
          'em_aberto', 'Salários', 'transferencia', auth.uid());
        v_cri := v_cri + 1;
      end if;
    end if;
  end loop;

  -- Guias consolidadas (INSS/FGTS) — incluem a parte dos sócios.
  for g in
    select * from (values
      ('inss', 'Encargos - INSS', 'Folha — INSS ' || v_compbr, p_inss, p_venc_inss),
      ('fgts', 'Encargos - FGTS', 'Folha — FGTS ' || v_compbr, p_fgts, p_venc_fgts)
    ) as t(corrente, categoria, descricao, valor, venc)
  loop
    if coalesce(g.valor, 0) <= 0 or g.venc is null then continue; end if;
    v_ref := 'folha:' || v_comp || ':' || g.corrente;
    perform 1 from lancamentos where org_id = p_org_id and origem_tipo = 'folha' and origem_ref = v_ref;
    if found then
      update lancamentos set valor = g.valor, vencimento = g.venc, competencia = p_competencia,
        descricao = g.descricao, categoria = g.categoria, updated_at = now()
      where org_id = p_org_id and origem_tipo = 'folha' and origem_ref = v_ref and situacao = 'em_aberto';
    else
      insert into lancamentos (org_id, tipo, origem_tipo, origem_ref, contato_tipo, contato_nome,
        descricao, valor, vencimento, competencia, situacao, categoria, forma_pagamento, created_by)
      values (p_org_id, 'saida', 'folha', v_ref, 'outro', 'Folha de pagamento',
        g.descricao, g.valor, g.venc, p_competencia, 'em_aberto', g.categoria, 'transferencia', auth.uid());
    end if;
    v_gui := v_gui + 1;
  end loop;

  return jsonb_build_object('vinculados', v_vinc, 'criados', v_cri, 'guias', v_gui);
end; $$;
revoke execute on function rh_folha_aplicar(uuid, date, jsonb, numeric, date, numeric, date) from public;
grant execute on function rh_folha_aplicar(uuid, date, jsonb, numeric, date, numeric, date) to authenticated;

notify pgrst, 'reload schema';
