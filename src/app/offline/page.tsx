import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Sem conexão' }

/**
 * Página que o service worker serve quando uma navegação falha sem rede.
 * Sem JS nem CSS externos de propósito: offline, os chunks do build não
 * carregam — tudo que ela precisa vai inline no próprio HTML cacheado.
 */
export default function OfflinePage() {
  return (
    <>
      <style>{`
        .off-wrap { min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 24px; background: #f9fafb; color: #111827; }
        .off-card { text-align: center; max-width: 22rem; }
        .off-icon { font-size: 40px; margin-bottom: 12px; }
        .off-title { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
        .off-text { font-size: 14px; color: #6b7280; margin: 0 0 20px; line-height: 1.5; }
        .off-btn { display: inline-block; padding: 10px 20px; border-radius: 12px; border: none; background: #f97316; color: #fff; font-size: 14px; font-weight: 500; cursor: pointer; }
        @media (prefers-color-scheme: dark) {
          .off-wrap { background: #1c1917; color: #f0ece8; }
          .off-text { color: #a8a29e; }
        }
      `}</style>
      <div className="off-wrap">
        <div className="off-card">
          <div className="off-icon">📡</div>
          <h1 className="off-title">Sem conexão</h1>
          <p className="off-text">
            O Flow não conseguiu falar com o servidor. Confira a internet do
            aparelho e tente de novo — nada foi perdido.
          </p>
          <button className="off-btn" type="button" data-reload>
            Tentar de novo
          </button>
          {/* Script inline: o JS do build não está disponível offline. */}
          <script
            dangerouslySetInnerHTML={{
              __html: `document.querySelector('[data-reload]').addEventListener('click',function(){location.reload()})`,
            }}
          />
        </div>
      </div>
    </>
  )
}
