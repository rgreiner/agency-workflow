-- Fechar o mês: conferir com o banco antes de enviar, e travar depois.
--
-- O pacote de agosto/2026 foi enviado ao contador em 02/09 com R$ 12 mil de
-- diferença no BTG dentro (conciliação parcial, achada em 14/10). Duas regras:
--
--  1. CONFERÊNCIA: o envio só sai se, em cada conta com OFX, o saldo do Flow no
--     último dia do mês bate com o do banco e não há movimento do mês na fila.
--  2. TRAVA: mês enviado fica fechado. Lançamento PAGO/RECEBIDO naquele mês não
--     muda no que é dinheiro (valor, data, conta, categoria…), não nasce e não
--     some. Anexo, NF, observação seguem livres — juntar a nota depois é rotina.
--     Para corrigir: "Reabrir para corrigir" no Fechamento; o reenvio trava de novo.
--     Escape para correção de banco por SSH: `set local fin.ignora_fechamento = '1'`.
--
-- E fecha um buraco achado no caminho: marcar_fechamento_enviado era chamável
-- por anon e não conferia auth.uid() — dava para marcar mês de outra org.

alter table fechamento_contabil add column if not exists reaberto_em timestamptz;
alter table fechamento_contabil add column if not exists reaberto_por uuid references profiles(id) on delete set null;

-- Mês fechado = já enviado e não reaberto.
create or replace function fin_mes_fechado(p_org uuid, p_data date)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_data is not null and exists (
    select 1 from fechamento_contabil f
     where f.org_id = p_org and f.competencia = to_char(p_data, 'YYYY-MM')
       and f.enviado_em is not null and f.status <> 'reaberto');
$$;
revoke execute on function fin_mes_fechado(uuid, date) from public, anon, authenticated;

create or replace function trg_lanc_mes_fechado()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_old date; v_new date; v_mes text;
begin
  if current_setting('fin.ignora_fechamento', true) = '1' then
    return coalesce(new, old);
  end if;
  if tg_op <> 'INSERT' and old.situacao in ('pago','recebido') then v_old := coalesce(old.data_liquidacao, old.vencimento); end if;
  if tg_op <> 'DELETE' and new.situacao in ('pago','recebido') then v_new := coalesce(new.data_liquidacao, new.vencimento); end if;

  if tg_op = 'UPDATE' and not (
       old.tipo is distinct from new.tipo or old.valor is distinct from new.valor
    or old.valor_realizado is distinct from new.valor_realizado or old.data_liquidacao is distinct from new.data_liquidacao
    or old.situacao is distinct from new.situacao or old.conta_id is distinct from new.conta_id
    or old.categoria is distinct from new.categoria or old.centro_custo is distinct from new.centro_custo
    or old.juros is distinct from new.juros or old.multa is distinct from new.multa
    or old.desconto is distinct from new.desconto or old.tarifa is distinct from new.tarifa
    or old.transferencia_id is distinct from new.transferencia_id
  ) then
    return new;   -- só anexo/NF/observação/flags: livre
  end if;

  if fin_mes_fechado(coalesce(new.org_id, old.org_id), v_old) then v_mes := to_char(v_old, 'MM/YYYY');
  elsif fin_mes_fechado(coalesce(new.org_id, old.org_id), v_new) then v_mes := to_char(v_new, 'MM/YYYY');
  end if;
  if v_mes is not null then
    raise exception 'O mês % já foi enviado à contabilidade e está fechado. Para corrigir, use "Reabrir para corrigir" em Financeiro → Fechamento.', v_mes
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_lanc_mes_fechado on lancamentos;
create trigger trg_lanc_mes_fechado
  before insert or update or delete on lancamentos
  for each row execute function trg_lanc_mes_fechado();

