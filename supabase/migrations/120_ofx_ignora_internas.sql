-- 120_ofx_ignora_internas.sql
-- No OFX do BTG, ~metade das linhas são varredura interna da conta remunerada, que se
-- anulam e não casam com lançamento nenhum: "APLICAÇÃO/RESGATE CONTA REMUNERADA" e
-- "CRÉDITO/DÉBITO NA CONTA CORRENTE". São marcadas como 'ignorado' já no import (ficam no
-- histórico, o saldo continua batendo, mas somem da fila de pendentes).
-- ⚠️ O "VALOR DE RENDIMENTO REMUNERA+" NÃO entra aqui — é receita real e deve virar
-- lançamento (o padrão abaixo casa "conta remunerada"/"na conta corrente", não "remunera+").
-- Idempotente.

create or replace function eh_transferencia_interna(p_desc text)
returns boolean language sql immutable as $$
  select coalesce(p_desc, '') ~* 'conta remunerada|na conta corrente';
$$;

create or replace function importar_ofx(p_org_id uuid, p_conta_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inserted int := 0; v_total int := 0;
begin
  with rows as (
    select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      fitid text, data_mov date, valor numeric, tipo text, descricao text
    )
  ),
  ins as (
    insert into btg_movements (org_id, fonte, conta_id, btg_id, tipo, valor, data_mov, descricao, categoria, status, raw)
    select p_org_id, 'ofx', p_conta_id,
           'ofx:' || p_conta_id::text || ':' || r.fitid,
           case when r.tipo in ('credit','debit') then r.tipo when r.valor < 0 then 'debit' else 'credit' end,
           abs(r.valor), r.data_mov, r.descricao,
           case when eh_transferencia_interna(r.descricao) then 'Transferência interna' else null end,
           case when eh_transferencia_interna(r.descricao) then 'ignorado' else 'pendente' end,
           jsonb_build_object('fitid', r.fitid)
    from rows r
    where r.fitid is not null and r.data_mov is not null and r.valor is not null
    on conflict (org_id, btg_id) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;
  select count(*) into v_total from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb));
  return jsonb_build_object('inserted', v_inserted, 'skipped', v_total - v_inserted, 'total', v_total);
end; $$;

grant execute on function eh_transferencia_interna(text) to anon, authenticated;
grant execute on function importar_ofx(uuid, uuid, jsonb) to anon, authenticated;

-- Reclassifica o que já foi importado e ainda está pendente (ex.: o BTG que você já subiu).
update btg_movements
   set status = 'ignorado',
       categoria = coalesce(categoria, 'Transferência interna'),
       updated_at = now()
 where fonte = 'ofx' and status = 'pendente' and eh_transferencia_interna(descricao);

notify pgrst, 'reload schema';
