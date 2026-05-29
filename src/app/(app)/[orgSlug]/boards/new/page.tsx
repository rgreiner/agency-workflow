import { createClient } from '@/lib/supabase/server'
import { createBoard } from '@/app/actions/boards'
import Link from 'next/link'
import { Layout } from 'lucide-react'

export default async function NewBoardPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', orgSlug)
    .single()

  if (!org) return null

  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, name')
    .eq('org_id', org.id)
    .order('name')

  async function handleCreate(formData: FormData) {
    'use server'
    const title = formData.get('title') as string
    const workspaceId = formData.get('workspace_id') as string
    await createBoard(orgSlug, org!.id, title, workspaceId || undefined)
  }

  return (
    <div className="p-6 max-w-lg mx-auto mt-12">
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 p-6 border-b border-gray-100">
          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
            <Layout className="w-5 h-5 text-indigo-500" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-900">Novo quadro visual</h1>
            <p className="text-sm text-gray-500">Canvas para notas, imagens e briefings</p>
          </div>
        </div>

        {/* Form */}
        <form action={handleCreate} className="p-6 space-y-4">
          <div>
            <label htmlFor="title" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Nome do quadro
            </label>
            <input
              id="title"
              name="title"
              type="text"
              autoFocus
              placeholder="Ex: Briefing campanha dia dos pais"
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
            />
          </div>

          {workspaces && workspaces.length > 0 && (
            <div>
              <label htmlFor="workspace_id" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Cliente <span className="font-normal text-gray-400">(opcional)</span>
              </label>
              <select
                id="workspace_id"
                name="workspace_id"
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
              >
                <option value="">Sem cliente específico</option>
                {workspaces.map(ws => (
                  <option key={ws.id} value={ws.id}>{ws.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Link
              href={`/${orgSlug}/boards`}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl text-center transition"
            >
              Cancelar
            </Link>
            <button
              type="submit"
              className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition"
            >
              Criar quadro
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
