"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { VariableCard } from "@/components/how-it-works/VariableCard";
import { RiskDiagram } from "@/components/how-it-works/RiskDiagram";
import { SourcesList } from "@/components/how-it-works/SourcesList";
import { SuggestionModal } from "@/components/ui/SuggestionModal";

const PILLS = [
  { icon: "🕐", label: "Atualizado a cada hora" },
  { icon: "🗺️", label: "Brasil inteiro" },
  { icon: "📊", label: "Dados públicos" },
];

const VARIABLES = [
  {
    emoji: "🌧️",
    title: "Pico de chuva nas últimas 3h",
    weight: 0.25,
    description:
      "Capturamos o maior valor de precipitação horária das últimas 3 horas. Isso evita perder picos de chuva rápidos que duram menos que nosso intervalo de atualização.",
  },
  {
    emoji: "🌧️",
    title: "Chuva na última hora",
    weight: 0.2,
    description: "Volume total de chuva na última hora. Mesmo sem picos intensos, chuva contínua acumula e satura o solo.",
  },
  {
    emoji: "🌧️",
    title: "Chuva acumulada em 72h",
    weight: 0.2,
    description: "Se já choveu muito nos últimos 3 dias, o solo está saturado. Qualquer chuva nova vai direto para as ruas.",
  },
  {
    emoji: "⛰️",
    title: "Terreno",
    weight: 0.15,
    description: "Áreas baixas acumulam água com muito mais facilidade. Usamos dados de altimetria da NASA com resolução de ~30m.",
  },
  {
    emoji: "🏞️",
    title: "Proximidade de rios e canais",
    weight: 0.12,
    description: "Bairros próximos a rios, canais e córregos têm maior risco quando o volume d'água supera a capacidade de escoamento.",
  },
  {
    emoji: "🌊",
    title: "Maré",
    weight: 0.08,
    description: "Em cidades costeiras, maré alta reduz a capacidade de escoamento para o mar. Disponível onde há estação de monitoramento.",
  },
];

const LEVELS = [
  { emoji: "🟢", label: "Normal", range: "score < 0,30", text: "Condições seguras", color: "#2a9d72" },
  { emoji: "🟡", label: "Atenção", range: "0,30 – 0,60", text: "Fique atento, evite áreas de risco", color: "#f0a500" },
  { emoji: "🔴", label: "Crítico", range: "score > 0,60", text: "Evite áreas alagáveis agora", color: "#d64045" },
];

const AUTO_ALERTS = [
  { emoji: "⚡", title: "Chuva extrema", text: "Mais de 50mm na última hora dispara alerta crítico independente do score." },
  { emoji: "🌊", title: "Maré + chuva", text: "Maré acima de 80% + chuva em zona costeira = crítico automático." },
  { emoji: "💧", title: "Solo saturado", text: "Mais de 100mm em 3 dias + qualquer chuva nova = crítico automático." },
];

const REPORT_STEPS = [
  { emoji: "📍", text: "Clique no mapa onde está o alagamento" },
  { emoji: "📊", text: "Escolha a gravidade (leve / moderado / grave)" },
  { emoji: "✅", text: "Seu relato aparece para outros usuários" },
];

const LIMITATIONS = [
  {
    emoji: "⚠️",
    title: "Sem dados de bueiros",
    text: "Informações sobre bueiros e galerias pluviais não estão disponíveis publicamente no Brasil. Usamos hidrografia natural como aproximação.",
  },
  {
    emoji: "⚠️",
    title: "Maré temporariamente indisponível",
    text: "O serviço de tábua de marés do CPTEC está degradado. Estamos usando valor neutro enquanto investigamos alternativas.",
  },
  {
    emoji: "⚠️",
    title: "Eventos muito localizados",
    text: "Chuvas convectivas em área menor que ~10km² podem ser subestimadas pelo modelo numérico. Os relatos de usuários ajudam a identificar esses casos.",
  },
  {
    emoji: "⚠️",
    title: "São Paulo, Campinas e Sorocaba",
    text: "O IBGE não disponibiliza bairros para essas cidades — usamos distritos administrativos, que cobrem áreas maiores.",
  },
];

const CARD_STYLE = { backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.2)" };

function FadeInSection({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className={className}
      style={style}
    >
      {children}
    </motion.section>
  );
}

