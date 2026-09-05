import type { MetadataRoute } from 'next'

// PWA: permite "adicionar à tela inicial" como app.
// Ícones vêm de public/icons (gerados por `npm run brand:gerar` a partir de brand/):
//   any      = quadrado arredondado com cantos transparentes (aba, instalação, desktop)
//   maskable = full-bleed charcoal com a arte na zona segura (Android recorta em círculo/squircle)
// background_color = o charcoal do próprio ícone, pra ele "sumir" no splash do Android;
// theme_color = fundo do tema escuro do app (o <meta theme-color> da página, que é
// por tema, vence este valor no navegador).
// Os atalhos (segurar o ícone no Android/iOS) passam por /ir/* porque o manifest é
// estático e não conhece o slug da org — a rota resolve e redireciona.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Flow — One a One',
    short_name: 'Flow',
    description: 'Gestão em movimento: pauta, produção, mídia e financeiro da agência.',
    lang: 'pt-BR',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0f0f0f',
    theme_color: '#171513',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Bater ponto',
        short_name: 'Ponto',
        url: '/ir/ponto',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Minha pauta',
        short_name: 'Pauta',
        url: '/ir/pauta',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  }
}
