-- 192_fin_fluxo_agregado.sql
-- Auditoria 02/08, Financeiro #5: "Telas financeiras carregam as ~7 mil linhas do
-- extrato a cada request". Na auditoria eu disse que isso sumiria junto com a
-- correção da fonte congelada (185) — não sumiu: a `fin_movimentos` PRECISA do
-- histórico do extrato pra não perder três anos de caixa, e o Fluxo de caixa
-- seguia paginando 6.859 linhas em 7 requisições a cada abertura de tela.
--
-- A tela não precisa das linhas: precisa de SOMAS por dia, por conta e por
-- natureza — o filtro de conta e a troca de mês/ano continuam no cliente, então
-- a agregação tem que preservar (data, conta, tipo, situação, transferência).
--
-- Medido em produção: 6.859 linhas → 1.875 grupos (3,7×, e 7 requisições viram 2).
-- O ganho maior vem de zerar `data_prevista` no realizado: ela só é lida nas
-- linhas previstas (lib/fluxo-caixa.ts, dataPrev()), e mantê-la no realizado
-- inflava a chave de grupo sozinha — 2.808 grupos contra os 1.875 de agora.
--
-- Idempotente.

-- SECURITY DEFINER passando por cima de `fin_movimentos`: a view é
-- security_invoker, mas dentro de uma função definer o "invoker" é o dono
-- (postgres), então a RLS das tabelas de baixo NÃO é avaliada. O guard aqui é a
-- única barreira — e ele LEVANTA em vez de devolver vazio: gráfico em branco num
-- painel de caixa lê-se como "não tem nada", que é uma decisão errada.
create or replace function fin_fluxo_agregado(p_org uuid)
returns table (
  data_mov date, data_prevista date, tipo text, situacao text,
  conta text, transferencia boolean, valor numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (fin_can(p_org) or is_psql_direto()) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  return query
    select m.data_mov,
           -- Só o previsto usa a data de vencimento; no realizado quem manda é a
           -- data do movimento. Nulo aqui = grupo menor, sem perder informação.
           case when m.situacao = 'previsto' then coalesce(m.data_prevista, m.data_mov) end,
           m.tipo, m.situacao, m.conta, m.transferencia,
           round(sum(abs(coalesce(m.valor, 0))), 2)
      from fin_movimentos m
     where m.org_id = p_org
     group by 1, 2, 3, 4, 5, 6;
end $$;

revoke execute on function fin_fluxo_agregado(uuid) from public, anon;
grant  execute on function fin_fluxo_agregado(uuid) to authenticated;

notify pgrst, 'reload schema';
