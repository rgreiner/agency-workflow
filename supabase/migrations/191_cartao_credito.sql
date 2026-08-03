-- 191_cartao_credito.sql
-- Auditoria 02/08, Financeiro #4: "Cartão de crédito não existe no modelo".
-- O Rafael confirmou em 03/08 que há cartão corporativo em uso, então sai da
-- gaveta.
--
-- Modelo escolhido: o cartão é uma CONTA (tipo 'cartao') com ciclo de fatura.
-- As compras são lançamentos de saída nessa conta — cada uma com sua categoria e
-- centro de custo, que é o que o DRE precisa. Pagar a fatura é uma
-- TRANSFERÊNCIA banco → cartão (zero-soma, já modelada na 131): o dinheiro sai
-- do banco uma vez só e a dívida do cartão zera. A alternativa — um lançamento
-- "fatura" agregando as compras — contaria a despesa duas vezes.
--
-- Duas datas convivem na compra: `data_compra` (quando aconteceu, é o que define
-- em qual fatura ela cai) e `vencimento` (quando o dinheiro sai de verdade = o
-- vencimento da fatura). O trigger abaixo calcula a segunda a partir da primeira,
-- então Fluxo de caixa, "A pagar" e Inadimplentes já mostram a data certa sem
-- saber que existe cartão.
--
-- Idempotente.

alter table contas_financeiras add column if not exists fechamento_dia int;
alter table contas_financeiras add column if not exists vencimento_dia int;
alter table contas_financeiras add column if not exists limite numeric(14,2);
alter table lancamentos        add column if not exists data_compra date;

-- ── Ciclo da fatura ─────────────────────────────────────────────────────────
-- Compra até o dia do fechamento entra na fatura que fecha neste mês; depois
-- dele, na do mês seguinte. O vencimento cai no mesmo mês do fechamento quando
-- o dia de vencer é depois do de fechar; senão, no mês seguinte.
-- `least(dia, dias_do_mes)` resolve fechamento dia 30 em fevereiro.
create or replace function cartao_ciclo(p_compra date, p_fech int, p_venc int)
returns table (fecha date, vence date) language plpgsql immutable as $$
declare v_fech_mes date; v_dia int; v_base date;
begin
  if p_compra is null or p_fech is null or p_venc is null then
    return query select null::date, null::date; return;
  end if;
  v_base := date_trunc('month', p_compra)::date;
  v_dia  := least(p_fech, extract(day from (v_base + interval '1 month - 1 day'))::int);
  v_fech_mes := v_base + (v_dia - 1);
  if p_compra > v_fech_mes then
    v_base := (v_base + interval '1 month')::date;
    v_dia  := least(p_fech, extract(day from (v_base + interval '1 month - 1 day'))::int);
    v_fech_mes := v_base + (v_dia - 1);
  end if;

  if p_venc > p_fech then
    v_base := date_trunc('month', v_fech_mes)::date;
  else
    v_base := (date_trunc('month', v_fech_mes) + interval '1 month')::date;
  end if;
  v_dia := least(p_venc, extract(day from (v_base + interval '1 month - 1 day'))::int);
  return query select v_fech_mes, (v_base + (v_dia - 1))::date;
end $$;

-- Compra no cartão: guarda a data real e joga o vencimento pro da fatura.
create or replace function _lanc_cartao_vencimento() returns trigger
language plpgsql set search_path = public as $$
declare c record; v record;
begin
  if new.conta_id is null or new.tipo <> 'saida' then return new; end if;
  select tipo, fechamento_dia, vencimento_dia into c from contas_financeiras where id = new.conta_id;
  if c.tipo is distinct from 'cartao' or c.fechamento_dia is null or c.vencimento_dia is null then
    return new;
  end if;
  -- Transferência é o PAGAMENTO da fatura, não uma compra — não reprograma.
  if new.origem_tipo = 'transferencia' then return new; end if;

  new.data_compra := coalesce(new.data_compra, new.vencimento, current_date);
  select * into v from cartao_ciclo(new.data_compra, c.fechamento_dia, c.vencimento_dia);
  if v.vence is not null then new.vencimento := v.vence; end if;
  return new;
end $$;
drop trigger if exists trg_lanc_cartao on lancamentos;
create trigger trg_lanc_cartao before insert or update of conta_id, data_compra, vencimento
  on lancamentos for each row execute function _lanc_cartao_vencimento();

-- ── Faturas abertas ─────────────────────────────────────────────────────────
-- Uma linha por (cartão, fatura). Só o que ainda não foi pago — fatura paga sai
-- da lista, o histórico fica nos próprios lançamentos.
create or replace view cartao_faturas
with (security_invoker = true) as
  select c.org_id, c.id as conta_id, c.nome as conta_nome, c.cor, c.limite,
         l.vencimento as vence,
         min(l.data_compra) as primeira_compra,
         max(l.data_compra) as ultima_compra,
         count(*)::int as compras,
         round(sum(l.valor - coalesce(l.valor_realizado, 0)), 2) as total
    from contas_financeiras c
    join lancamentos l on l.conta_id = c.id and l.org_id = c.org_id
   where c.tipo = 'cartao' and l.tipo = 'saida' and l.situacao = 'em_aberto'
     and coalesce(l.origem_tipo, '') <> 'transferencia'
   group by c.org_id, c.id, c.nome, c.cor, c.limite, l.vencimento;

