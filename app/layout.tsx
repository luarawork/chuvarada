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
  description: "Mapa de risco de alagamento em tempo real para o Nordeste",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#2e7db8",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
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
