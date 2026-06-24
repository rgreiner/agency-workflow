import 'server-only'

/**
 * Compat: a revisão de Redação agora usa o motor genérico em `./review`.
 * Mantido como fachada p/ não quebrar importadores existentes.
 */
export type { ReviewProvider, ReviewError, ReviewResult } from './review'
export { reviewConfigured, configuredProvider, reviewText as reviewRedacaoText } from './review'
