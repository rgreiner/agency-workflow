import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { ThemeApplier } from "@/components/layout/ThemeApplier";
import { PwaRegister } from "@/components/pwa/PwaRegister";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://flow.oneaone.com.br";
const DESCRIPTION = "Gestão de pauta, produção, mídia e financeiro para agências.";
// Tagline da identidade — é o que aparece em negrito no preview do WhatsApp/Slack.
const OG_TITLE = "Flow · Gestão em movimento";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "Flow",
  title: { default: "Flow — One a One", template: "%s · Flow" },
  description: DESCRIPTION,
  openGraph: {
    title: OG_TITLE,
    description: DESCRIPTION,
    siteName: "Flow",
    type: "website",
    locale: "pt_BR",
  },
  twitter: { card: "summary_large_image", title: OG_TITLE, description: DESCRIPTION },
  appleWebApp: { capable: true, title: "Flow", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // PWA instalado no iOS: com statusBarStyle black-translucent o conteúdo vai
  // até a borda da tela — o cover + safe-area (AppShell/Sidebar) evita que o
  // topo fique embaixo do relógio/notch.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    // Mesmo valor de --background do .dark (globals.css): a barra do sistema no
    // celular casa com o fundo do app em vez de puxar pro azul.
    { media: "(prefers-color-scheme: dark)", color: "#171513" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className="h-full" suppressHydrationWarning>
      <body className={`${GeistSans.className} h-full antialiased`}>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||(t!=='light'&&m)){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
        <ThemeApplier />
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
