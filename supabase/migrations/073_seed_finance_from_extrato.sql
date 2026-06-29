-- 073_seed_finance_from_extrato.sql
-- Semeia a config do Financeiro (contas, centros de custo, categorias) a partir do
-- import do extrato da Conta Azul. NÃO-DESTRUTIVO: só adiciona o que ainda não existe
-- (por nome, case-insensitive) — respeita o que o usuário já configurou à mão.
-- Idempotente.

create or replace function seed_finance_from_extrato(
  p_user_id uuid, p_org_id uuid, p_contas jsonb, p_centros jsonb, p_categorias jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c jsonb;
  v_ord int;
  v_contas int := 0;
  v_centros int := 0;
  v_cats int := 0;
  v_centros_cfg jsonb;
  v_cats_cfg jsonb;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;

  -- ── Contas financeiras: cria as que faltam (saldo_inicial = saldo atual do arquivo) ──
  select coalesce(max(ordem), 0) into v_ord from contas_financeiras where org_id = p_org_id;
  for c in select value from jsonb_array_elements(coalesce(p_contas, '[]'::jsonb)) loop
    if nullif(c->>'nome','') is null then continue; end if;
    if not exists (
      select 1 from contas_financeiras
      where org_id = p_org_id and lower(nome) = lower(c->>'nome')
    ) then
      v_ord := v_ord + 1;
      insert into contas_financeiras (org_id, nome, tipo, saldo_inicial, cor, ativo, ordem, created_by)
      values (
        p_org_id, c->>'nome', coalesce(nullif(c->>'tipo',''), 'banco'),
        coalesce(nullif(c->>'saldo_inicial','')::numeric, 0), nullif(c->>'cor',''),
        true, v_ord, p_user_id
      );
      v_contas := v_contas + 1;
    end if;
  end loop;

  -- ── org_settings: merge de centros de custo e categorias (add ausentes) ──
  select coalesce(finance_centros_custo, '[]'::jsonb), coalesce(finance_categorias, '[]'::jsonb)
    into v_centros_cfg, v_cats_cfg
    from org_settings where org_id = p_org_id;
  v_centros_cfg := coalesce(v_centros_cfg, '[]'::jsonb);
  v_cats_cfg    := coalesce(v_cats_cfg, '[]'::jsonb);

  for c in select value from jsonb_array_elements(coalesce(p_centros, '[]'::jsonb)) loop
    if nullif(c->>'nome','') is null then continue; end if;
    if not exists (
      select 1 from jsonb_array_elements(v_centros_cfg) e where lower(e->>'nome') = lower(c->>'nome')
    ) then
      v_centros_cfg := v_centros_cfg || jsonb_build_array(
        jsonb_build_object('nome', c->>'nome', 'cor', nullif(c->>'cor',''))
      );
      v_centros := v_centros + 1;
    end if;
  end loop;

  for c in select value from jsonb_array_elements(coalesce(p_categorias, '[]'::jsonb)) loop
    if nullif(c->>'nome','') is null then continue; end if;
    if not exists (
      select 1 from jsonb_array_elements(v_cats_cfg) e where lower(e->>'nome') = lower(c->>'nome')
    ) then
      v_cats_cfg := v_cats_cfg || jsonb_build_array(jsonb_build_object(
        'nome', c->>'nome',
        'tipo', coalesce(nullif(c->>'tipo',''), 'ambos'),
        'cor',  nullif(c->>'cor',''),
        'filhos', '[]'::jsonb
      ));
      v_cats := v_cats + 1;
    end if;
  end loop;

  insert into org_settings (org_id, finance_centros_custo, finance_categorias)
  values (p_org_id, v_centros_cfg, v_cats_cfg)
  on conflict (org_id) do update set
    finance_centros_custo = v_centros_cfg,
    finance_categorias    = v_cats_cfg;

  return jsonb_build_object('contas', v_contas, 'centros', v_centros, 'categorias', v_cats);
end; $$;

grant execute on function seed_finance_from_extrato(uuid,uuid,jsonb,jsonb,jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
