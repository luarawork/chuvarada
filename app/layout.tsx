import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Inter } from "next/font/google";
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
    <html lang="pt-BR">
      <body
        className={`${plusJakarta.variable} ${inter.variable} font-body antialiased bg-brand-blue-deep`}
      >
        {children}
      </body>
    </html>
  );
}
