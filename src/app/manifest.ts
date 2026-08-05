import type { MetadataRoute } from 'next'

// PWA: permite "adicionar à tela inicial" como app. theme/background no dark base.
// Os atalhos (segurar o ícone no Android/iOS) passam por /ir/* porque o manifest é
// estático e não conhece o slug da org — a rota resolve e redireciona.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Flow — One a One',
    short_name: 'Flow',
    description: 'Gestão de pauta, produção e mídia para agências.',
    lang: 'pt-BR',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0d1117',
    theme_color: '#0d1117',
    icons: [
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
    shortcuts: [
      {
        name: 'Bater ponto',
        short_name: 'Ponto',
        url: '/ir/ponto',
        icons: [{ src: '/icon', sizes: '512x512', type: 'image/png' }],
      },
      {
        name: 'Minha pauta',
        short_name: 'Pauta',
        url: '/ir/pauta',
        icons: [{ src: '/icon', sizes: '512x512', type: 'image/png' }],
      },
    ],
  }
}
