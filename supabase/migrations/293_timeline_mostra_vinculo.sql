-- 293: a linha do tempo devolve o que a 290 passou a guardar.
-- Sem isto o marco de mudança de vínculo aparece sem o "de → para" que é a
-- razão de ele existir (estágio → CLT, 6h → 8h).
create or replace function rh_timeline(p_colaborador uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador;
  if v_org is null then raise exception 'Pessoa não encontrada'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'tipo', e.tipo, 'data_efeito', e.data_efeito,
      'titulo', e.titulo, 'descricao', e.descricao,
      'salario_de', e.salario_de, 'salario_para', e.salario_para, 'percentual', e.percentual,
      'cargo_de', e.cargo_de, 'cargo_para', e.cargo_para,
      'vinculo_de', e.vinculo_de, 'vinculo_para', e.vinculo_para,
      'jornada_de', e.jornada_de, 'jornada_para', e.jornada_para,
      'lote_id', e.lote_id, 'doc_id', e.doc_id,
      -- Registrado depois da vigência = ajuste de histórico (o caso da convenção).
      'retroativo', e.created_at::date > e.data_efeito,
      'registrado_em', e.created_at,
      'por', (select pr.full_name from profiles pr where pr.id = e.registrado_por))
      order by e.data_efeito desc, e.created_at desc)
      from rh_evento e where e.colaborador_id = p_colaborador), '[]'::jsonb);
end $$;

notify pgrst, 'reload schema';
