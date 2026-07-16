import { createClient } from '@/lib/supabase/server'
import { createBoard } from '@/app/actions/boards'
import Link from 'next/link'
import { Layout, PenTool, Network } from 'lucide-react'

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
    const kind = formData.get('kind') === 'mapa' ? 'mapa' : 'quadro'
    await createBoard(orgSlug, org!.id, title, workspaceId || undefined, kind)
  }

  return (
    <div className="p-6 max-w-lg mx-auto mt-12">
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 p-6 border-b border-gray-100">
          <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center">
            <Layout className="w-5 h-5 text-orange-500" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-900">Novo quadro</h1>
            <p className="text-sm text-gray-500">Escolha o tipo e comece</p>
          </div>
        </div>

        {/* Form */}
        <form action={handleCreate} className="p-6 space-y-4">
          {/* Tipo: define o editor (canvas livre vs árvore com layout automático) */}
          <fieldset>
            <legend className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Tipo</legend>
            <div className="grid grid-cols-2 gap-3">
              <label className="relative flex flex-col gap-1 p-3 rounded-xl border border-gray-200 cursor-pointer transition hover:bg-gray-50 has-[:checked]:border-orange-400 has-[:checked]:bg-orange-50/60 has-[:checked]:ring-2 has-[:checked]:ring-orange-100">
                <input type="radio" name="kind" value="quadro" defaultChecked className="sr-only peer" />
                <PenTool className="w-4 h-4 text-gray-400 peer-checked:text-orange-600" />
                <span className="text-sm font-medium text-gray-800">Quadro livre</span>
                <span className="text-[11px] text-gray-500 leading-snug">Notas, imagens e setas onde você quiser</span>
              </label>
              <label className="relative flex flex-col gap-1 p-3 rounded-xl border border-gray-200 cursor-pointer transition hover:bg-gray-50 has-[:checked]:border-orange-400 has-[:checked]:bg-orange-50/60 has-[:checked]:ring-2 has-[:checked]:ring-orange-100">
                <input type="radio" name="kind" value="mapa" className="sr-only peer" />
                <Network className="w-4 h-4 text-gray-400 peer-checked:text-orange-600" />
                <span className="text-sm font-medium text-gray-800">Mapa mental</span>
                <span className="text-[11px] text-gray-500 leading-snug">Ramificações que se organizam sozinhas · exporta .md e PDF</span>
              </label>
            </div>
          </fieldset>

          <div>
            <label htmlFor="title" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Nome
            </label>
            <input
              id="title"
              name="title"
              type="text"
              autoFocus
              placeholder="Ex: Briefing campanha dia dos pais"
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
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
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
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
              className="flex-1 px-4 py-2.5 text-sm font-medium text-[#fff] bg-orange-600 hover:bg-orange-700 rounded-xl transition"
            >
              Criar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
