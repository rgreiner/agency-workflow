-- 395 — "Como pagar" no lançamento, para a tela Financeiro → Hoje (30/10/2026)
--
-- A tela do dia lista o que sai hoje com o código ao lado: linha digitável do
-- boleto, Pix copia-e-cola ou a chave Pix. Medido em produção: o cadastro não tem
-- isso (12 de 415 fornecedores com conta, todos com o campo pix vazio; colaborador
-- não tem dado bancário) e o anexo "Boleto" é só o PDF — o número dele é o do
-- documento, não a linha digitável. Então o código mora no próprio lançamento:
--   • boleto: a tela lê o PDF anexado e grava a linha digitável sozinha;
--   • Pix: quem paga cola uma vez; no mês seguinte a tela sugere o último código
--     usado para o mesmo contato (salário, aluguel, fornecedor recorrente).

alter table lancamentos add column if not exists pagar_com text;

comment on column lancamentos.pagar_com is
  'Como pagar: linha digitável do boleto, Pix copia-e-cola ou chave Pix. Preenchido na tela Financeiro → Hoje.';

-- Grava só este campo. Escrita de lançamento é sempre por RPC (sem policy de
-- UPDATE); fin_can confere o usuário pelo auth.uid() — sem p_user_id para não
-- reabrir o bypass da auditoria de 22/07.
create or replace function set_lancamento_pagar_com(p_lancamento_id uuid, p_pagar_com text)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from lancamentos where id = p_lancamento_id;
  if v_org is null or not fin_can(v_org) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  update lancamentos
     set pagar_com = nullif(btrim(coalesce(p_pagar_com, '')), ''), updated_at = now()
   where id = p_lancamento_id;
end $$;

revoke execute on function set_lancamento_pagar_com(uuid, text) from public, anon;
grant execute on function set_lancamento_pagar_com(uuid, text) to authenticated;

notify pgrst, 'reload schema';
