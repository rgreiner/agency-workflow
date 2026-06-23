-- 041_faturamento_lancamento.sql
-- Separa os dois momentos do Financeiro:
--   Faturamento = fila de conferência (não cria lançamento sozinho)
--   Lançamento  = controle mensal (competência/vencimento, NF, boleto, situação)
-- Idempotente.

-- Campos de controle do lançamento
alter table lancamentos add column if not exists competencia    date;
alter table lancamentos add column if not exists nf_emitida     boolean not null default false;
alter table lancamentos add column if not exists boleto_gerado  boolean not null default false;

-- gerar_lancamento_midia vira "garantir que existe" (NÃO recria se já existe — o
-- lançamento é um snapshot do financeiro). Só cria se a mídia está faturada.
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

  -- já lançado? não mexe (snapshot do financeiro)
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
    descricao, valor, vencimento, competencia, situacao, created_by
  ) values (
    m.org_id, 'entrada', 'midia', p_midia_id, v_contato_tipo, v_contato_nome,
    'Desconto Padrão Agência', v_comissao, v_venc, m.data_base, 'em_aberto', m.created_by
  );
end; $$;

-- Faturamento → "Lançar": cria o lançamento de uma mídia faturada (com checagem de acesso).
create or replace function lancar_midia(p_user_id uuid, p_midia_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from midias m
    join organization_members om on om.org_id = m.org_id
    where m.id = p_midia_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  perform gerar_lancamento_midia(p_midia_id);
end; $$;

-- set_midia_situacao NÃO gera mais lançamento (isso agora é manual no Faturamento).
create or replace function set_midia_situacao(p_user_id uuid, p_midia_id uuid, p_situacao text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from midias m
    join organization_members om on om.org_id = m.org_id
    where m.id = p_midia_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update midias set situacao = p_situacao, updated_at = now() where id = p_midia_id;
end; $$;

-- update_midia NÃO ressincroniza mais o lançamento (snapshot fica com o financeiro).
create or replace function update_midia(p_user_id uuid, p_midia_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from midias m
    join organization_members om on om.org_id = m.org_id
    where m.id = p_midia_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  update midias set
    workspace_id         = coalesce(nullif(p_data->>'workspace_id','')::uuid, workspace_id),
    campaign_id          = nullif(p_data->>'campaign_id','')::uuid,
    veiculo_id           = coalesce(nullif(p_data->>'veiculo_id','')::uuid, veiculo_id),
    tipo                 = nullif(p_data->>'tipo',''),
    titulo               = coalesce(nullif(p_data->>'titulo',''), titulo),
    emissao              = nullif(p_data->>'emissao','')::date,
    job                  = nullif(p_data->>'job',''),
    aut_veiculo          = nullif(p_data->>'aut_veiculo',''),
    codigo_identificador = nullif(p_data->>'codigo_identificador',''),
    nota_fiscal          = nullif(p_data->>'nota_fiscal',''),
    pecas                = nullif(p_data->>'pecas',''),
    praca                = nullif(p_data->>'praca',''),
    abrangencia          = nullif(p_data->>'abrangencia',''),
    valor                = coalesce(nullif(p_data->>'valor','')::numeric, 0),
    desconto_pct         = coalesce(nullif(p_data->>'desconto_pct','')::numeric, 20),
    faturamento          = nullif(p_data->>'faturamento',''),
    prazo                = nullif(p_data->>'prazo',''),
    data_base            = nullif(p_data->>'data_base','')::date,
    dias_agencia         = coalesce(nullif(p_data->>'dias_agencia','')::int, 7),
    primeira_veiculacao  = nullif(p_data->>'primeira_veiculacao','')::date,
    ultima_veiculacao    = nullif(p_data->>'ultima_veiculacao','')::date,
    contato              = nullif(p_data->>'contato',''),
    responsavel_id       = nullif(p_data->>'responsavel_id','')::uuid,
    situacao             = coalesce(nullif(p_data->>'situacao',''), situacao),
    observacao           = nullif(p_data->>'observacao',''),
    texto_legal          = nullif(p_data->>'texto_legal',''),
    updated_at           = now()
  where id = p_midia_id;
end; $$;

-- Controle do lançamento (situação + NF/boleto)
create or replace function set_lancamento_situacao(p_user_id uuid, p_lancamento_id uuid, p_situacao text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from lancamentos l
    join organization_members om on om.org_id = l.org_id
    where l.id = p_lancamento_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update lancamentos set situacao = p_situacao, updated_at = now() where id = p_lancamento_id;
end; $$;

create or replace function set_lancamento_flags(p_user_id uuid, p_lancamento_id uuid, p_nf boolean, p_boleto boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from lancamentos l
    join organization_members om on om.org_id = l.org_id
    where l.id = p_lancamento_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update lancamentos set nf_emitida = p_nf, boleto_gerado = p_boleto, updated_at = now()
  where id = p_lancamento_id;
end; $$;

grant execute on function gerar_lancamento_midia(uuid) to anon, authenticated;
grant execute on function lancar_midia(uuid,uuid) to anon, authenticated;
grant execute on function set_midia_situacao(uuid,uuid,text) to anon, authenticated;
grant execute on function update_midia(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function set_lancamento_situacao(uuid,uuid,text) to anon, authenticated;
grant execute on function set_lancamento_flags(uuid,uuid,boolean,boolean) to anon, authenticated;

notify pgrst, 'reload schema';
