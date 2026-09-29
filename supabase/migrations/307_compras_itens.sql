-- ── Itens da compra: o que compõe um lançamento de despesa ──────────────────
--
-- 29/09/2026. Pedido do Rafael: entender desperdício e recorrência do consumo
-- (café, papel higiênico, limpeza) e enxergar picos ao longo do ano. Hoje o
-- lançamento guarda só o total — "Supermercado R$ 88" não diz o que foi.
--
-- Medido antes de construir: 18 compras de consumo em 12 meses (R$ 1.840,60),
-- 17 delas JÁ com o cupom anexado — dá para detalhar o passado inteiro. A
-- categoria "Limpeza" (R$ 11.700) NÃO entra: é a diarista, serviço sem itens.
--
-- O lançamento não muda: valor, categoria, centro de custo e conciliação seguem
-- sendo a verdade contábil. Os itens são uma camada POR BAIXO, e a soma deles
-- tem de fechar com o total (a tela mostra a diferença; o item nunca corrige o
-- lançamento).
--
-- Centro de custo é sempre a agência (custo operacional, decisão do Rafael):
-- por isso não há rateio por cliente aqui.

-- ── Cadastro de produto ─────────────────────────────────────────────────────
-- O cupom escreve "PAPEL HIG NEVE F/D L12P10" hoje e "PAPEL HIGIENICO NEVE 12UN"
-- amanhã. Sem um nome canônico não existe série histórica nem preço comparável.
-- É CADASTRO da org (como status e veículo), nunca lista fixa no código: a IA
-- sugere, a pessoa confirma.
create table if not exists finance_produto (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  nome       text not null,
  -- Unidade em que faz sentido comparar preço (rolo, kg, litro, un). Opcional:
  -- só serve para "quanto custou o rolo", não para o total.
  unidade    text,
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);
-- Case-insensitive: "Café" e "CAFE" são o mesmo produto — é o que sustenta o
-- ON CONFLICT do set_lancamento_itens.
create unique index if not exists idx_finance_produto_nome
  on finance_produto (org_id, lower(nome));

-- ── Itens ───────────────────────────────────────────────────────────────────
create table if not exists lancamento_item (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  lancamento_id  uuid not null references lancamentos(id) on delete cascade,
  produto_id     uuid references finance_produto(id) on delete set null,
  -- Como veio escrito no cupom. Fica guardado mesmo depois de virar produto:
  -- é o que permite conferir contra o papel quando o número não bate.
  descricao      text not null,
  quantidade     numeric(14,3),
  unidade        text,
  valor_unitario numeric(14,4),
  valor_total    numeric(14,2) not null,
  ordem          integer not null default 0,
  -- 'ia' = leitura do cupom; 'manual' = digitado ou corrigido por gente.
  origem         text not null default 'ia',
  created_at     timestamptz not null default now()
);
create index if not exists idx_lancamento_item_lanc on lancamento_item (lancamento_id, ordem);
create index if not exists idx_lancamento_item_produto on lancamento_item (org_id, produto_id);

-- ── Acesso: a mesma régua do resto do Financeiro ────────────────────────────
alter table finance_produto  enable row level security;
alter table lancamento_item  enable row level security;

drop policy if exists "Finance read produto" on finance_produto;
create policy "Finance read produto" on finance_produto for select using (fin_can(org_id));
drop policy if exists "Finance write produto" on finance_produto;
create policy "Finance write produto" on finance_produto for all using (fin_can(org_id)) with check (fin_can(org_id));

drop policy if exists "Finance read item" on lancamento_item;
create policy "Finance read item" on lancamento_item for select using (fin_can(org_id));
drop policy if exists "Finance write item" on lancamento_item;
create policy "Finance write item" on lancamento_item for all using (fin_can(org_id)) with check (fin_can(org_id));

-- anon NÃO entra (a régua do banco: só quem tem sessão).
grant select, insert, update, delete on finance_produto to authenticated;
grant select, insert, update, delete on lancamento_item to authenticated;

-- ── Troca os itens de um lançamento de uma vez ──────────────────────────────
-- Atômico de propósito: a IA devolve a lista inteira, e meia lista gravada é
-- pior que nenhuma. Resolve/cria o produto pelo nome no mesmo passo — assim não
-- há corrida entre duas pessoas cadastrando "Café" ao mesmo tempo.
-- PostgREST é estrito: 1 assinatura por RPC.
drop function if exists set_lancamento_itens(uuid, uuid, jsonb);
create function set_lancamento_itens(p_user_id uuid, p_lancamento_id uuid, p_itens jsonb)
 returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; it jsonb; v_prod uuid; i int := 0;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select org_id into v_org from lancamentos where id = p_lancamento_id;
  if v_org is null then raise exception 'Lançamento não encontrado'; end if;
  if not fin_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  delete from lancamento_item where lancamento_id = p_lancamento_id;

  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    v_prod := null;
    if coalesce(btrim(it->>'produto'), '') <> '' then
      insert into finance_produto (org_id, nome, unidade)
      values (v_org, btrim(it->>'produto'), nullif(btrim(coalesce(it->>'unidade','')), ''))
      on conflict (org_id, lower(nome)) do update set ativo = true
      returning id into v_prod;
    end if;

    insert into lancamento_item (org_id, lancamento_id, produto_id, descricao, quantidade,
                                 unidade, valor_unitario, valor_total, ordem, origem)
    values (
      v_org, p_lancamento_id, v_prod,
      coalesce(nullif(btrim(coalesce(it->>'descricao','')), ''), 'Item'),
      nullif(it->>'quantidade','')::numeric,
      nullif(btrim(coalesce(it->>'unidade','')), ''),
      nullif(it->>'valor_unitario','')::numeric,
      coalesce(nullif(it->>'valor_total','')::numeric, 0),
      i,
      case when coalesce(it->>'origem','ia') = 'manual' then 'manual' else 'ia' end
    );
    i := i + 1;
  end loop;
end; $$;

-- Chamada pelo app com a sessão da pessoa (role authenticated). anon nunca.
revoke execute on function set_lancamento_itens(uuid, uuid, jsonb) from public, anon;
grant  execute on function set_lancamento_itens(uuid, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
