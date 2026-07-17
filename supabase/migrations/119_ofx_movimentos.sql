-- 119_ofx_movimentos.sql
-- Extrato por OFX (Cresol, BTG e qualquer banco) reaproveitando btg_movements como
-- extrato genérico. Enquanto o BTG não libera a API, importa-se o OFX da conta e a
-- conciliação (que já existe) passa a funcionar pros dois. A dedup do OFX usa o FITID
-- (id único da transação no banco), composto com a conta em btg_id ('ofx:<conta>:<fitid>')
-- pra reusar o unique (org_id, btg_id) sem colidir entre contas. Idempotente.

alter table btg_movements add column if not exists fonte    text not null default 'btg';  -- 'btg' | 'ofx'
alter table btg_movements add column if not exists conta_id uuid references contas_financeiras(id) on delete set null;
create index if not exists idx_btg_mov_conta on btg_movements(org_id, conta_id);

-- Importa transações OFX numa conta. Aditivo: só insere o que ainda não existe (por FITID),
-- não mexe no que já está conciliado. p_rows = [{fitid, data_mov (date), valor (>0), tipo
-- ('credit'|'debit'), descricao}].
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
    insert into btg_movements (org_id, fonte, conta_id, btg_id, tipo, valor, data_mov, descricao, raw)
    select p_org_id, 'ofx', p_conta_id,
           'ofx:' || p_conta_id::text || ':' || r.fitid,
           case when r.tipo in ('credit','debit') then r.tipo when r.valor < 0 then 'debit' else 'credit' end,
           abs(r.valor), r.data_mov, r.descricao, jsonb_build_object('fitid', r.fitid)
    from rows r
    where r.fitid is not null and r.data_mov is not null and r.valor is not null
    on conflict (org_id, btg_id) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;
  select count(*) into v_total from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb));
  return jsonb_build_object('inserted', v_inserted, 'skipped', v_total - v_inserted, 'total', v_total);
end; $$;

grant execute on function importar_ofx(uuid, uuid, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
