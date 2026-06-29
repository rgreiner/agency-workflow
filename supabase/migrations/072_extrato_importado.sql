-- 072_extrato_importado.sql
-- Financeiro: snapshot read-only do extrato da Conta Azul (import manual de XLS/CSV).
-- Fica numa tabela própria (NÃO em `lancamentos`) p/ não poluir o livro-caixa ao vivo
-- nem duplicar com o faturamento. Alimenta as views de Fluxo de Caixa (diário e
-- mensal previsto×realizado). Acesso restrito a quem tem can_finance (ou owner/admin)
-- — inclusive na RLS, então nem via PostgREST direto outro membro lê. Idempotente.

create table if not exists extrato_importado (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  -- chave de deduplicação (estável por linha do extrato): data|valor|saldo|descrição…
  import_ref      text not null,
  -- campos do extrato Conta Azul
  data_mov        date,                    -- Data movimento
  contato         text,                    -- Nome do fornecedor/cliente
  descricao       text,
  tipo            text,                    -- receita | despesa
  origem          text,                    -- Lançamento Financeiro | Venda | Transferência | ...
  conta           text,                    -- Conta bancária
  forma_pgto      text,
  valor           numeric(14,2),           -- com sinal (despesa negativa), como no extrato
  saldo_conta     numeric(14,2),           -- saldo corrido do extrato (informativo)
  situacao        text,                    -- Conciliado | Quitado | Em aberto | Atrasado | Transferido | Perdido/Desconsiderado
  valor_original  numeric(14,2),
  juros           numeric(14,2) not null default 0,
  multa           numeric(14,2) not null default 0,
  desconto        numeric(14,2) not null default 0,
  taxas           numeric(14,2) not null default 0,
  competencia     date,
  venc_original   date,
  data_prevista   date,
  observacao      text,
  nota_fiscal     text,
  categoria       text,
  centro_custo    text,
  recorrencia     text,                    -- Sem recorrência | Com recorrência
  qtd_recorrencia text,                    -- ex.: "5/14"
  imported_at     timestamptz not null default now(),
  imported_by     uuid references profiles(id),
  created_at      timestamptz not null default now()
);

create unique index if not exists uq_extrato_imp_ref on extrato_importado(org_id, import_ref);
create index if not exists idx_extrato_imp_org_data  on extrato_importado(org_id, data_mov);
create index if not exists idx_extrato_imp_prevista   on extrato_importado(org_id, data_prevista);

alter table extrato_importado enable row level security;

-- Leitura: SÓ quem tem can_finance (ou owner/admin). Mais restrito que is_org_member
-- de propósito — é dado financeiro confidencial ("só eu vejo").
drop policy if exists "Finance read extrato_imp" on extrato_importado;
create policy "Finance read extrato_imp" on extrato_importado
  for select using (
    exists (
      select 1 from organization_members om
      where om.org_id = extrato_importado.org_id
        and om.user_id = auth.uid()
        and (om.can_finance or om.role in ('owner','admin'))
    )
  );

-- Escrita só via RPC (security definer); sem policy de insert/update direto.

-- ── RPC: importa um lote de linhas do extrato ────────────────
-- p_rows: jsonb array; cada objeto com as chaves abaixo (datas em 'YYYY-MM-DD' ou null,
-- números já numéricos). Upsert por (org_id, import_ref): reimportar atualiza, não duplica.
-- Retorna { inserted, updated, total }.
create or replace function import_extrato(p_user_id uuid, p_org_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_before bigint;
  v_after  bigint;
  v_total  int;
  v_affected int;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;

  select count(*) into v_before from extrato_importado where org_id = p_org_id;

  with rows as (
    select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      import_ref text, data_mov date, contato text, descricao text, tipo text,
      origem text, conta text, forma_pgto text, valor numeric, saldo_conta numeric,
      situacao text, valor_original numeric, juros numeric, multa numeric,
      desconto numeric, taxas numeric, competencia date, venc_original date,
      data_prevista date, observacao text, nota_fiscal text, categoria text,
      centro_custo text, recorrencia text, qtd_recorrencia text
    )
  ), ins as (
    insert into extrato_importado (
      org_id, import_ref, data_mov, contato, descricao, tipo, origem, conta,
      forma_pgto, valor, saldo_conta, situacao, valor_original, juros, multa,
      desconto, taxas, competencia, venc_original, data_prevista, observacao,
      nota_fiscal, categoria, centro_custo, recorrencia, qtd_recorrencia, imported_by
    )
    select
      p_org_id, r.import_ref, r.data_mov, r.contato, r.descricao, r.tipo, r.origem,
      r.conta, r.forma_pgto, r.valor, r.saldo_conta, r.situacao, r.valor_original,
      coalesce(r.juros,0), coalesce(r.multa,0), coalesce(r.desconto,0), coalesce(r.taxas,0),
      r.competencia, r.venc_original, r.data_prevista, r.observacao, r.nota_fiscal,
      r.categoria, r.centro_custo, r.recorrencia, r.qtd_recorrencia, p_user_id
    from rows r
    where r.import_ref is not null and r.import_ref <> ''
    on conflict (org_id, import_ref) do update set
      data_mov = excluded.data_mov, contato = excluded.contato,
      descricao = excluded.descricao, tipo = excluded.tipo, origem = excluded.origem,
      conta = excluded.conta, forma_pgto = excluded.forma_pgto, valor = excluded.valor,
      saldo_conta = excluded.saldo_conta, situacao = excluded.situacao,
      valor_original = excluded.valor_original, juros = excluded.juros,
      multa = excluded.multa, desconto = excluded.desconto, taxas = excluded.taxas,
      competencia = excluded.competencia, venc_original = excluded.venc_original,
      data_prevista = excluded.data_prevista, observacao = excluded.observacao,
      nota_fiscal = excluded.nota_fiscal, categoria = excluded.categoria,
      centro_custo = excluded.centro_custo, recorrencia = excluded.recorrencia,
      qtd_recorrencia = excluded.qtd_recorrencia, imported_at = now(), imported_by = p_user_id
    returning 1
  )
  select count(*) into v_affected from ins;

  select count(*) into v_after from extrato_importado where org_id = p_org_id;
  v_total := v_affected;
  return jsonb_build_object(
    'inserted', v_after - v_before,
    'updated',  v_total - (v_after - v_before),
    'total',    v_total
  );
end; $$;

-- Limpa todo o extrato importado da org (botão "Limpar import").
create or replace function clear_extrato(p_user_id uuid, p_org_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;
  delete from extrato_importado where org_id = p_org_id;
end; $$;

grant execute on function import_extrato(uuid,uuid,jsonb) to anon, authenticated;
grant execute on function clear_extrato(uuid,uuid) to anon, authenticated;

notify pgrst, 'reload schema';
