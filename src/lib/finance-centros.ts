// Centro de custo: casar um nome vindo de fora (cliente, import) com o CADASTRO
// (org_settings.finance_centros_custo) pela mesma chave do cubo da Análise —
// `chaveNome` ↔ `fin_chave_nome` (migration 250): sem caixa e sem acento.
//
// O que originou isto (08/09/2026): o cliente se chama "É O Amor" e o cadastro
// diz "É o Amor". O Faturamento pré-preenchia o centro com o nome do cliente
// letra por letra, e o modal de Lançamentos carimbava "(arquivado)" em tudo que
// não batia exato com um centro ATIVO — o centro não estava arquivado, era um O
// maiúsculo. 63 lançamentos com a grafia do cadastro, 2 com a do cliente, e a
// pessoa re-selecionando na lista para sumir com o rótulo.
//
// Módulo puro (client e server). O cadastro é a fonte da grafia; o rótulo diz o
// motivo real de um centro não estar na lista ativa.

import { chaveNome } from './nomes'

export interface CentroLike { nome: string; arquivado?: boolean }

/** O centro do cadastro com o mesmo nome normalizado. Ativo ganha do arquivado. */
export function acharCentro<T extends CentroLike>(centros: T[], nome: string | null | undefined): T | undefined {
  const k = chaveNome(nome ?? '')
  if (!k) return undefined
  const iguais = centros.filter(c => chaveNome(c.nome) === k)
  return iguais.find(c => !c.arquivado) ?? iguais[0]
}

/** A grafia do cadastro para um nome vindo de fora; sem cadastro, o nome como veio. */
export function canonizarCentro(centros: CentroLike[], nome: string | null | undefined): string {
  const n = (nome ?? '').trim()
  return acharCentro(centros, n)?.nome ?? n
}

/**
 * Opções do Select de centro: os ativos, mais o valor atual quando ele não é um
 * ativo — com o motivo REAL no rótulo: "(arquivado)" só se o cadastro diz que
 * está; "(fora do cadastro)" se não existe lá. Sem a opção vazia: cada tela decide.
 */
export function opcoesDeCentro(centros: CentroLike[], atual: string | null | undefined): { value: string; label: string }[] {
  const ativos = centros.filter(c => !c.arquivado)
  const opts = ativos.map(c => ({ value: c.nome, label: c.nome }))
  const v = (atual ?? '').trim()
  if (v && !ativos.some(c => c.nome === v)) {
    const cad = acharCentro(centros, v)
    const tag = !cad ? ' (fora do cadastro)' : cad.arquivado ? ' (arquivado)' : ''
    opts.push({ value: v, label: v + tag })
  }
  return opts
}
