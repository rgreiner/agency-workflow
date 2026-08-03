'use server'

import { folderProvider, defaultPathPrefix } from '@/lib/task-folders'

/**
 * Qual backend de pastas está ATIVO no ambiente. A tela precisa saber para não
 * sugerir um formato que o servidor não consegue atender.
 *
 * Foi essa divergência que gerou o erro do Rafael em 03/08: o campo de pasta da
 * campanha sugeria `F:\Cliente\2026\…` (formato do bucket, da era R2), o servidor
 * transformava isso numa referência de S3 e, na primeira tarefa, estourava
 * "Storage S3 não configurado" — porque o R2 está sendo encerrado e as envs não
 * existem mais.
 */
export interface EstadoPastas {
  /** 's3' | 'drive' | null (nenhum configurado). */
  provider: 'drive' | 's3' | null
  /** Exemplo de preenchimento coerente com o backend ativo. */
  exemplo: string
  /** Prefixo do caminho local que o time vê no Finder/Explorer. */
  prefixo: string
}

export async function estadoDasPastas(): Promise<EstadoPastas> {
  const provider = folderProvider()
  return {
    provider,
    exemplo: provider === 's3'
      ? 'F:\\Cliente\\2026\\Projeto'
      : 'https://drive.google.com/drive/folders/…',
    prefixo: provider ? defaultPathPrefix(provider) : '',
  }
}
