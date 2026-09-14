-- 291_vinculo_conta_da_entrada_na_casa.sql
-- Conserto de um efeito colateral da 290, pego no teste antes de ir ao ar.
--
-- Com `data_admissao` passando a marcar o vínculo ATUAL (o CLT começa hoje),
-- `rh_no_vinculo` — que decide se havia jornada a cumprir num dia — passou a
-- responder "ela não estava na casa" para todo o período de estágio. Medido na
-- simulação: o ciclo 26/08–25/09 da Luiza virou **66h de hora extra** e zero
-- carga, porque os dias anteriores a hoje deixaram de esperar jornada.
--
-- Para o PONTO o que importa é se a pessoa estava trabalhando, não sob qual
-- contrato: quem estagiava batia ponto igual. Então o vínculo do dia sai da
-- ENTRADA NA CASA (`data_entrada_casa`), com a admissão como reserva para
-- quem nunca trocou de vínculo.
--
-- Férias e contrato de experiência continuam olhando `data_admissao` — lá o
-- que vale é o contrato atual, que é o ponto da decisão do Rafael.
-- Idempotente.

create or replace function rh_no_vinculo(p_colaborador uuid, p_data date)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select p_data >= coalesce(c.data_entrada_casa, c.data_admissao, p_data)
        and (c.data_demissao is null or p_data <= c.data_demissao)
       from rh_colaborador c where c.id = p_colaborador),
    false)
$$;

notify pgrst, 'reload schema';
