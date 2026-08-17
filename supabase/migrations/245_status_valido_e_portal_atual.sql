-- 245_status_valido_e_portal_atual.sql
-- Duas pontas da revisão de segurança de 15/08, decididas pelo Rafael.
--
-- 1) `update_activity_status` gravava QUALQUER string em `activities.status`.
--    Status virou CADASTRO na migration 168 — mas a RPC nunca conferiu o
--    destino contra ele. Quem tem permissão de mover podia, via API, gravar um
--    status inexistente; a tarefa sumiria de todas as telas (que filtram pelos
--    status cadastrados) sem estar arquivada nem concluída. É integridade, não
--    vazamento — e o custo de arrumar depois é caçar tarefa fantasma.
--
--    Medido antes de apertar: ZERO tarefas em produção usam status fora do
--    cadastro ativo (21 status, 1 org) — então a trava não barra nada que já
--    exista. A validação é só do DESTINO: tarefa parada num status desativado
--    continua podendo sair dele.
--
--    A recorrência não passa por aqui (`recur_activity` faz UPDATE direto),
--    então o ciclo das rotinas segue intocado.
--
-- 2) `portal_atual()` é RPC órfã — ninguém chama (o portal lê por SQL direto em
--    lib/auth/portal.ts, com colunas explícitas) — e devolve `portal_users`
--    inteiro, `senha_hash` incluído. Revogar de anon/public em vez de dropar:
--    reversível, e não corre o risco de derrubar algo que eu não encontrei.
--
-- Idempotente.

create or replace function update_activity_status(
  p_user_id uuid, p_activity_id uuid, p_new_status text, p_comment text
) returns void language plpgsql security definer set search_path = public as $$
declare v_old_status text; v_label text; v_org uuid;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select status into v_old_status from activities where id = p_activity_id;

  select w.org_id into v_org
    from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
   where a.id = p_activity_id and m.user_id = p_user_id;

  if v_org is null then
    raise exception 'Acesso negado';
  end if;

  -- Trava por cargo no status ATUAL. Mensagem diz o status pra pessoa saber a quem
  -- pedir, em vez de um "acesso negado" seco.
  if not pode_mover_status(p_user_id, p_activity_id) then
    v_label := replace(initcap(replace(v_old_status::text, '_', ' ')), ' Do ', ' do ');
    raise exception 'Seu cargo não permite mover tarefas em %. Peça a quem cuida dessa etapa.', v_label;
  end if;

  -- O destino tem que existir no cadastro da org e estar ativo. Sem isto, um
  -- POST direto na API cria tarefa fantasma: fora de todas as telas, sem estar
  -- arquivada.
  if not exists (
    select 1 from org_status s
     where s.org_id = v_org and s.valor = p_new_status and s.ativo
  ) then
    raise exception 'Status "%" não existe no cadastro desta organização.', p_new_status
      using errcode = '22023';
  end if;

  update activities set status = p_new_status, updated_at = now() where id = p_activity_id;

  insert into activity_history (activity_id, from_status, to_status, changed_by, comment)
  values (p_activity_id, v_old_status, p_new_status, p_user_id, nullif(p_comment,''));
end $$;

-- Órfã e com senha_hash no retorno: fecha para o público.
revoke execute on function portal_atual() from anon, public;
grant  execute on function portal_atual() to authenticated;

notify pgrst, 'reload schema';
