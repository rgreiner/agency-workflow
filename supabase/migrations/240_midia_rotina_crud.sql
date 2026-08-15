-- 240_midia_rotina_crud.sql
-- O catálogo de rotinas (234) nasceu só-leitura: dava para usar as 4 semeadas,
-- não para criar a quinta. Isso trava a virada — no balde há rotina que não está
-- no catálogo ("[É o Amor] Liberação Mídia Mensal"), e as variações por cliente
-- aparecem justamente na hora de ativar cliente a cliente.
--
-- Excluir NÃO apaga: uma rotina já instanciada virou tarefa recorrente em vários
-- clientes, e o vínculo é histórico. Desativar tira do catálogo e some das
-- sugestões; as tarefas seguem vivas.
-- Idempotente.

create or replace function midia_rotina_salvar(
  p_id uuid, p_org uuid, p_nome text, p_descricao text, p_frequencia text,
  p_dia_mes int, p_dia_semana int, p_status_retorno text, p_pasta text,
  p_padrao boolean, p_ordem int
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not midia_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if coalesce(btrim(p_nome), '') = '' then raise exception 'A rotina precisa de um nome'; end if;
  if recurrence_interval(p_frequencia) is null then
    raise exception 'Frequência inválida: %', p_frequencia;
  end if;
  -- Dia 29–31 não existe em todo mês: a régua do catálogo para em 28 (o mesmo
  -- limite do check da tabela) para a rotina nunca pular fevereiro.
  if p_dia_mes is not null and (p_dia_mes < 1 or p_dia_mes > 28) then
    raise exception 'Dia do mês precisa estar entre 1 e 28';
  end if;
  if p_dia_semana is not null and (p_dia_semana < 0 or p_dia_semana > 6) then
    raise exception 'Dia da semana inválido';
  end if;

  if p_id is null then
    insert into midia_rotina (org_id, nome, descricao, frequencia, dia_mes, dia_semana,
                              status_retorno, pasta, padrao, ordem)
    values (p_org, btrim(p_nome), nullif(btrim(coalesce(p_descricao, '')), ''), p_frequencia,
            p_dia_mes, p_dia_semana, coalesce(nullif(btrim(coalesce(p_status_retorno, '')), ''), 'midia'),
            nullif(btrim(coalesce(p_pasta, '')), ''), coalesce(p_padrao, true), coalesce(p_ordem, 100))
    returning id into v_id;
  else
    update midia_rotina
       set nome = btrim(p_nome),
           descricao = nullif(btrim(coalesce(p_descricao, '')), ''),
           frequencia = p_frequencia,
           dia_mes = p_dia_mes,
           dia_semana = p_dia_semana,
           status_retorno = coalesce(nullif(btrim(coalesce(p_status_retorno, '')), ''), status_retorno),
           pasta = nullif(btrim(coalesce(p_pasta, '')), ''),
           padrao = coalesce(p_padrao, padrao),
           ordem = coalesce(p_ordem, ordem)
     where id = p_id and org_id = p_org
    returning id into v_id;
    if v_id is null then raise exception 'Rotina não encontrada'; end if;
  end if;
  return v_id;
end $$;
revoke execute on function midia_rotina_salvar(uuid, uuid, text, text, text, int, int, text, text, boolean, int) from public, anon;
grant  execute on function midia_rotina_salvar(uuid, uuid, text, text, text, int, int, text, text, boolean, int) to authenticated;

/** Liga/desliga a rotina no catálogo. As tarefas já criadas continuam vivas. */
create or replace function midia_rotina_ativo(p_id uuid, p_ativo boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from midia_rotina where id = p_id;
  if v_org is null then raise exception 'Rotina não encontrada'; end if;
  if not midia_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update midia_rotina set ativo = coalesce(p_ativo, true) where id = p_id;
end $$;
revoke execute on function midia_rotina_ativo(uuid, boolean) from public, anon;
grant  execute on function midia_rotina_ativo(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
