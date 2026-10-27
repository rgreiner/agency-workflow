-- 380 — agenda do DP para a Flávia: férias programadas e admissões recentes (27/10/2026)
--
-- Férias: o Rafael lança no RH do Flow; a Flávia avisa a Ocvel 30 dias antes do
-- início e cobra o recibo/pagamento (que vence 2 dias antes). ASO admissional: a
-- Facilita manda o ASO pelo WhatsApp depois do comprovante de pagamento; a Flávia
-- acompanha quem entrou e ainda não tem o ASO repassado à Ocvel.
-- Só nome, datas e cargo — sem CPF nem salário. Gate = fin_can.
create or replace function public.fin_dp_agenda(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_hoje date := fin_hoje();
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return jsonb_build_object(
    'ferias', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'colaborador_id', c.id, 'nome', c.nome, 'cargo', c.cargo,
               'inicio', f.inicio, 'fim', f.fim, 'dias', f.dias, 'abono_dias', f.abono_dias,
               'dias_ate_inicio', f.inicio - v_hoje,
               'pagar_ate', fin_dias_uteis_add(p_org, f.inicio, -2))
             order by f.inicio)
        from rh_ferias f join rh_colaborador c on c.id = f.colaborador_id
       where f.org_id = p_org and f.status = 'programada' and f.fim >= v_hoje and not c.arquivado), '[]'::jsonb),
    'admissoes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'colaborador_id', c.id, 'nome', c.nome, 'cargo', c.cargo, 'admissao', c.data_admissao,
               'exame_em', (select a.exame_em from rh_admissao a where a.colaborador_id = c.id order by a.created_at desc limit 1),
               'tem_aso', exists (select 1 from rh_documento d where d.colaborador_id = c.id and (d.tipo ilike '%aso%' or d.nome ilike '%aso%' or d.nome ilike '%admissional%')))
             order by c.data_admissao)
        from rh_colaborador c
       where c.org_id = p_org and not c.arquivado and c.status <> 'desligado'
         and c.tipo_vinculo not in ('socio') and c.data_admissao between v_hoje - 45 and v_hoje + 30), '[]'::jsonb)
  );
end $$;
revoke execute on function public.fin_dp_agenda(uuid) from public, anon;
grant execute on function public.fin_dp_agenda(uuid) to authenticated;

notify pgrst, 'reload schema';
