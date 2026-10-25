-- 362 — Flávia anexa NF/boleto que o fornecedor mandou por e-mail (com o Sim do Rafael)
--
-- set_lancamento_anexos exige gestor e troca a lista inteira. Aqui é só ACRESCENTAR
-- um documento do FORNECEDOR (NF ou boleto) num título de comissão de PP/MX —
-- nunca remove nem altera o que já está anexado. Mês fechado continua barrado
-- pelo trg_lanc_mes_fechado.

create or replace function public.fin_documentos_fornecedor(p_org uuid, p_contato_tipo text, p_contato_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_contato_tipo not in ('fornecedor', 'veiculo') then raise exception 'Contato inválido'; end if;
  select coalesce(jsonb_agg(row_to_json(t) order by t.vencimento), '[]'::jsonb) into v from (
    select l.id as lancamento_id,
           nullif(btrim(coalesce(d.doc_serie, '') || ' ' || coalesce(d.doc_numero::text, '')), '') as documento,
           coalesce(nullif(l.descricao, ''), 'Comissão') as descricao, l.valor::float8 as valor, l.vencimento::text as vencimento,
           exists (select 1 from jsonb_array_elements(l.anexos) x where x->>'tipo' = 'NF' and x->>'emitente' = 'fornecedor') as tem_nf,
           exists (select 1 from jsonb_array_elements(l.anexos) x where x->>'tipo' = 'Boleto' and x->>'emitente' = 'fornecedor') as tem_boleto,
           (select string_agg(x->>'numero', ',') from jsonb_array_elements(l.anexos) x where x->>'emitente' = 'fornecedor' and coalesce(x->>'numero', '') <> '') as numeros
      from lancamentos l join lancamentos_doc d on d.id = l.id
     where l.org_id = p_org and l.contato_tipo = p_contato_tipo and l.contato_id = p_contato_id
       and l.origem_tipo in ('producao', 'midia') and l.situacao = 'em_aberto'
  ) t;
  return v;
end $$;
revoke execute on function public.fin_documentos_fornecedor(uuid, text, uuid) from public, anon;
grant execute on function public.fin_documentos_fornecedor(uuid, text, uuid) to authenticated;

create or replace function public.fin_anexar_documento_fornecedor(p_lancamento_id uuid, p_anexo jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare l lancamentos%rowtype;
begin
  select * into l from lancamentos where id = p_lancamento_id for update;
  if not found or not fin_can(l.org_id) then raise exception 'Título não encontrado'; end if;
  if l.origem_tipo not in ('producao', 'midia') or l.contato_tipo not in ('fornecedor', 'veiculo') then
    raise exception 'Só títulos de PP/MX de fornecedor ou veículo';
  end if;
  if coalesce(p_anexo->>'tipo', '') not in ('NF', 'Boleto') or coalesce(p_anexo->>'url', '') !~ '^https://[^ ]+/uploads/lancamentos/[\w.-]+$' then
    raise exception 'Documento inválido';
  end if;
  if exists (select 1 from jsonb_array_elements(l.anexos) x where x->>'url' = p_anexo->>'url') then
    return jsonb_build_object('ok', true, 'repetido', true);
  end if;
  update lancamentos
     set anexos = anexos || jsonb_build_array(jsonb_build_object(
           'url', p_anexo->>'url', 'nome', left(coalesce(p_anexo->>'nome', 'documento.pdf'), 200),
           'tipo', p_anexo->>'tipo', 'numero', left(coalesce(p_anexo->>'numero', ''), 40), 'emitente', 'fornecedor')),
         updated_at = now()
   where id = l.id;
  insert into lancamento_historico (org_id, lancamento_id, tipo, texto, por)
  values (l.org_id, l.id, 'nota',
          format('%s %s do fornecedor anexada (recebida por e-mail)', p_anexo->>'tipo', coalesce(nullif(p_anexo->>'numero', ''), 's/ nº')),
          auth.uid());
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.fin_anexar_documento_fornecedor(uuid, jsonb) from public, anon;
grant execute on function public.fin_anexar_documento_fornecedor(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
