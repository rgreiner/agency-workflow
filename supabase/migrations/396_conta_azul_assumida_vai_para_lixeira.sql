-- 396 — Lançamento promovido da Conta Azul e assumido por outra origem não ressuscita a linha (30/10/2026)
--
-- Caso: Danielle e Isadora, remuneração de out/2026. O lançamento delas nasceu da
-- promoção do extrato da Conta Azul (origem_tipo 'conta_azul', origem_ref = import_ref,
-- valor BRUTO da provisão: 4.291,46 e 1.736,09). Em 28/10 a folha de outubro foi
-- aplicada: rh_folha_aplicar ASSUMIU o lançamento (origem_tipo 'folha', origem_ref
-- 'folha:2026-10:pessoa:…', valor líquido, vencimento no último dia útil). O pagamento
-- ficou certo — mas o import_ref sumiu do lançamento, a deduplicação de Lançamentos
-- ("linha importada que já virou lançamento some") deixou de achar o par, e a linha
-- da Conta Azul voltou como "Em aberto" em 31/10 com o valor bruto. Parecia folha em dobro.
--
-- Medido: só esses 2 (únicos lançamentos de antes do fim da Conta Azul com origem
-- 'folha'). Nov e dez delas ainda são 'conta_azul' — a folha de novembro repetiria.
--
-- Correção na regra, não na rotina: quando um lançamento deixa de apontar para uma
-- linha da Conta Azul, essa linha vai para os descartes (a Lixeira do extrato, que
-- sobrevive ao reimport e se restaura pela tela). Vale para a folha, as guias e
-- qualquer rotina futura que reaproveite lançamento promovido.

create or replace function trg_lanc_conta_azul_assumido()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.origem_tipo = 'conta_azul' and old.origem_ref is not null
     and new.origem_ref is distinct from old.origem_ref then
    insert into extrato_descartado (org_id, import_ref, motivo, created_by)
    values (old.org_id, old.origem_ref,
            'Substituída: o lançamento passou a ser ' || coalesce(new.origem_tipo, '—')
              || coalesce(' (' || new.origem_ref || ')', ''),
            auth.uid())
    on conflict (org_id, import_ref) do nothing;
  end if;
  return new;
end $$;

revoke execute on function trg_lanc_conta_azul_assumido() from public, anon, authenticated;

drop trigger if exists lanc_conta_azul_assumido on lancamentos;
create trigger lanc_conta_azul_assumido
  before update of origem_ref on lancamentos
  for each row execute function trg_lanc_conta_azul_assumido();

-- Os 2 de outubro: a linha da Conta Azul cujo lançamento a folha assumiu. Casamento
-- estrito — mesmo contato pelo trigrama do conferidor da folha (Amorim × Amorin),
-- mesmo mês, linha em aberto que nenhum lançamento segura nem foi descartada.
insert into extrato_descartado (org_id, import_ref, motivo)
select e.org_id, e.import_ref,
       'Substituída: o lançamento passou a ser folha (' || l.origem_ref || ')'
  from extrato_importado e
  join lancamentos l
    on l.org_id = e.org_id and l.origem_tipo = 'folha' and l.tipo = 'saida'
   and l.created_at < '2026-07-18'
   and similarity(lower(l.contato_nome), lower(e.contato)) >= 0.8
   and date_trunc('month', l.vencimento) = date_trunc('month', coalesce(e.data_prevista, e.venc_original, e.data_mov))
 where e.situacao = 'Em aberto'
   and not exists (select 1 from lancamentos x where x.org_id = e.org_id and x.origem_ref = e.import_ref)
on conflict (org_id, import_ref) do nothing;