-- ── Pagar a fatura ──────────────────────────────────────────────────────────
-- Liquida as compras do ciclo NO CARTÃO e move o dinheiro do banco pro cartão
-- numa transferência. Depois disso o saldo do cartão volta a zero e o banco
-- registra uma saída só — que é o que o extrato bancário vai mostrar.
create or replace function pagar_fatura_cartao(
  p_user_id uuid, p_conta_id uuid, p_vence date, p_conta_pagamento_id uuid, p_data date
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_total numeric; v_n int; v_data date := coalesce(p_data, current_date);
  v_nome text; v_tid uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select org_id, nome into v_org, v_nome from contas_financeiras where id = p_conta_id and tipo = 'cartao';
  if v_org is null then raise exception 'Cartão não encontrado'; end if;
  if not fin_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_conta_pagamento_id = p_conta_id then raise exception 'Escolha a conta de onde o dinheiro sai'; end if;
  if not exists (select 1 from contas_financeiras where id = p_conta_pagamento_id and org_id = v_org) then
    raise exception 'Conta de pagamento não encontrada';
  end if;

  select coalesce(sum(valor - coalesce(valor_realizado, 0)), 0), count(*)
    into v_total, v_n
    from lancamentos
   where org_id = v_org and conta_id = p_conta_id and tipo = 'saida'
     and situacao = 'em_aberto' and vencimento = p_vence
     and coalesce(origem_tipo, '') <> 'transferencia';
  if v_n = 0 then raise exception 'Nenhuma compra em aberto nesta fatura'; end if;

  update lancamentos set
    situacao = 'pago',
    valor_realizado = valor,
    data_liquidacao = v_data,
    updated_at = now()
  where org_id = v_org and conta_id = p_conta_id and tipo = 'saida'
    and situacao = 'em_aberto' and vencimento = p_vence
    and coalesce(origem_tipo, '') <> 'transferencia';

  -- O pagamento em si: dinheiro sai do banco e "entra" no cartão, quitando a
  -- dívida. Zero-soma, então não polui DRE nem gráfico (categoria Transferência).
  v_tid := criar_transferencia(p_user_id, v_org, jsonb_build_object(
    'conta_origem_id', p_conta_pagamento_id,
    'conta_destino_id', p_conta_id,
    'valor', v_total,
    'data', v_data,
    'descricao', 'Fatura ' || v_nome || ' — venc. ' || to_char(p_vence, 'DD/MM/YYYY')
  ));

  return jsonb_build_object('compras', v_n, 'total', v_total, 'transferencia_id', v_tid);
end $$;

-- ── Cadastro da conta: os campos do ciclo ───────────────────────────────────
create or replace function create_conta_financeira(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  insert into contas_financeiras (
    org_id, nome, tipo, saldo_inicial, cor, ativo, ordem, created_by,
    fechamento_dia, vencimento_dia, limite
  ) values (
    p_org_id,
    coalesce(nullif(p_data->>'nome',''), 'Conta'),
    coalesce(nullif(p_data->>'tipo',''), 'banco'),
    coalesce(nullif(p_data->>'saldo_inicial','')::numeric, 0),
    nullif(p_data->>'cor',''),
    coalesce((p_data->>'ativo')::boolean, true),
    coalesce(nullif(p_data->>'ordem','')::int, 0),
    p_user_id,
    nullif(p_data->>'fechamento_dia','')::int,
    nullif(p_data->>'vencimento_dia','')::int,
    nullif(p_data->>'limite','')::numeric
  ) returning id into v_id;
  return v_id;
end $$;

create or replace function update_conta_financeira(p_user_id uuid, p_conta_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from contas_financeiras c
    join organization_members om on om.org_id = c.org_id
    where c.id = p_conta_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  update contas_financeiras set
    nome           = coalesce(nullif(p_data->>'nome',''), nome),
    tipo           = coalesce(nullif(p_data->>'tipo',''), tipo),
    saldo_inicial  = coalesce(nullif(p_data->>'saldo_inicial','')::numeric, saldo_inicial),
    cor            = case when p_data ? 'cor' then nullif(p_data->>'cor','') else cor end,
    ativo          = coalesce((p_data->>'ativo')::boolean, ativo),
    ordem          = coalesce(nullif(p_data->>'ordem','')::int, ordem),
    fechamento_dia = case when p_data ? 'fechamento_dia' then nullif(p_data->>'fechamento_dia','')::int else fechamento_dia end,
    vencimento_dia = case when p_data ? 'vencimento_dia' then nullif(p_data->>'vencimento_dia','')::int else vencimento_dia end,
    limite         = case when p_data ? 'limite' then nullif(p_data->>'limite','')::numeric else limite end,
    updated_at     = now()
  where id = p_conta_id;
end $$;

revoke execute on function pagar_fatura_cartao(uuid, uuid, date, uuid, date) from public, anon;
grant  execute on function pagar_fatura_cartao(uuid, uuid, date, uuid, date) to authenticated;
grant  execute on function cartao_ciclo(date, int, int)                      to authenticated;
grant  select  on cartao_faturas                                             to authenticated;
revoke all     on cartao_faturas                                             from anon;

notify pgrst, 'reload schema';