export default function ComoFuncionaPage() {
  const [suggestionOpen, setSuggestionOpen] = useState(false);

  return (
    <div style={{ backgroundColor: "#0d1b2a", color: "#f0f4f8" }} className="min-h-dvh">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/" className="text-sm hover:underline" style={{ color: "#a8d4f0" }}>
          ← Voltar para o mapa
        </Link>

        {/* Hero */}
        <header className="mt-8 text-center">
          <h1 className="font-heading text-3xl font-bold md:text-4xl">Como o Chuvarada funciona</h1>
          <p className="mx-auto mt-3 max-w-xl text-base md:text-lg" style={{ color: "#a8d4f0" }}>
            Transparência total sobre como estimamos o risco de alagamento na sua cidade.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {PILLS.map((pill) => (
              <span
                key={pill.label}
                className="flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium backdrop-blur-sm"
                style={CARD_STYLE}
              >
                <span>{pill.icon}</span>
                {pill.label}
              </span>
            ))}
          </div>
        </header>

        {/* O que analisamos */}
        <FadeInSection className="mt-14">
          <h2 className="font-heading text-2xl font-bold">O que analisamos</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {VARIABLES.map((v) => (
              <VariableCard key={v.title} {...v} />
            ))}
          </div>
        </FadeInSection>

        {/* Como calculamos */}
        <FadeInSection className="mt-14 rounded-2xl px-1 py-8" style={{ backgroundColor: "rgba(46, 125, 184, 0.05)" }}>
          <h2 className="font-heading text-2xl font-bold">Como calculamos o risco</h2>
          <div className="mt-5">
            <RiskDiagram />
          </div>

          <div className="mt-6 space-y-2 text-sm">
            {LEVELS.map((level) => (
              <p
                key={level.label}
                className="rounded-xl px-4 py-3"
                style={{ backgroundColor: `${level.color}1f`, color: level.color }}
              >
                {level.emoji} <strong>{level.label}</strong> ({level.range}) — {level.text}
              </p>
            ))}
          </div>
        </FadeInSection>

        {/* Alertas automáticos */}
        <FadeInSection className="mt-14">
          <h2 className="font-heading text-2xl font-bold">Alertas automáticos</h2>
          <p className="mt-2 text-sm" style={{ color: "#a8d4f0" }}>
            Algumas situações entram automaticamente em nível crítico, independente do score calculado.
          </p>
          <div className="mt-5 flex gap-4 overflow-x-auto pb-2 md:grid md:grid-cols-3 md:overflow-visible">
            {AUTO_ALERTS.map((alert) => (
              <div
                key={alert.title}
                className="w-64 shrink-0 rounded-2xl border p-5 backdrop-blur-sm md:w-auto"
                style={CARD_STYLE}
              >
                <span className="text-2xl">{alert.emoji}</span>
                <h3 className="mt-2 font-heading text-base font-semibold">{alert.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "#a8d4f0" }}>
                  {alert.text}
                </p>
              </div>
            ))}
          </div>
        </FadeInSection>

        {/* Fontes de dados */}
        <FadeInSection className="mt-14 rounded-2xl px-1 py-8" style={{ backgroundColor: "rgba(46, 125, 184, 0.05)" }}>
          <h2 className="font-heading text-2xl font-bold">Fontes de dados</h2>
          <div className="mt-5 rounded-2xl border p-5 backdrop-blur-sm" style={CARD_STYLE}>
            <SourcesList />
          </div>
        </FadeInSection>

        {/* Relatos de usuários */}
        <FadeInSection className="mt-14">
          <h2 className="font-heading text-2xl font-bold">Você também pode contribuir</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: "#a8d4f0" }}>
            Quando você reporta um alagamento no mapa, seu relato é cruzado com os dados do modelo.
            Isso nos ajuda a calibrar o Chuvarada para ser cada vez mais preciso na sua região.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            {REPORT_STEPS.map((step, i) => (
              <div key={step.text} className="rounded-2xl border p-5 text-center backdrop-blur-sm" style={CARD_STYLE}>
                <span className="text-2xl">{step.emoji}</span>
                <p className="mt-2 text-xs font-medium uppercase tracking-wide" style={{ color: "#2e7db8" }}>
                  Passo {i + 1}
                </p>
                <p className="mt-1 text-sm leading-relaxed">{step.text}</p>
              </div>
            ))}
          </div>

          <p className="mt-4 text-xs" style={{ color: "#a8d4f0" }}>
            Relatos expiram automaticamente. Entre com uma conta para que seus relatos tenham mais
            peso na calibração.
          </p>
        </FadeInSection>

        {/* Limitações honestas */}
        <FadeInSection className="mt-14">
          <h2 className="font-heading text-2xl font-bold">Limitações honestas</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {LIMITATIONS.map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border p-5 backdrop-blur-sm"
                style={{ backgroundColor: "rgba(240, 165, 0, 0.06)", borderColor: "rgba(240, 165, 0, 0.25)" }}
              >
                <span className="text-xl">{item.emoji}</span>
                <h3 className="mt-1.5 font-heading text-sm font-semibold">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "#a8d4f0" }}>
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </FadeInSection>

        {/* Footer */}
        <footer className="mt-16 border-t pt-8 pb-6 text-center" style={{ borderColor: "rgba(46, 125, 184, 0.2)" }}>
          <p className="mx-auto max-w-md text-sm leading-relaxed" style={{ color: "#a8d4f0" }}>
            O Chuvarada complementa a informação pública, colocando dados abertos do governo nas
            mãos do cidadão comum.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <a
              href="https://github.com/luarawork/chuvarada"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border px-4 py-2 text-sm font-medium backdrop-blur-sm hover:bg-white/5"
              style={CARD_STYLE}
            >
              Ver no GitHub
            </a>
            <button
              onClick={() => setSuggestionOpen(true)}
              className="rounded-full bg-brand-blue-mid px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue-deep"
            >
              Sugerir melhoria
            </button>
          </div>
        </footer>
      </div>

      {suggestionOpen && <SuggestionModal onClose={() => setSuggestionOpen(false)} />}
    </div>
  );
}
