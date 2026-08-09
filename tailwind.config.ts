import type { Config } from "tailwindcss";

// darkMode:"class" + as cores hsl(var(--...)) abaixo são o setup padrão do
// shadcn/ui (Etapa 1 da migração, 10/08/2026) -- o Chuvarada é sempre escuro
// (não é toggle de usuário), então a classe "dark" fica fixa no <html> (ver
// app/layout.tsx) em vez de alternar em runtime.
const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Paleta original do Chuvarada -- mantida como extensão (não
        // removida): usada em quase todo componente existente via classe
        // literal (bg-brand-blue-mid etc.) e via style={{...}} inline com o
        // mesmo hex. As 5 cores de risco (RISK_COLORS em lib/constants.ts)
        // não vivem aqui -- são semânticas e calculadas em runtime, fora do
        // escopo de tokens estáticos do Tailwind.
        brand: {
          "blue-deep": "#1a3a5c",
          "blue-mid": "#2e7db8",
          "blue-light": "#a8d4f0",
          "green-water": "#2a9d72",
          "gray-urban": "#4a5568",
          "gray-light": "#f0f4f8",
          "red-alert": "#d64045",
          "yellow-warn": "#ffe066",
          "orange-alert": "#d95f02",
          "purple-critical": "#7b2d8b",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
      fontFamily: {
        heading: ["var(--font-plus-jakarta)", "sans-serif"],
        body: ["var(--font-inter)", "sans-serif"],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
