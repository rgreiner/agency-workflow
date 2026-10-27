-- 376 — 1ª cobrança da comissão em atraso no 3º dia depois do vencimento (27/10/2026)
--
-- Regra da casa (Rafael, 27/10): o BTG leva 1 dia para compensar boleto; avisa-se o
-- vencimento no dia, mas atraso só se cobra a partir do 3º dia — igual à régua do
-- cliente (passos -3, 0, 3, 7…). Substitui os "2 dias úteis" da 375. Degraus 2 e 3
-- seguem a 5 úteis do anterior.

create or replace function public.fin_regua_comissao(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_hoje date := fin_hoje(); v_cobrar jsonb; v_esgotadas jsonb;
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  with base as (
    select l.id, coalesce(f.name, ve.name, l.contato_nome) as fornecedor,
           _fin_contato_cadastro(coalesce(f.emails, ve.emails), coalesce(f.telefones, ve.telefones)) as contato,
           nullif(btrim(coalesce(d.doc_serie, '') || ' ' || coalesce(d.doc_numero::text, '')), '') as documento,
           round(l.valor - coalesce(l.valor_realizado, 0), 2)::float8 as valor, l.vencimento,
           (select count(*) from cobranca_avisos ca where ca.lancamento_id = l.id and ca.bucket like 'comissao\_cob\_%') as feitos,
           (select max(sent_at) from cobranca_avisos ca where ca.lancamento_id = l.id and ca.bucket like 'comissao\_cob\_%') as ultimo
      from lancamentos l
      join lancamentos_doc d on d.id = l.id
      left join fornecedores f on l.contato_tipo = 'fornecedor' and f.id = l.contato_id
      left join veiculos ve    on l.contato_tipo = 'veiculo'    and ve.id = l.contato_id
     where l.org_id = p_org and l.tipo = 'entrada' and l.situacao = 'em_aberto'
       and l.origem_tipo in ('producao', 'midia') and l.contato_tipo in ('fornecedor', 'veiculo')
       and l.vencimento < v_hoje
       and round(l.valor - coalesce(l.valor_realizado, 0), 2) > 0
       and (l.promessa_data is null or l.promessa_data < v_hoje)
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('titulo_id', b.id, 'documento', b.documento, 'fornecedor', b.fornecedor,
                'contato_nome', b.contato->>'nome', 'email', b.contato->>'email', 'valor', b.valor,
                'vencimento', b.vencimento, 'dias', v_hoje - b.vencimento, 'bucket', 'comissao_cob_' || (b.feitos + 1))
                order by b.vencimento)
       from base b
      where fin_dia_util(p_org, v_hoje) and b.contato->>'email' is not null and b.feitos < 3
        and case when b.feitos = 0 then v_hoje - b.vencimento >= 3
                 else fin_dias_uteis_entre(p_org, (b.ultimo at time zone 'America/Sao_Paulo')::date, v_hoje) >= 5 end), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('titulo_id', b.id, 'documento', b.documento, 'fornecedor', b.fornecedor,
                'valor', b.valor, 'vencimento', b.vencimento, 'dias', v_hoje - b.vencimento,
                'motivo', case when b.contato->>'email' is null then 'sem e-mail no cadastro' else '3 cobranças sem pagamento' end)
                order by b.vencimento)
       from base b
      where b.feitos >= 3 or b.contato->>'email' is null), '[]'::jsonb)
    into v_cobrar, v_esgotadas;

  return jsonb_build_object('a_cobrar', v_cobrar, 'com_rafael', v_esgotadas);
end $$;
revoke execute on function public.fin_regua_comissao(uuid) from public, anon;
grant execute on function public.fin_regua_comissao(uuid) to authenticated;

notify pgrst, 'reload schema';
