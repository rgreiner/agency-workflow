import { Hammer } from 'lucide-react'

/** Placeholder das telas do módulo comercial ainda não construídas. */
export function EmBreve({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
      <div className="mt-6 text-center py-24 bg-white rounded-xl border border-dashed border-gray-300">
        <Hammer className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <h3 className="text-gray-900 font-medium">Em construção</h3>
        <p className="text-gray-500 text-sm mt-1">
          {hint ?? 'Essa tela será construída em breve, conforme os próximos passos.'}
        </p>
      </div>
    </div>
  )
}
