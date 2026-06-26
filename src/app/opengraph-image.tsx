import { ImageResponse } from 'next/og'

// Imagem de compartilhamento (OG/Twitter) — aparece quando um link do Flow
// (ex.: um job no WhatsApp/Slack) é colado.
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: '#0d1117',
          padding: '0 90px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <div
            style={{
              width: 108,
              height: 108,
              borderRadius: 26,
              background: '#f97316',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 72,
              fontWeight: 700,
            }}
          >
            F
          </div>
          <div style={{ fontSize: 92, fontWeight: 700, color: '#f0f6fc' }}>Flow</div>
        </div>
        <div style={{ marginTop: 30, fontSize: 38, color: '#9aa4b2' }}>
          Gestão de pauta, produção e mídia para agências
        </div>
      </div>
    ),
    { ...size },
  )
}
