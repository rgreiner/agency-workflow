-- ── A cobrança leva o boleto junto ──────────────────────────────────────────
--
-- 01/10/2026. O e-mail da régua passa a anexar o boleto do título cobrado, e
-- para achá-lo o job precisa do `org_id` — que o payload calculava no CTE `cfg`
-- e descartava antes de devolver.
--
-- Só isso muda aqui: nenhuma regra de QUEM cobrar foi tocada. As travas
-- continuam onde estavam (régua desligada, payment_info vazio, cliente sem
-- opt-in, promessa em dia, degrau já enviado).

CREATE OR REPLACE FUNCTION public.cobranca_payload()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      select l.id, c.org_id, c.org_slug, c.org_name, c.payment_info, c.regua,
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
           -- org_id é o que o job usa para achar o boleto do lançamento e
           -- mandá-lo anexo; sem ele a cobrança sai sem o documento de pagar.
           e.org_id, e.org_slug, e.org_name, e.cliente, e.email, e.descricao,
           e.falta::float8 as valor, e.vencimento::text as vencimento,
           e.atraso as dias, e.payment_info
      from escolha e
     where e.passo is not null
       and not exists (
         select 1 from cobranca_avisos ca
          where ca.lancamento_id = e.id and ca.canal <> 'manual' and ca.bucket = fin_bucket(e.passo))
  ) t;
  return v;
end $function$

;


-- ⚠️ DEFAULT PRIVILEGES: `create or replace` reabre a função para anon.
revoke execute on function cobranca_payload() from public, anon;

notify pgrst, 'reload schema';
