-- 234_cobranca_so_cobra_quem_deve.sql
-- A régua cobrava pelo `workspace_id` do lançamento — e esse campo, num título vindo
-- de produção/mídia, é o cliente do JOB, ou seja, CENTRO DE CUSTO. Não é quem paga.
--
-- Caso real (12/08/2026): comissão de R$ 191 da PP 1905, contato "Positiva",
-- workspace "Comil". A tela de inadimplentes mostrava a dívida no nome da Comil, e a
-- régua, no dia em que fosse ligada, mandaria a cobrança para
-- marketing.talita@grupomascarello.com.br — cobrando o cliente por uma dívida do
-- fornecedor. Hoje isso não aconteceu só porque os três portões estão fechados
-- (cobranca_ativa = false, payment_info vazio, nenhum cliente com opt-in).
--
-- Passa a exigir que o pagador SEJA o cliente: ou o nome do contato bate com o nome
-- do cliente, ou existe um alias explícito ligando aquela grafia a ele
-- (cliente_aliases, o mesmo vínculo que o botão "Vincular cliente" cria). Título de
-- comissão a receber de fornecedor sai da régua e continua visível na tela, onde a
-- cobrança é manual e consciente.
--
-- Assinatura e demais regras idênticas. Idempotente.

create or replace function cobranca_payload()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not (is_cron() or is_psql_direto()) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v from (
    with cfg as (
      select o.id as org_id, o.slug as org_slug, o.name as org_name,
             coalesce(os.payment_info, '') as payment_info,
             coalesce(os.cobranca_ativa, false) as ativa,
             coalesce(os.cobranca_regua, fin_regua_default()) as regua
        from organizations o
        left join org_settings os on os.org_id = o.id
    ),
    base as (
      select l.id, c.org_slug, c.org_name, c.payment_info, c.regua,
             w.name as cliente, w.finance_email as email,
             coalesce(nullif(l.descricao, ''), 'Cobrança') as descricao,
             round(l.valor - coalesce(l.valor_realizado, 0), 2) as falta,
             l.vencimento, (current_date - l.vencimento) as atraso
        from lancamentos l
        join cfg c        on c.org_id = l.org_id
        join workspaces w on w.id = l.workspace_id
       where l.tipo = 'entrada' and l.situacao = 'em_aberto'
         and c.ativa and c.payment_info <> ''
         and w.cobranca_auto and coalesce(w.finance_email, '') <> ''
         and l.vencimento is not null
         and round(l.valor - coalesce(l.valor_realizado, 0), 2) > 0
         and (l.promessa_data is null or l.promessa_data < current_date)
         -- Quem paga tem que ser o cliente: mesmo nome, ou alias explícito.
         and (
           fin_norm_nome(l.contato_nome) = fin_norm_nome(w.name)
           or exists (
             select 1 from cliente_aliases a
              where a.org_id = l.org_id
                and a.workspace_id = w.id
                and a.alias = fin_norm_nome(l.contato_nome))
         )
    ),
    escolha as (
      select b.*, (select max(x::int) from jsonb_array_elements_text(b.regua) x where x::int <= b.atraso) as passo
        from base b
    )
    select e.id as lancamento_id, fin_bucket(e.passo) as bucket,
           e.org_slug, e.org_name, e.cliente, e.email, e.descricao,
           e.falta::float8 as valor, e.vencimento::text as vencimento,
           e.atraso as dias, e.payment_info
      from escolha e
     where e.passo is not null
       and not exists (
         select 1 from cobranca_avisos ca
          where ca.lancamento_id = e.id and ca.canal <> 'manual' and ca.bucket = fin_bucket(e.passo))
  ) t;
  return v;
end $$;

notify pgrst, 'reload schema';
