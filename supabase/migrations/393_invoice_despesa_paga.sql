-- 393 — invoice como documento da despesa e despesa já paga recebendo documento (29/10/2026)
--
-- Software se paga no cartão e vem com INVOICE (ou recibo por e-mail), não com NF
-- brasileira. Decisão do Rafael: a invoice serve de documento fiscal da despesa, e a
-- Flávia mapeia pelos e-mails de cobrança.
--
-- • Anexo de despesa ganha o tipo 'Invoice' (o filtro "Sem NF do fornecedor" aceita).
-- • fin_despesas_abertas passa a trazer também a despesa PAGA nos últimos 60 dias que
--   ainda não tem NF nem invoice (cartão debita antes do documento chegar), com a situação.
-- • fin_atualizar_despesa_agente aceita a despesa paga só para ANEXAR — valor e
--   vencimento de despesa paga não mudam por e-mail.

create or replace function public.fin_despesas_abertas(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(row_to_json(t) order by t.vencimento), '[]'::jsonb) into v from (
    select l.id as lancamento_id, coalesce(nullif(l.descricao, ''), '(sem descrição)') as descricao,
           l.contato_nome, l.categoria, abs(l.valor)::float8 as valor, l.vencimento::text as vencimento,
           l.situacao,
           (select string_agg(coalesce(x->>'nome', ''), ' | ') from jsonb_array_elements(l.anexos) x) as anexos
      from lancamentos l
     where l.org_id = p_org and l.tipo = 'saida'
       and ((l.situacao = 'em_aberto' and l.vencimento between fin_hoje() - 60 and fin_hoje() + 75)
         or (l.situacao = 'pago' and coalesce(l.data_liquidacao, l.vencimento) >= fin_hoje() - 60
             and coalesce(l.categoria, '') not ilike 'transfer%'
             and not exists (select 1 from jsonb_array_elements(coalesce(l.anexos, '[]'::jsonb)) x
                              where x->>'tipo' in ('NF', 'Invoice'))))
  ) t;
  return v;
end $$;

create or replace function public.fin_atualizar_despesa_agente(p_lancamento_id uuid, p_valor numeric, p_vencimento date, p_anexo jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare l lancamentos%rowtype; v_partes text[] := '{}'; v_novo_valor numeric;
begin
  select * into l from lancamentos where id = p_lancamento_id for update;
  if not found or not fin_can(l.org_id) then raise exception 'Título não encontrado'; end if;
  if l.tipo <> 'saida' or l.situacao not in ('em_aberto', 'pago') then raise exception 'Só conta a pagar'; end if;
  if l.situacao = 'pago' and (p_valor is not null or p_vencimento is not null) then
    raise exception 'Despesa paga: só dá para anexar o documento';
  end if;
  if p_valor is not null and p_valor <= 0 then raise exception 'Valor inválido'; end if;

  -- saída é gravada negativa ou positiva conforme a origem: mantém o sinal do lançamento
  v_novo_valor := case when p_valor is null then l.valor when l.valor < 0 then -p_valor else p_valor end;
  if v_novo_valor <> l.valor then v_partes := v_partes || format('valor %s → %s', abs(l.valor), abs(v_novo_valor)); end if;
  if p_vencimento is not null and p_vencimento <> l.vencimento then v_partes := v_partes || format('vencimento %s → %s', to_char(l.vencimento, 'DD/MM'), to_char(p_vencimento, 'DD/MM')); end if;

  if p_anexo is not null then
    if coalesce(p_anexo->>'tipo', '') not in ('NF', 'Boleto', 'Invoice', 'Outro') or coalesce(p_anexo->>'url', '') !~ '^https://[^ ]+/uploads/lancamentos/[\w.-]+$' then
      raise exception 'Documento inválido';
    end if;
    v_partes := v_partes || format('%s anexado (e-mail)', p_anexo->>'tipo');
  end if;
  if cardinality(v_partes) = 0 then return jsonb_build_object('ok', true, 'sem_mudanca', true); end if;

  update lancamentos
     set valor = v_novo_valor,
         vencimento = coalesce(p_vencimento, vencimento),
         anexos = case when p_anexo is null then anexos else coalesce(anexos, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                    'url', p_anexo->>'url', 'nome', left(coalesce(p_anexo->>'nome', 'documento.pdf'), 200),
                    'tipo', p_anexo->>'tipo', 'numero', left(coalesce(p_anexo->>'numero', ''), 40))) end,
         updated_at = now()
   where id = l.id;
  insert into lancamento_historico (org_id, lancamento_id, tipo, texto, de, para, por)
  values (l.org_id, l.id, case when p_vencimento is not null and p_vencimento <> l.vencimento then 'prorrogacao' else 'nota' end,
          array_to_string(v_partes, ' · ') || ' — conta recebida por e-mail',
          case when p_vencimento is not null and p_vencimento <> l.vencimento then l.vencimento end,
          case when p_vencimento is not null and p_vencimento <> l.vencimento then p_vencimento end,
          auth.uid());
  return jsonb_build_object('ok', true, 'mudancas', v_partes);
end $$;

revoke execute on function public.fin_despesas_abertas(uuid) from public, anon;
grant execute on function public.fin_despesas_abertas(uuid) to authenticated;
revoke execute on function public.fin_atualizar_despesa_agente(uuid, numeric, date, jsonb) from public, anon;
grant execute on function public.fin_atualizar_despesa_agente(uuid, numeric, date, jsonb) to authenticated;

notify pgrst, 'reload schema';
