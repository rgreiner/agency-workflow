-- 272_encerrar_documento_parcelas.sql
-- ENCERRAR CONTRATO NO MEIO DE UM FEE (caso Times Digitais, 29/08): o cliente
-- encerra em setembro e as parcelas seguintes precisam sair do fluxo.
--
-- O que barrava: pela 136, excluir UMA parcela de documento (producao/midia)
-- significa ESTORNAR o documento inteiro — e o estorno é recusado se qualquer
-- parcela já foi movimentada. Como os meses anteriores foram recebidos, as
-- futuras ficavam presas junto ("Outra parcela deste documento já foi
-- movimentada: Lançamento já recebido"). A régua cobria "faturei errado",
-- nunca "o contrato acabou no meio" — que é o caso de todo cliente que sai.
--
-- Decisão do Rafael (29/08): encerrar A PARTIR DE um mês. Apaga só as parcelas
-- EM ABERTO daquela data em diante; o que já foi recebido continua intocado, o
-- documento SEGUE FATURADO e passa a valer o que foi realmente cobrado.
-- Idempotente.

alter table producao add column if not exists encerrado_em   date;
alter table producao add column if not exists encerrado_motivo text;
alter table midias   add column if not exists encerrado_em   date;
alter table midias   add column if not exists encerrado_motivo text;

-- ── Prévia: o que sai, o que fica ──────────────────────────────────────────
create or replace function fin_impacto_encerrar_doc(
  p_user_id uuid, p_lancamento_id uuid, p_a_partir date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l record; v_n int; v_total numeric; v_fica int; v_fica_total numeric; v_bloq text;
begin
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then return jsonb_build_object('pode', false, 'motivo', 'Lançamento não encontrado'); end if;
  if l.origem_tipo not in ('producao', 'midia') then
    return jsonb_build_object('pode', false, 'motivo', 'Só documentos parcelados (Fee, produção, mídia) são encerrados assim.');
  end if;
  if not exists (
    select 1 from organization_members
    where org_id = l.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then return jsonb_build_object('pode', false, 'motivo', 'Acesso negado'); end if;

  -- Alvo: parcelas do MESMO documento a partir da data. Se alguma delas já foi
  -- movimentada, o encerramento pararia no meio — recusa dizendo qual.
  select string_agg(distinct b, ' ') into v_bloq from (
    select _lancamento_bloqueio_exclusao(l2.id) b from lancamentos l2
     where l2.org_id = l.org_id and l2.origem_tipo = l.origem_tipo
       and l2.origem_id = l.origem_id and l2.vencimento >= p_a_partir
  ) t where b is not null;
  if v_bloq is not null then
    return jsonb_build_object('pode', false, 'motivo',
      'Há parcela já movimentada a partir desta data: ' || v_bloq);
  end if;

  select count(*), coalesce(sum(valor), 0) into v_n, v_total
    from lancamentos
   where org_id = l.org_id and origem_tipo = l.origem_tipo
     and origem_id = l.origem_id and vencimento >= p_a_partir;
  if coalesce(v_n, 0) = 0 then
    return jsonb_build_object('pode', false, 'motivo', 'Nenhuma parcela em aberto a partir desta data.');
  end if;

  select count(*), coalesce(sum(valor), 0) into v_fica, v_fica_total
    from lancamentos
   where org_id = l.org_id and origem_tipo = l.origem_tipo
     and origem_id = l.origem_id and vencimento < p_a_partir;

  return jsonb_build_object(
    'pode', true, 'remove', v_n, 'valor_removido', round(v_total, 2),
    'fica', v_fica, 'valor_final', round(v_fica_total, 2), 'a_partir', p_a_partir);
end $$;
revoke execute on function fin_impacto_encerrar_doc(uuid, uuid, date) from public, anon;
grant  execute on function fin_impacto_encerrar_doc(uuid, uuid, date) to authenticated;

-- ── O encerramento ─────────────────────────────────────────────────────────
create or replace function fin_encerrar_documento(
  p_user_id uuid, p_lancamento_id uuid, p_a_partir date, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l record; v_prev jsonb; v_n int; v_novo numeric;
begin
  v_prev := fin_impacto_encerrar_doc(p_user_id, p_lancamento_id, p_a_partir);
  if not coalesce((v_prev->>'pode')::boolean, false) then
    raise exception '%', coalesce(v_prev->>'motivo', 'Não é possível encerrar');
  end if;
  select * into l from lancamentos where id = p_lancamento_id;

  delete from lancamentos
   where org_id = l.org_id and origem_tipo = l.origem_tipo
     and origem_id = l.origem_id and vencimento >= p_a_partir;
  get diagnostics v_n = row_count;

  -- O documento SEGUE FATURADO e passa a valer o que foi realmente cobrado
  -- (decisão do Rafael): nada volta para a fila de Faturamento.
  select coalesce(sum(valor), 0) into v_novo
    from lancamentos
   where org_id = l.org_id and origem_tipo = l.origem_tipo and origem_id = l.origem_id;

  if l.origem_tipo = 'producao' then
    update producao set valor = v_novo, encerrado_em = p_a_partir,
           encerrado_motivo = nullif(btrim(coalesce(p_motivo, '')), '')
     where id = l.origem_id;
  else
    update midias set valor = v_novo, encerrado_em = p_a_partir,
           encerrado_motivo = nullif(btrim(coalesce(p_motivo, '')), '')
     where id = l.origem_id;
  end if;

  return jsonb_build_object('ok', true, 'removidas', v_n, 'valor_final', round(v_novo, 2));
end $$;
revoke execute on function fin_encerrar_documento(uuid, uuid, date, text) from public, anon;
grant  execute on function fin_encerrar_documento(uuid, uuid, date, text) to authenticated;

notify pgrst, 'reload schema';
