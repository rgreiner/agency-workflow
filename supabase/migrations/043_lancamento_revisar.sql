-- 043_lancamento_revisar.sql
-- Quando uma mídia JÁ LANÇADA é alterada, o lançamento é marcado para o financeiro
-- revisar (e editar o MESMO lançamento, não criar outro). Idempotente.

alter table lancamentos add column if not exists revisar boolean not null default false;

-- Trigger: ao mudar campos financeiros de uma mídia, sinaliza o lançamento existente.
create or replace function flag_lancamento_doc_alterado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.valor, new.desconto_pct, new.faturamento, new.prazo, new.data_base, new.dias_agencia, new.veiculo_id, new.workspace_id)
     is distinct from
     (old.valor, old.desconto_pct, old.faturamento, old.prazo, old.data_base, old.dias_agencia, old.veiculo_id, old.workspace_id)
  then
    update lancamentos set revisar = true, updated_at = now()
    where origem_tipo = 'midia' and origem_id = new.id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_flag_lancamento on midias;
create trigger trg_flag_lancamento after update on midias
  for each row execute function flag_lancamento_doc_alterado();

-- Re-sincroniza o lançamento a partir da mídia atual (EDITA o mesmo lançamento) e limpa o flag.
-- Mantém situação/NF/boleto (não mexe na liquidação).
create or replace function ressincronizar_lancamento(p_user_id uuid, p_lancamento_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  l record; m record;
  v_comissao numeric(14,2); v_base date; v_venc date;
  v_pagador text; v_ct text; v_cn text;
begin
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then return; end if;
  if not exists (
    select 1 from organization_members where org_id = l.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  if l.origem_tipo <> 'midia' or l.origem_id is null then
    update lancamentos set revisar = false, updated_at = now() where id = p_lancamento_id; return;
  end if;

  select mi.*, w.name as cliente_nome, ve.name as veiculo_nome into m
    from midias mi join workspaces w on w.id = mi.workspace_id join veiculos ve on ve.id = mi.veiculo_id
    where mi.id = l.origem_id;
  if not found then
    update lancamentos set revisar = false, updated_at = now() where id = p_lancamento_id; return;
  end if;

  v_comissao := round(coalesce(m.valor,0) * coalesce(m.desconto_pct,0) / 100.0, 2);
  v_base := case
    when m.prazo = 'a_vista' then m.data_base
    when m.prazo = '10_dfm' then (date_trunc('month', m.data_base) + interval '1 month - 1 day')::date + 10
    when m.prazo = '15_dfm' then (date_trunc('month', m.data_base) + interval '1 month - 1 day')::date + 15
    when m.prazo = '20_dfm' then (date_trunc('month', m.data_base) + interval '1 month - 1 day')::date + 20
    when m.prazo = '30_dfm' then (date_trunc('month', m.data_base) + interval '1 month - 1 day')::date + 30
    else m.data_base
  end;
  v_venc := case when v_base is not null then v_base + coalesce(m.dias_agencia, 0) else null end;
  v_pagador := case
    when m.faturamento in ('valor_bruto','liquido_contra_agencia') then 'veiculo'
    when m.faturamento = 'valor_bruto_comissao_cliente' then 'cliente'
    else 'cliente'
  end;
  if v_pagador = 'veiculo' then v_ct := 'veiculo'; v_cn := m.veiculo_nome;
  else v_ct := 'cliente'; v_cn := m.cliente_nome; end if;

  update lancamentos set
    valor = v_comissao, vencimento = v_venc, competencia = m.data_base,
    contato_tipo = v_ct, contato_nome = v_cn, revisar = false, updated_at = now()
  where id = p_lancamento_id;
end; $$;

-- Apenas baixa o flag (financeiro conferiu e não precisa mudar nada).
create or replace function marcar_lancamento_revisado(p_user_id uuid, p_lancamento_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from lancamentos l join organization_members om on om.org_id = l.org_id
    where l.id = p_lancamento_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update lancamentos set revisar = false, updated_at = now() where id = p_lancamento_id;
end; $$;

grant execute on function ressincronizar_lancamento(uuid,uuid) to anon, authenticated;
grant execute on function marcar_lancamento_revisado(uuid,uuid) to anon, authenticated;

notify pgrst, 'reload schema';
