import Link from 'next/link'
import { Home } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="max-w-md w-full text-center">
        <p className="text-7xl font-bold text-gray-200 tracking-tight">404</p>
        <h1 className="text-xl font-semibold text-gray-900 mt-3">Página não encontrada</h1>
        <p className="text-gray-500 text-sm mt-2">
          A página que você procura não existe, foi movida ou você não tem acesso a ela.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-4 py-2 mt-6 text-sm font-medium rounded-lg bg-indigo-600 text-[#fff] hover:bg-indigo-700 transition"
        >
          <Home className="w-4 h-4" /> Voltar ao início
        </Link>
      </div>
    </div>
  )
}
