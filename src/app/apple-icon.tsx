import { ImageResponse } from 'next/og'

// Ícone para iOS (atalho na tela inicial) — full-bleed (o iOS aplica a máscara).
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f97316',
          color: '#fff',
          fontSize: 118,
          fontWeight: 700,
          fontFamily: 'sans-serif',
        }}
      >
        F
      </div>
    ),
    { ...size },
  )
}
