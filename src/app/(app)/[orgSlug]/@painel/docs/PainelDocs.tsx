import { cookies } from 'next/headers'
import { carregarArvoreDocs } from '@/lib/docs-arvore'
import { PREF_COOKIES } from '@/lib/sidebar-prefs'
import { DocsSidebar } from '@/app/(app)/[orgSlug]/docs/DocsSidebar'

/**
 * Árvore de Documentos que a sidebar do app mostra no lugar da lista do modo,
 * enquanto a pessoa está em /docs. Antes era uma segunda coluna clara ao lado
 * da sidebar — duas listas de navegação lado a lado, 496px de casca antes do
 * texto (19/09/2026). O slot existe porque layout não sabe a rota: é a página
 * que diz "aqui tem árvore".
 */
export async function PainelDocs({ orgSlug, docId }: { orgSlug: string; docId: string }) {
  const [arvore, jar] = await Promise.all([carregarArvoreDocs(orgSlug), cookies()])
  if (!arvore) return null
  const fechadas = (jar.get(PREF_COOKIES.docsFechadas)?.value ?? '').split('|').filter(Boolean)
  return (
    <DocsSidebar
      orgSlug={orgSlug}
      orgId={arvore.orgId}
      currentDocId={docId}
      docs={arvore.docs}
      clientes={arvore.clientes}
      fechadasIniciais={fechadas}
      meuId={arvore.meuId}
      souAdmin={arvore.souAdmin}
    />
  )
}
