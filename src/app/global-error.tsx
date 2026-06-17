'use client'

// global-error substitui o layout raiz, então usa estilos inline (sem Tailwind/CSS).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: 'system-ui, -apple-system, sans-serif', margin: 0 }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            background: '#f9fafb',
          }}
        >
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: '#111827', margin: 0 }}>
              Algo deu errado
            </h1>
            <p style={{ color: '#6b7280', fontSize: 14, marginTop: 8 }}>
              Ocorreu um erro inesperado na aplicação.
            </p>
            {error?.digest && (
              <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 8 }}>
                Código do erro: {error.digest}
              </p>
            )}
            <button
              onClick={() => reset()}
              style={{
                marginTop: 24,
                padding: '10px 20px',
                background: '#4f46e5',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Tentar de novo
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
