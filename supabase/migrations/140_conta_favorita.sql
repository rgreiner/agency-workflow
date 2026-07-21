-- 140_conta_favorita.sql
-- Estrela de "conta favorita": a favorita vira a conta a receber padrão do
-- Faturamento (sem nome de banco hard-coded — pensando em multi-org/SaaS).
-- No máximo uma favorita por org (índice único parcial). Idempotente.

alter table contas_financeiras add column if not exists favorita boolean not null default false;

create unique index if not exists contas_financeiras_uma_favorita
  on contas_financeiras (org_id) where favorita;

-- A view do saldo passa a expor `favorita` (coluna nova no FIM — requisito do
-- create or replace view). A tela de contas e o Faturamento leem daqui.
create or replace view contas_saldo as
 SELECT id, org_id, nome, tipo, cor, ativo, ordem, saldo_inicial, saldo_banco, saldo_banco_data,
    round(saldo_inicial + COALESCE(( SELECT sum(e.valor) AS sum
           FROM extrato_importado e
          WHERE e.org_id = c.org_id AND e.conta = c.nome AND (e.situacao = ANY (ARRAY['Conciliado'::text, 'Quitado'::text, 'Transferido'::text]))), 0::numeric) + COALESCE(( SELECT sum(
                CASE
                    WHEN l.tipo = 'saida'::text THEN - COALESCE(l.valor_realizado, l.valor)
                    ELSE COALESCE(l.valor_realizado, l.valor)
                END) AS sum
           FROM lancamentos l
          WHERE l.org_id = c.org_id AND l.conta_id = c.id AND (l.situacao = ANY (ARRAY['pago'::text, 'recebido'::text])) AND (l.origem_ref IS NULL OR NOT (EXISTS ( SELECT 1
                   FROM extrato_importado e
                  WHERE e.org_id = l.org_id AND e.import_ref = l.origem_ref AND (e.situacao = ANY (ARRAY['Conciliado'::text, 'Quitado'::text, 'Transferido'::text])))))), 0::numeric), 2) AS saldo_atual,
    c.favorita
   FROM contas_financeiras c;

-- Toggle: clicar na estrela marca/desmarca. Ao marcar, tira a estrela das outras
-- (só uma favorita por org). org_settings continua sem entrar nisso.
create or replace function set_conta_favorita(p_user_id uuid, p_conta_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid; v_fav boolean;
begin
  select org_id, favorita into v_org, v_fav from contas_financeiras where id = p_conta_id;
  if v_org is null then raise exception 'Conta não encontrada'; end if;
  if not exists (
    select 1 from organization_members
    where org_id = v_org and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  if v_fav then
    update contas_financeiras set favorita = false where id = p_conta_id;
  else
    update contas_financeiras set favorita = false where org_id = v_org and favorita;
    update contas_financeiras set favorita = true  where id = p_conta_id;
  end if;
end; $$;

grant execute on function set_conta_favorita(uuid,uuid) to anon, authenticated;

notify pgrst, 'reload schema';
