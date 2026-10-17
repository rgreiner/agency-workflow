import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * CSP sem nonce (a versão com nonce obriga TODA página a ser dinâmica — ver
 * node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 * Mesmo com 'unsafe-inline' ela já barra script de origem externa, embed de
 * plugin e enquadramento de terceiro.
 *
 * object-src/frame-src ficam em 'self' porque a aprovação do portal mostra o PDF
 * num <object> e o PdfViewer num <iframe>, ambos servidos por nós.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  // Só a própria origem: desde que o supabase-js do browser passou pelo proxy
  // /api/rest, nada no client fala com host externo. Isso fecha o caminho mais
  // simples de exfiltração num XSS — mandar o dado pra fora.
  `connect-src 'self'${isDev ? " ws: http://localhost:*" : ""}`,
  "object-src 'self'",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  /**
   * Aba aberta antes do deploy ficava MUDA: cada deploy troca os ids das Server
   * Actions, e o clique numa aba velha morria com "Failed to find Server Action"
   * no servidor e nada na tela (75 desses em 11/08, todos de uma aba de antes do
   * push). Com o deploymentId, o cliente compara o id na resposta e faz um
   * reload de verdade em vez de falhar em silêncio.
   *
   * SOURCE_COMMIT é o SHA que o Coolify injeta a cada build. Ausente (dev, build
   * local), fica undefined e nada muda.
   */
  deploymentId: process.env.SOURCE_COMMIT
    // No build do Dockerfile o Coolify não repassa o SOURCE_COMMIT (só ao container
    // rodando): sem esta saída o id sumia e a aba antiga voltava a falhar muda.
    // O standalone grava a config no server.js, então o id gerado no build é o
    // mesmo em execução — e muda a cada deploy, que é o que importa.
    || (process.env.NEXT_OUTPUT === "standalone" ? `build-${Date.now().toString(36)}` : undefined),

  /**
   * Otimizador de imagens DESLIGADO: o Flow não usa next/image, mas o endereço
   * /_next/image respondia mesmo assim — e era nele a falha crítica de execução
   * remota de código do Next 16.2 (auditoria de 17/10/2026). Com `unoptimized`,
   * o servidor devolve 404 nesse endereço.
   */
  images: { unoptimized: true },

  /**
   * `standalone` só no build do Dockerfile (NEXT_OUTPUT=standalone): a imagem
   * leva apenas o servidor e as dependências que ele usa. Fora dele (dev, build
   * local) fica o modo normal, que roda com `next start`.
   */
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),

  async headers() {
    return [
      {
        // O service worker não pode ficar preso em cache HTTP: versão velha de
        // SW é o bug mais chato de PWA (o navegador segura por até 24h).
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
      {
        // Ícones da marca (manifest, push, e-mail): mudam junto com a identidade,
        // não com o deploy. Um dia de cache + revalidação em segundo plano.
        source: "/icons/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
          },
          // HSTS: o Traefik já termina TLS e o domínio é 100% https.
          ...(isDev
            ? []
            : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
        ],
      },
    ];
  },
};

export default nextConfig;
