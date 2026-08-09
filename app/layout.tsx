import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { Toaster } from "@/components/ui/toaster";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Chuvarada",
  description: "Mapa de risco de alagamento em tempo real no Brasil",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#2e7db8",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // Sem isso, env(safe-area-inset-bottom) é garantido 0 em qualquer
  // navegador (só passa a refletir a área real -- barra de gestos do
  // Android, home indicator do iOS -- quando a página declara viewport-fit:
  // cover). O padding-bottom do DetailPanel (ver components/panel/
  // DetailPanel.tsx) usa max(env(safe-area-inset-bottom), 16px) faz tempo,
  // mas sem isso aqui ele sempre resolvia pro fallback fixo de 16px, nunca
  // reagindo à área de verdade do aparelho.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // O Chuvarada é sempre escuro -- não é um toggle de usuário (o
    // LayerToggle alterna o TILE do mapa, não o tema da UI). "dark" fixo
    // aqui em vez de um data-attribute/context é o padrão do shadcn/ui pra
    // apps sem light mode: as CSS variables de :root (globals.css) já
    // definem o único tema que existe.
    <html lang="pt-BR" className="dark">
      <body
        className={`${plusJakarta.variable} ${inter.variable} font-body antialiased`}
      >
        {children}
        {/* Nenhuma feature usa toast hoje (confirmado via grep antes de
            adicionar) -- provisionado aqui só porque a Etapa 1 pede
            explicitamente, pra já existir quando alguma feature futura
            precisar (ex: erro de submit num modal, confirmação de ação). */}
        <Toaster />
        <Analytics />
      </body>
    </html>
  );
}
