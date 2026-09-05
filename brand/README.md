# Identidade do Flow

Fontes da marca (setembro/2026). Nada daqui é servido: os arquivos que o app usa
são **gerados** a partir destes por `npm run brand:gerar`
(`scripts/brand/gerar-assets.mjs`). Trocou a identidade? Substitua a fonte, rode
o script, confira a saída e commite tudo junto.

| Arquivo | O que é | Requisitos |
| --- | --- | --- |
| `flow-icone.png` | Ícone: quadrado charcoal arredondado (F branco + onda laranja) sobre **preto puro**, sem alfa | Quadrado, ≥ 1024 px de lado; fora do quadrado tem que ser preto puro (o script mede o quadrado por aí) |
| `flow-og.png` | Arte de compartilhamento (link colado em WhatsApp/Slack/LinkedIn) | Paisagem, ≥ 1200 px de largura; o script recorta o centro para 1,91:1 — deixe folga em cima/embaixo |
| `flow-identidade.png` | Prancha de referência (variações, cores, mockups) | Só consulta |

Cores medidas na fonte: charcoal do ícone `#0f0f0f`, laranja `#ff6a00` → `#ff8a00`
(o accent do app continua sendo o da org, `#f97316` por padrão — não mudou).
Tagline: **Gestão em movimento**.

## O que sai do gerador

| Saída | Tamanho | Onde é usado |
| --- | --- | --- |
| `src/app/favicon.ico` | 16 / 32 / 48 | `/favicon.ico` — navegadores antigos, bots, Slack |
| `src/app/icon.png` | 512, cantos transparentes | `<link rel="icon">` (aba), resultado do Google |
| `src/app/apple-icon.png` | 180, full-bleed | `<link rel="apple-touch-icon">` — tela inicial do iOS (o iOS aplica a máscara) |
| `src/app/opengraph-image.jpg` (+ `.alt.txt`) | 1200 × 630, JPEG < 300 KB | `og:image` — WhatsApp corta o preview grande acima de ~300 KB, por isso JPEG |
| `public/icons/icon-{192,512}.png` | cantos transparentes | manifest `purpose: any`; marca dentro do app (`FlowMark`) |
| `public/icons/maskable-{192,512}.png` | full-bleed, arte na zona segura de 80 % | manifest `purpose: maskable` — launcher do Android recorta em círculo/squircle |
| `public/icons/apple-touch-icon.png` | 180, full-bleed | cópia para quem procura em `/icons` |
| `public/icons/mark-96.png` | 96, cantos transparentes | cabeçalho dos e-mails |
| `public/icons/badge-96.png` | 96, F branco em alfa | `badge` da notificação push no Android (o sistema pinta a silhueta) |

O Next serve os arquivos de `src/app` com hash na query (`/icon.png?abc`), então
cache nunca segura uma versão velha. Os de `public/icons` têm 1 dia de cache
(`next.config.ts`) — mudou a identidade, mude também o nome do arquivo se quiser
que todo mundo veja na hora.

## O que NÃO existe (e por quê)

- **SVG da marca**: a identidade veio em bitmap. Sem vetor não há `icon.svg`,
  `mask-icon` do Safari (pinned tab) nem ícone monocromático do manifest.
- **Splash do iOS** (`apple-touch-startup-image`): exige uma imagem por modelo de
  aparelho. Sem isso o iOS abre com fundo liso, que já casa com o charcoal.
- **Screenshots no manifest**: deixam o diálogo de instalação do Android/desktop
  mais rico, mas precisam de prints reais do app em 2 proporções.
