import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { ThemeApplier } from "@/components/layout/ThemeApplier";
import { PwaRegister } from "@/components/pwa/PwaRegister";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://flow.oneaone.com.br";
const DESCRIPTION = "Gestão de pauta, produção e mídia para agências.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "Flow",
  title: { default: "Flow — One a One", template: "%s · Flow" },
  description: DESCRIPTION,
  openGraph: {
    title: "Flow",
    description: DESCRIPTION,
    siteName: "Flow",
    type: "website",
    locale: "pt_BR",
  },
  twitter: { card: "summary_large_image", title: "Flow", description: DESCRIPTION },
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
    { media: "(prefers-color-scheme: dark)", color: "#0d1117" },
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
