import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Origem do PostgREST — o browser fala DIRETO com ele (supabase-js como cliente
 * HTTP), então ela precisa estar no connect-src ou o app inteiro para de
 * carregar dado. Vem do env; sem env, cai pro `https:` genérico de propósito:
 * CSP quebrada derruba a aplicação, e um connect-src frouxo é menos pior.
 */
function apiOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  } catch {
    return "https:";
  }
}

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
  `connect-src 'self' ${apiOrigin()}${isDev ? " ws: http://localhost:*" : ""}`,
  "object-src 'self'",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  // typecheck já roda ANTES de todo push (fluxo do projeto); refazê-lo dentro do
  // `next build` do Coolify só duplica trabalho. (Next 16 já não roda ESLint no build.)
  typescript: { ignoreBuildErrors: true },

  async headers() {
    return [
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
