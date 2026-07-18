import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        brand: {
          "blue-deep": "#1a3a5c",
          "blue-mid": "#2e7db8",
          "blue-light": "#a8d4f0",
          "green-water": "#2a9d72",
          "gray-urban": "#4a5568",
          "gray-light": "#f0f4f8",
          "red-alert": "#d64045",
          "yellow-warn": "#f0a500",
        },
      },
      fontFamily: {
        heading: ["var(--font-plus-jakarta)", "sans-serif"],
        body: ["var(--font-inter)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
