-- 233_fin_categorias_contato.sql
-- A aba Categorias (232) para no nome da categoria. Rafael pediu um nível ABAIXO
-- do detalhado: dentro de "Software / Licença de Uso", quem é Google, quem é
-- Adobe; dentro de "Remuneração Funcionários", cada pessoa. É o corte que
-- responde "esse custo subiu por quê", que a categoria sozinha não responde.
--
-- RPC separada de propósito: carrega SOB DEMANDA (só quando a visão Hiper é
-- ligada). Medido em produção: 1.515 grupos por categoria contra 3.653 com o
-- contato — não vale pesar a abertura da tela com o dobro para um modo que
-- quase sempre fica desligado. Overload não serve: o PostgREST self-hosted
-- exige 1 assinatura por RPC.
--
-- SECURITY DEFINER passando por cima de `fin_movimentos`: dentro de uma função
-- definer o "invoker" é o dono, então a RLS das tabelas de baixo NÃO é avaliada
-- e o guard aqui é a única barreira — e ele LEVANTA em vez de devolver vazio.
-- Idempotente.

create or replace function fin_categorias_contato(p_org uuid)
returns table (
  mes date, tipo text, situacao text, categoria text, contato text, valor numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (fin_can(p_org) or is_psql_direto()) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  return query
    select date_trunc('month', m.competencia)::date,
           m.tipo, m.situacao,
           coalesce(nullif(btrim(m.categoria), ''), '(sem categoria)'),
           coalesce(nullif(btrim(m.contato), ''), '(sem fornecedor)'),
           round(sum(abs(coalesce(m.valor, 0))), 2)
      from fin_movimentos m
     where m.org_id = p_org
       and m.competencia is not null
       and coalesce(m.transferencia, false) = false
     group by 1, 2, 3, 4, 5;
end $$;

revoke execute on function fin_categorias_contato(uuid) from public, anon;
grant  execute on function fin_categorias_contato(uuid) to authenticated;

notify pgrst, 'reload schema';
