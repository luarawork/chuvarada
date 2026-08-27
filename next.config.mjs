import withPWAInit from "next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
});

// Corrige achado médio M5 da auditoria de segurança (24/07/2026,
// scripts/relatorio_vulnerabilidades.md): nenhum header de segurança
// estava configurado. CSP fica de fora por ora -- o mapa carrega tiles
// de basemaps.cartocdn.com e fontes/scripts do próprio Next, e definir
// uma política restritiva sem mapear todas as origens primeiro quebraria
// o mapa; melhor fazer isso depois do deploy, com as URLs de produção
// confirmadas.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel não aceita o nome NEXT_PUBLIC_CARTO_API_KEY (bloqueado no painel
  // por conter "PUBLIC"), então a variável lá se chama NEXT_CARTO_API_KEY
  // (sem o prefixo, logo não embutida automaticamente no bundle do
  // cliente). Esse mapeamento republica o valor sob o nome que
  // lib/constants.ts já lê (NEXT_PUBLIC_CARTO_API_KEY) -- o Next.js faz
  // substituição em tempo de build pra qualquer chave listada aqui,
  // client ou server, independente de prefixo.
  env: {
    NEXT_PUBLIC_CARTO_API_KEY: process.env.NEXT_CARTO_API_KEY,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default withPWA(nextConfig);
