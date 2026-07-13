-- 102_faturamento_conferencia_docs.sql
-- Conferência do Faturamento: documentos (NF/boleto/comprovantes) recolhidos ANTES
-- de faturar ficam no doc de origem (midias/producao) e são COPIADOS pro lançamento
-- na geração. Assim a NF/boleto acompanham o a-receber. Idempotente.

alter table midias   add column if not exists anexos jsonb not null default '[]'::jsonb;
alter table producao add column if not exists anexos jsonb not null default '[]'::jsonb;

create or replace function set_midia_anexos(p_user_id uuid, p_midia_id uuid, p_anexos jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from midias m join organization_members om on om.org_id = m.org_id
    where m.id = p_midia_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update midias set anexos = coalesce(p_anexos, '[]'::jsonb) where id = p_midia_id;
end; $$;

create or replace function set_producao_anexos(p_user_id uuid, p_producao_id uuid, p_anexos jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from producao p join organization_members om on om.org_id = p.org_id
    where p.id = p_producao_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update producao set anexos = coalesce(p_anexos, '[]'::jsonb), updated_at = now() where id = p_producao_id;
end; $$;

grant execute on function set_midia_anexos(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function set_producao_anexos(uuid,uuid,jsonb) to anon, authenticated;

-- Geração da mídia: copia os anexos da mídia pro lançamento da comissão.
create or replace function gerar_lancamento_midia(p_midia_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m record;
  v_comissao numeric(14,2);
  v_base date;
  v_venc date;
  v_pagador text;
  v_contato_tipo text;
  v_contato_nome text;
begin
  select mi.*, w.name as cliente_nome, ve.name as veiculo_nome
    into m
    from midias mi
    join workspaces w on w.id = mi.workspace_id
    join veiculos ve on ve.id = mi.veiculo_id
    where mi.id = p_midia_id;
  if not found then return; end if;
  if m.situacao <> 'faturado' then return; end if;

  if exists (select 1 from lancamentos where origem_tipo = 'midia' and origem_id = p_midia_id) then
    return;
  end if;

  v_comissao := round(coalesce(m.valor,0) * coalesce(m.desconto_pct,0) / 100.0, 2);

  v_base := case
    when m.prazo = 'a_vista' then m.data_base
    when m.prazo = '10_dfm' then (date_trunc('month', m.data_base) + interval '1 month - 1 day')::date + 10
    when m.prazo = '15_dfm' then (date_trunc('month', m.data_base) + interval '1 month - 1 day')::date + 15
    when m.prazo = '20_dfm' then (date_trunc('month', m.data_base) + interval '1 month - 1 day')::date + 20
    when m.prazo = '30_dfm' then (date_trunc('month', m.data_base) + interval '1 month - 1 day')::date + 30
    else m.data_base
  end;
  v_venc := case when v_base is not null then v_base + coalesce(m.dias_agencia, 0) else null end;

  v_pagador := case
    when m.faturamento in ('valor_bruto','liquido_contra_agencia') then 'veiculo'
    when m.faturamento = 'valor_bruto_comissao_cliente' then 'cliente'
    else 'cliente'
  end;
  if v_pagador = 'veiculo' then
    v_contato_tipo := 'veiculo'; v_contato_nome := m.veiculo_nome;
  else
    v_contato_tipo := 'cliente'; v_contato_nome := m.cliente_nome;
  end if;

  insert into lancamentos (
    org_id, tipo, origem_tipo, origem_id, contato_tipo, contato_nome,
    descricao, valor, vencimento, competencia, situacao, anexos, created_by
  ) values (
    m.org_id, 'entrada', 'midia', p_midia_id, v_contato_tipo, v_contato_nome,
    'Desconto Padrão Agência', v_comissao, v_venc, m.data_base, 'em_aberto',
    coalesce(m.anexos, '[]'::jsonb), m.created_by
  );
end; $$;

grant execute on function gerar_lancamento_midia(uuid) to anon, authenticated;

-- Geração da produção (fee/pedido/proposta): copia os anexos da produção pra cada parcela.
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
      v_ct := 'fornecedor'; v_cn := coalesce(forn_nome, 'Fornecedor'); v_desc := 'Comissão BV';
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

notify pgrst, 'reload schema';
