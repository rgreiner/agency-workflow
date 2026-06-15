import { redirect } from 'next/navigation'
import { getUsuario } from '@/lib/auth/server'
import { Toaster } from 'sonner'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUsuario()

  if (!user) redirect('/login')

  return (
    <>
      {children}
      <Toaster position="bottom-right" richColors closeButton />
    </>
  )
}
