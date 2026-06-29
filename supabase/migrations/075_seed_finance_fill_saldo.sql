-- 075_seed_finance_fill_saldo.sql
-- Ajuste do seed: quando a conta JÁ existe mas está com saldo_inicial = 0 (não
-- configurado), preenche com o saldo atual do arquivo. Não toca em conta com saldo
-- já informado (respeita ajuste manual). Idempotente.

create or replace function seed_finance_from_extrato_table(p_user_id uuid, p_org_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  paleta text[] := array['#f97316','#22c55e','#3b82f6','#8b5cf6','#ec4899','#eab308','#14b8a6','#ef4444','#6366f1','#06b6d4'];
  rec record;
  v_ord int;
  v_contas int := 0; v_contas_upd int := 0; v_centros int := 0; v_cats int := 0;
  v_centros_cfg jsonb; v_cats_cfg jsonb;
  i int;
  v_cor text; v_tipo text; v_saldo numeric;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;

  -- ── Contas (saldo atual por conta = soma assinada dos realizados) ──
  select coalesce(max(ordem), 0) into v_ord from contas_financeiras where org_id = p_org_id;
  i := 0;
  for rec in
    select conta as nome,
           sum(case when situacao in ('Conciliado','Quitado','Transferido')
                    then (case when tipo='receita' then abs(valor)
                               when tipo='despesa' then -abs(valor) else 0 end)
                    else 0 end) as saldo
    from extrato_importado
    where org_id = p_org_id and conta is not null and conta <> ''
    group by conta
    order by 2 desc
  loop
    v_cor := paleta[(i % 10) + 1];
    v_saldo := round(coalesce(rec.saldo,0),2);
    v_tipo := case
      when rec.nome ~* 'fundo|reserva|aplica|crédito|credito' then 'aplicacao'
      when rec.nome ~* 'caixa|ajuste' then 'caixa'
      else 'banco' end;
    if not exists (
      select 1 from contas_financeiras where org_id = p_org_id and lower(nome) = lower(rec.nome)
    ) then
      v_ord := v_ord + 1;
      insert into contas_financeiras (org_id, nome, tipo, saldo_inicial, cor, ativo, ordem, created_by)
      values (p_org_id, rec.nome, v_tipo, v_saldo, v_cor, true, v_ord, p_user_id);
      v_contas := v_contas + 1;
    else
      -- conta já existe: se está zerada (não configurada), preenche o saldo do arquivo
      update contas_financeiras
        set saldo_inicial = v_saldo, updated_at = now()
        where org_id = p_org_id and lower(nome) = lower(rec.nome)
          and saldo_inicial = 0 and v_saldo <> 0;
      if found then v_contas_upd := v_contas_upd + 1; end if;
    end if;
    i := i + 1;
  end loop;

  -- ── org_settings: centros de custo e categorias (merge, add ausentes) ──
  select coalesce(finance_centros_custo,'[]'::jsonb), coalesce(finance_categorias,'[]'::jsonb)
    into v_centros_cfg, v_cats_cfg
    from org_settings where org_id = p_org_id;
  v_centros_cfg := coalesce(v_centros_cfg,'[]'::jsonb);
  v_cats_cfg    := coalesce(v_cats_cfg,'[]'::jsonb);

  i := 0;
  for rec in
    select distinct centro_custo as nome from extrato_importado
    where org_id = p_org_id and centro_custo is not null and centro_custo <> ''
    order by 1
  loop
    v_cor := paleta[(i % 10) + 1];
    if not exists (select 1 from jsonb_array_elements(v_centros_cfg) e where lower(e->>'nome') = lower(rec.nome)) then
      v_centros_cfg := v_centros_cfg || jsonb_build_array(jsonb_build_object('nome', rec.nome, 'cor', v_cor));
      v_centros := v_centros + 1;
    end if;
    i := i + 1;
  end loop;

  i := 0;
  for rec in
    select categoria as nome, bool_or(tipo='receita') as e, bool_or(tipo='despesa') as s
    from extrato_importado
    where org_id = p_org_id and categoria is not null and categoria <> ''
      and categoria not in ('Saldo Inicial','Transferência de Entrada','Transferência de Saída')
    group by categoria
    order by 1
  loop
    v_cor := paleta[(i % 10) + 1];
    if not exists (select 1 from jsonb_array_elements(v_cats_cfg) e where lower(e->>'nome') = lower(rec.nome)) then
      v_cats_cfg := v_cats_cfg || jsonb_build_array(jsonb_build_object(
        'nome', rec.nome,
        'tipo', case when rec.e and rec.s then 'ambos' when rec.e then 'entrada' else 'saida' end,
        'cor', v_cor, 'filhos', '[]'::jsonb));
      v_cats := v_cats + 1;
    end if;
    i := i + 1;
  end loop;

  insert into org_settings (org_id, finance_centros_custo, finance_categorias)
  values (p_org_id, v_centros_cfg, v_cats_cfg)
  on conflict (org_id) do update set
    finance_centros_custo = v_centros_cfg,
    finance_categorias    = v_cats_cfg;

  return jsonb_build_object(
    'contas', v_contas, 'contas_atualizadas', v_contas_upd,
    'centros', v_centros, 'categorias', v_cats
  );
end; $$;

grant execute on function seed_finance_from_extrato_table(uuid,uuid) to anon, authenticated;

notify pgrst, 'reload schema';
