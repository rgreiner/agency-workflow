import type { MetadataRoute } from 'next'

// PWA: permite "adicionar à tela inicial" como app. theme/background no dark base.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Flow — One a One',
    short_name: 'Flow',
    description: 'Gestão de pauta, produção e mídia para agências.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0d1117',
    theme_color: '#0d1117',
    icons: [
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  }
}
