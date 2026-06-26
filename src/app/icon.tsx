import { ImageResponse } from 'next/og'

// Ícone do app (favicon / aba). Gerado por código — marca "Flow" no accent laranja.
export const size = { width: 512, height: 512 }
export const contentType = 'image/png'

export default function Icon() {
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
          borderRadius: 104,
          color: '#fff',
          fontSize: 320,
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
