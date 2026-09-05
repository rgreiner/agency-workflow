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
  deploymentId: process.env.SOURCE_COMMIT || undefined,

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