-- Conferência do mês: banco × Flow no último dia, por conta com OFX.
create or replace function fin_conferencia_mes(p_org uuid, p_competencia text)
returns table (conta_id uuid, conta text, saldo_flow numeric, saldo_banco numeric, pendentes int, ok boolean, motivo text)
language plpgsql stable security definer set search_path = public as $$
declare v_fim date := (to_date(p_competencia || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date;
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return query
  with base as (
    select c.id, c.nome, c.saldo_banco, c.saldo_banco_data,
           fin_saldo_em(c.id, v_fim) as flow,
           (select count(*)::int from btg_movements b where b.conta_id = c.id and b.status = 'pendente' and b.data_mov <= v_fim) as pend,
           case when c.saldo_banco_data >= v_fim then
             c.saldo_banco - coalesce((select sum(case when b.tipo = 'debit' then -abs(b.valor) else abs(b.valor) end)
                                         from btg_movements b
                                        where b.conta_id = c.id and b.data_mov > v_fim and b.data_mov <= c.saldo_banco_data), 0)
           end as banco
      from contas_financeiras c
     where c.org_id = p_org and coalesce(c.ativo, true)
       and exists (select 1 from btg_movements b where b.conta_id = c.id and b.data_mov <= v_fim)
  )
  select b.id, b.nome, b.flow, round(b.banco, 2), b.pend,
         (b.banco is not null and b.pend = 0 and abs(b.flow - b.banco) < 0.005),
         case
           when b.banco is null then format('OFX importado só até %s — importe até %s', coalesce(to_char(b.saldo_banco_data, 'DD/MM'), '—'), to_char(v_fim, 'DD/MM'))
           when b.pend > 0 then format('%s movimento(s) do mês esperando conciliação', b.pend)
           when abs(b.flow - b.banco) >= 0.005 then format('Flow %s em %s: R$ %s',
                  case when b.flow > b.banco then 'acima do banco' else 'abaixo do banco' end,
                  to_char(v_fim, 'DD/MM'), to_char(abs(b.flow - b.banco), 'FM999G999G990D00'))
         end
    from base b order by b.nome;
end $$;
revoke execute on function fin_conferencia_mes(uuid, text) from public, anon;
grant execute on function fin_conferencia_mes(uuid, text) to authenticated;

-- Reabrir para corrigir.
create or replace function reabrir_fechamento(p_user_id uuid, p_org_id uuid, p_competencia text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is distinct from auth.uid() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if not exists (select 1 from organization_members om where om.org_id = p_org_id and om.user_id = p_user_id
      and om.arquivado = false and (om.can_finance or om.role in ('owner','admin'))) then
    raise exception 'Acesso negado';
  end if;
  update fechamento_contabil set status = 'reaberto', reaberto_em = now(), reaberto_por = p_user_id
   where org_id = p_org_id and competencia = p_competencia and enviado_em is not null;
  if not found then raise exception 'Este mês ainda não foi enviado — não há o que reabrir.'; end if;
end $$;
revoke execute on function reabrir_fechamento(uuid, uuid, text) from public, anon;
grant execute on function reabrir_fechamento(uuid, uuid, text) to authenticated;

-- marcar_fechamento_enviado: mesma lógica, + guarda de identidade.
create or replace function marcar_fechamento_enviado(
  p_org_id uuid, p_competencia text, p_user_id uuid,
  p_destinatarios text[] default null, p_erro text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is distinct from auth.uid() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if not exists (
    select 1 from organization_members om
    where om.org_id = p_org_id and om.user_id = p_user_id
      and (om.can_finance or om.role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;

  if p_erro is not null then
    update fechamento_contabil
       set status = 'erro', erro = p_erro
     where org_id = p_org_id and competencia = p_competencia;
  else
    update fechamento_contabil
       set status = 'enviado', erro = null,
           confirmado_por = p_user_id, confirmado_em = now(), enviado_em = now(),
           destinatarios = p_destinatarios,
           envios = envios + 1
     where org_id = p_org_id and competencia = p_competencia;
  end if;
end $$;
revoke execute on function marcar_fechamento_enviado(uuid, text, uuid, text[], text) from public, anon;
grant execute on function marcar_fechamento_enviado(uuid, text, uuid, text[], text) to authenticated;

notify pgrst, 'reload schema';
