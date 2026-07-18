// Explicações em linguagem simples pros botões de "?" do painel de bairro —
// mesmo tom direto e humano da página /como-funciona, sem jargão técnico.
export const METRIC_INFO = {
  rainIntensity: {
    title: "Intensidade da chuva",
    description:
      "Quanto está chovendo agora, em milímetros por hora. Uma chuva forte concentrada em pouco tempo pesa mais no risco do que a mesma quantidade espalhada ao longo do dia.",
  },
  rain1h: {
    title: "Chuva na última hora",
    description:
      "Volume total que caiu na última hora. Mesmo sem ser uma chuva forte, a chuva contínua vai acumulando.",
  },
  rain72h: {
    title: "Chuva nos últimos 3 dias",
    description:
      "Quanto choveu no bairro nos últimos 3 dias. Solo encharcado não absorve mais água, então uma chuva nova vai direto pras ruas.",
  },
  terrain: {
    title: "Terreno",
    description:
      "Áreas baixas acumulam água com muito mais facilidade do que áreas elevadas. Usamos dados de altimetria da NASA (SRTM) pra medir a declividade do bairro.",
  },
  hydroProximity: {
    title: "Proximidade hídrica",
    description:
      "Quão perto o bairro está de rios, canais ou córregos. Quanto mais perto, maior o risco quando o volume de água supera a capacidade de escoamento.",
  },
  tide: {
    title: "Maré",
    description:
      "Em cidades costeiras, a maré alta reduz a capacidade de escoamento da água da chuva pro mar. Dado oficial da Marinha do Brasil via CPTEC/INPE.",
  },
  wind: {
    title: "Vento",
    description: "Velocidade do vento agora, em quilômetros por hora.",
  },
  humidity: {
    title: "Umidade",
    description: "Umidade relativa do ar agora, em porcentagem.",
  },
  pressure: {
    title: "Pressão atmosférica",
    description:
      "Pressão do ar agora e sua tendência. Quando a pressão está caindo, geralmente é sinal de que uma frente de chuva está se aproximando.",
  },
  forecast: {
    title: "Previsão do tempo",
    description:
      "Condição atual e previsão pras próximas 12 horas, direto do OpenWeatherMap. É só uma previsão — o índice de risco acima já leva em conta os dados observados, não previstos.",
  },
} as const;

export type MetricInfoKey = keyof typeof METRIC_INFO;
