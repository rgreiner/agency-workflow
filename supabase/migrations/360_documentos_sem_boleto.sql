-- 360 — documentos do mês sem exigir boleto (24/10/2026)
-- Até a integração com o BTG (prevista para novembro) não há boleto: o envio do
-- mês sai com a NF e o Pix copia e cola. Com boleto anexado, vai junto.
create or replace function public.fin_documentos_whatsapp(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if not fin_dia_util(p_org, fin_hoje()) or fin_hoje() < fin_primeiro_dia_util(p_org, fin_hoje()) then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(row_to_json(t) order by t.vencimento), '[]'::jsonb) into v from (
    select b.lancamento_id, b.workspace_id, b.cliente,
           b.contato->>'nome' as contato_nome, b.contato->>'telefone' as telefone,
           b.descricao, b.valor::float8 as valor, b.vencimento::text as vencimento,
           (select n.numero from nota_fiscal n where n.lancamento_id = b.lancamento_id and n.status = 'autorizada' limit 1) as nf_numero,
           b.anexos
      from _fin_receber_whats(p_org) b
     where b.vencimento >= date_trunc('month', fin_hoje())::date
       and b.vencimento < (date_trunc('month', fin_hoje()) + interval '1 month')::date
       and exists (select 1 from jsonb_array_elements(b.anexos) x where x->>'tipo' = 'NF' and coalesce(x->>'url', '') <> '')
       and not exists (select 1 from cobranca_avisos ca where ca.lancamento_id = b.lancamento_id and ca.bucket = 'documentos')
  ) t;
  return v;
end $$;
revoke execute on function public.fin_documentos_whatsapp(uuid) from public, anon;
grant execute on function public.fin_documentos_whatsapp(uuid) to authenticated;

notify pgrst, 'reload schema';
