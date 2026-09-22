/** Tipos de justificativa, na voz de quem PEDE (a tela do RH fala em 3ª pessoa). */
export const TIPO_JUSTIFICATIVA: { value: string; label: string }[] = [
  { value: 'esqueci',  label: 'Esqueci de bater' },
  { value: 'atestado', label: 'Atestado médico' },
  { value: 'medico',   label: 'Consulta médica' },
  { value: 'falta',    label: 'Falta' },
  { value: 'outro',    label: 'Outro' },
]
const MAPA = Object.fromEntries(TIPO_JUSTIFICATIVA.map(t => [t.value, t.label]))
export const rotuloTipo = (t: string) => MAPA[t] ?? t

/** Pedido do colaborador aguardando decisão do RH (rh_ponto_estado, mig. 303). */
export interface PedidoPendente {
  id: string; data_ini: string; data_fim: string; tipo: string; criado_em: string
}
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
/** "21/09 · Esqueci de bater" — período vira "10/09 a 12/09". */
export const rotuloPedido = (p: PedidoPendente) =>
  `${dm(p.data_ini)}${p.data_fim !== p.data_ini ? ` a ${dm(p.data_fim)}` : ''} · ${rotuloTipo(p.tipo)}`
