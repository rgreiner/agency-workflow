-- 063_financeiro_livro_caixa.sql
-- Etapa 0 do Financeiro: transforma `lancamentos` no LIVRO-CAIXA completo.
--  - Contas financeiras (bancos/caixa) p/ posição das contas e saldo projetado.
--  - Lançamento manual (entrada/saída fora de mídia/produção/fee).
--  - Planejado x realizado: data de liquidação, juros/multa/desconto/tarifa.
--  - Categoria e centro de custo (config da org em org_settings, com cor).
-- Idempotente.

-- ── Contas financeiras ───────────────────────────────────────
create table if not exists contas_financeiras (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organizations(id) on delete cascade,
  nome          text not null,
  tipo          text not null default 'banco',  -- banco | caixa | aplicacao | outro
  saldo_inicial numeric(14,2) not null default 0,
  cor           text,                            -- hex opcional (badge)
  ativo         boolean not null default true,
  ordem         int not null default 0,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_contas_fin_org on contas_financeiras(org_id);

alter table contas_financeiras enable row level security;

drop policy if exists "Org members read contas_fin" on contas_financeiras;
create policy "Org members read contas_fin" on contas_financeiras
  for select using (is_org_member(org_id));

drop policy if exists "Manager+ manage contas_fin" on contas_financeiras;
create policy "Manager+ manage contas_fin" on contas_financeiras
  for all using (org_member_role(org_id) in ('owner','admin','manager'));

drop trigger if exists set_contas_fin_updated_at on contas_financeiras;
create trigger set_contas_fin_updated_at before update on contas_financeiras
  for each row execute function set_updated_at();

-- ── Campos novos em lancamentos (planejado x realizado) ──────
alter table lancamentos add column if not exists conta_id        uuid references contas_financeiras(id) on delete set null;
alter table lancamentos add column if not exists categoria       text;
alter table lancamentos add column if not exists centro_custo    text;
alter table lancamentos add column if not exists data_liquidacao date;            -- data real do receb./pgto
alter table lancamentos add column if not exists valor_realizado numeric(14,2);   -- quanto entrou/saiu de fato
alter table lancamentos add column if not exists juros           numeric(14,2) not null default 0;
alter table lancamentos add column if not exists multa           numeric(14,2) not null default 0;
alter table lancamentos add column if not exists desconto        numeric(14,2) not null default 0;
alter table lancamentos add column if not exists tarifa          numeric(14,2) not null default 0;
alter table lancamentos add column if not exists forma_pagamento text;
alter table lancamentos add column if not exists observacao      text;
alter table lancamentos add column if not exists recorrente      boolean not null default false;
alter table lancamentos add column if not exists parcela_num     int;
alter table lancamentos add column if not exists parcela_total   int;
alter table lancamentos add column if not exists grupo_id        uuid;            -- agrupa parcelas/recorrências

create index if not exists idx_lancamentos_conta on lancamentos(conta_id);
create index if not exists idx_lancamentos_venc on lancamentos(org_id, vencimento);

-- ── Config da org: categorias e centros de custo (com cor) ───
alter table org_settings add column if not exists finance_categorias    jsonb not null default '[]'::jsonb;  -- [{nome, tipo: entrada|saida|ambos, cor}]
alter table org_settings add column if not exists finance_centros_custo jsonb not null default '[]'::jsonb;  -- [{nome, cor}]

-- ── RPCs: Contas financeiras ─────────────────────────────────
create or replace function create_conta_financeira(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  insert into contas_financeiras (org_id, nome, tipo, saldo_inicial, cor, ativo, ordem, created_by)
  values (
    p_org_id,
    coalesce(nullif(p_data->>'nome',''), 'Conta'),
    coalesce(nullif(p_data->>'tipo',''), 'banco'),
    coalesce(nullif(p_data->>'saldo_inicial','')::numeric, 0),
    nullif(p_data->>'cor',''),
    coalesce((p_data->>'ativo')::boolean, true),
    coalesce(nullif(p_data->>'ordem','')::int, 0),
    p_user_id
  ) returning id into v_id;
  return v_id;
end; $$;

create or replace function update_conta_financeira(p_user_id uuid, p_conta_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from contas_financeiras c
    join organization_members om on om.org_id = c.org_id
    where c.id = p_conta_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  update contas_financeiras set
    nome          = coalesce(nullif(p_data->>'nome',''), nome),
    tipo          = coalesce(nullif(p_data->>'tipo',''), tipo),
    saldo_inicial = coalesce(nullif(p_data->>'saldo_inicial','')::numeric, saldo_inicial),
    cor           = case when p_data ? 'cor' then nullif(p_data->>'cor','') else cor end,
    ativo         = coalesce((p_data->>'ativo')::boolean, ativo),
    ordem         = coalesce(nullif(p_data->>'ordem','')::int, ordem),
    updated_at    = now()
  where id = p_conta_id;
end; $$;

-- ── RPCs: Lançamento manual ──────────────────────────────────
create or replace function create_lancamento(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  insert into lancamentos (
    org_id, tipo, origem_tipo, contato_tipo, contato_nome, descricao, valor,
    vencimento, competencia, situacao, conta_id, categoria, centro_custo,
    forma_pagamento, observacao, recorrente, created_by
  ) values (
    p_org_id,
    coalesce(nullif(p_data->>'tipo',''), 'saida'),
    'manual',
    nullif(p_data->>'contato_tipo',''),
    nullif(p_data->>'contato_nome',''),
    nullif(p_data->>'descricao',''),
    coalesce(nullif(p_data->>'valor','')::numeric, 0),
    nullif(p_data->>'vencimento','')::date,
    coalesce(nullif(p_data->>'competencia','')::date, nullif(p_data->>'vencimento','')::date),
    coalesce(nullif(p_data->>'situacao',''), 'em_aberto'),
    nullif(p_data->>'conta_id','')::uuid,
    nullif(p_data->>'categoria',''),
    nullif(p_data->>'centro_custo',''),
    nullif(p_data->>'forma_pagamento',''),
    nullif(p_data->>'observacao',''),
    coalesce((p_data->>'recorrente')::boolean, false),
    p_user_id
  ) returning id into v_id;
  return v_id;
end; $$;

-- update_lancamento: edita um lançamento (manual OU os campos do financeiro de
-- qualquer origem — categoria, conta, centro de custo, observação, vencimento…).
create or replace function update_lancamento(p_user_id uuid, p_lancamento_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare l record;
begin
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then raise exception 'Lançamento não encontrado'; end if;
  if not exists (
    select 1 from organization_members
    where org_id = l.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  update lancamentos set
    -- valor/contato/descrição só são editáveis em lançamento manual (snapshot da mídia fica intacto)
    tipo            = case when l.origem_tipo = 'manual' then coalesce(nullif(p_data->>'tipo',''), tipo) else tipo end,
    contato_tipo    = case when l.origem_tipo = 'manual' and p_data ? 'contato_tipo' then nullif(p_data->>'contato_tipo','') else contato_tipo end,
    contato_nome    = case when l.origem_tipo = 'manual' and p_data ? 'contato_nome' then nullif(p_data->>'contato_nome','') else contato_nome end,
    descricao       = case when l.origem_tipo = 'manual' and p_data ? 'descricao' then nullif(p_data->>'descricao','') else descricao end,
    valor           = case when l.origem_tipo = 'manual' then coalesce(nullif(p_data->>'valor','')::numeric, valor) else valor end,
    -- campos do financeiro: editáveis em qualquer origem
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

-- delete_lancamento: só apaga lançamento MANUAL (os de origem mídia/produção/fee
-- são geridos pelo documento; some-se de lá).
create or replace function delete_lancamento(p_user_id uuid, p_lancamento_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l record;
begin
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then return; end if;
  if not exists (
    select 1 from organization_members
    where org_id = l.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  if l.origem_tipo <> 'manual' then
    raise exception 'Só é possível excluir lançamento manual (este veio de %)', l.origem_tipo;
  end if;
  delete from lancamentos where id = p_lancamento_id;
end; $$;

-- liquidar_lancamento: baixa (recebimento/pagamento) com data real e ajustes.
-- valor_realizado = valor + juros + multa - desconto - tarifa (default), ou o
-- valor_realizado informado. Define situacao = recebido (entrada) | pago (saida).
create or replace function liquidar_lancamento(p_user_id uuid, p_lancamento_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  l record;
  v_juros numeric(14,2);
  v_multa numeric(14,2);
  v_desc  numeric(14,2);
  v_tar   numeric(14,2);
  v_real  numeric(14,2);
begin
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then raise exception 'Lançamento não encontrado'; end if;
  if not exists (
    select 1 from organization_members
    where org_id = l.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  v_juros := coalesce(nullif(p_data->>'juros','')::numeric, 0);
  v_multa := coalesce(nullif(p_data->>'multa','')::numeric, 0);
  v_desc  := coalesce(nullif(p_data->>'desconto','')::numeric, 0);
  v_tar   := coalesce(nullif(p_data->>'tarifa','')::numeric, 0);
  v_real  := coalesce(nullif(p_data->>'valor_realizado','')::numeric,
                      coalesce(l.valor,0) + v_juros + v_multa - v_desc - v_tar);

  update lancamentos set
    situacao        = case when l.tipo = 'entrada' then 'recebido' else 'pago' end,
    data_liquidacao = coalesce(nullif(p_data->>'data_liquidacao','')::date, current_date),
    conta_id        = coalesce(nullif(p_data->>'conta_id','')::uuid, conta_id),
    forma_pagamento = coalesce(nullif(p_data->>'forma_pagamento',''), forma_pagamento),
    juros = v_juros, multa = v_multa, desconto = v_desc, tarifa = v_tar,
    valor_realizado = v_real,
    updated_at = now()
  where id = p_lancamento_id;
end; $$;

-- reabrir_lancamento: desfaz a baixa (volta pra em_aberto, limpa realizado).
create or replace function reabrir_lancamento(p_user_id uuid, p_lancamento_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l record;
begin
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then return; end if;
  if not exists (
    select 1 from organization_members
    where org_id = l.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update lancamentos set
    situacao = 'em_aberto', data_liquidacao = null, valor_realizado = null,
    juros = 0, multa = 0, desconto = 0, tarifa = 0, updated_at = now()
  where id = p_lancamento_id;
end; $$;

-- ── Config da org: categorias / centros de custo ─────────────
create or replace function set_finance_config(p_user_id uuid, p_org_id uuid, p_categorias jsonb, p_centros jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  insert into org_settings (org_id, finance_categorias, finance_centros_custo)
  values (p_org_id, coalesce(p_categorias,'[]'::jsonb), coalesce(p_centros,'[]'::jsonb))
  on conflict (org_id) do update set
    finance_categorias    = coalesce(p_categorias, org_settings.finance_categorias),
    finance_centros_custo = coalesce(p_centros, org_settings.finance_centros_custo);
end; $$;

grant execute on function create_conta_financeira(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function update_conta_financeira(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function create_lancamento(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function update_lancamento(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function delete_lancamento(uuid,uuid) to anon, authenticated;
grant execute on function liquidar_lancamento(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function reabrir_lancamento(uuid,uuid) to anon, authenticated;
grant execute on function set_finance_config(uuid,uuid,jsonb,jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
