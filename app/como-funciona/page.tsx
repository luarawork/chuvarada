"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SuggestionModal } from "@/components/ui/SuggestionModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { LEVEL_EMOJI, RISK_COLORS, SCORE_THRESHOLDS } from "@/lib/constants";

const fmtScoreBr = (n: number) => n.toFixed(1).replace(".", ",");

// Fonte única dos 5 níveis pra esta página -- range calculado a partir dos
// mesmos SCORE_THRESHOLDS usados em lib/score.ts (não são faixas redondas
// tipo 1-2/3-4, os cortes reais são 3,0/5,0/6,5/8,0). "detail" é o texto
// mais longo da seção 03; "range"/"color"/"emoji" servem tanto o diagrama
// compacto da seção 02 quanto o card detalhado da seção 03.
const LEVELS = [
  {
    key: "normal",
    label: "Normal",
    range: `score < ${fmtScoreBr(SCORE_THRESHOLDS.ATTENTION)}`,
    color: RISK_COLORS.normal,
    emoji: LEVEL_EMOJI.normal,
    detail: "Condições sem indicadores significativos de risco hídrico. O monitoramento continua ativo.",
  },
  {
    key: "attention",
    label: "Atenção",
    range: `${fmtScoreBr(SCORE_THRESHOLDS.ATTENTION)} – ${fmtScoreBr(SCORE_THRESHOLDS.MODERATE)}`,
    color: RISK_COLORS.attention,
    emoji: LEVEL_EMOJI.attention,
    detail: "Algum indicador está acima do normal — chuva acumulando, terreno plano, proximidade de rio. Vale acompanhar.",
  },
  {
    key: "moderate",
    label: "Moderado",
    range: `${fmtScoreBr(SCORE_THRESHOLDS.MODERATE)} – ${fmtScoreBr(SCORE_THRESHOLDS.HIGH)}`,
    color: RISK_COLORS.moderate,
    emoji: LEVEL_EMOJI.moderate,
    detail: "Combinação de fatores que elevam o risco. Chuva significativa em área vulnerável.",
  },
  {
    key: "high",
    label: "Alto",
    range: `${fmtScoreBr(SCORE_THRESHOLDS.HIGH)} – ${fmtScoreBr(SCORE_THRESHOLDS.CRITICAL)}`,
    color: RISK_COLORS.high,
    emoji: LEVEL_EMOJI.high,
    detail: "Risco expressivo detectado. Múltiplos fatores desfavoráveis combinados — chuva intensa, solo saturado ou proximidade de rio.",
  },
  {
    key: "critical",
    label: "Crítico",
    range: `score > ${fmtScoreBr(SCORE_THRESHOLDS.CRITICAL)}`,
    color: RISK_COLORS.critical,
    emoji: LEVEL_EMOJI.critical,
    detail: "Nível máximo de risco calculado. Evento de alta intensidade detectado. Consulte os canais oficiais da Defesa Civil.",
  },
] as const;

// Pesos batem com VARIABLES de VariableCard.tsx (arquivo removido nesta
// revisão -- era usado só nesta página, ver relatório da sessão).
const VARIABLES = [
  { icon: "🌧️", label: "Pico de chuva (3h)", weight: 25 },
  { icon: "🌧️", label: "Chuva última hora", weight: 20 },
  { icon: "🌧️", label: "Chuva 72h", weight: 20 },
  { icon: "⛰️", label: "Terreno", weight: 15 },
  { icon: "🏞️", label: "Proximidade hídrica", weight: 12 },
  { icon: "🌊", label: "Maré", weight: 8 },
];

const AUTO_ALERTS = [
  "Mais de 50mm de chuva na última hora",
  "Maré acima de 80% combinada com chuva em zona costeira",
  "Mais de 100mm acumulados em 72h e qualquer chuva nova",
];

const SOURCE_STATUS_COLOR = { active: "#2a9d72", rollout: "#f0a500" } as const;

// Dado real do SourcesList.tsx anterior (arquivo removido nesta revisão --
// a tabela virou grid de cards; ver relatório da sessão). Relatos de
// usuários saiu desta lista de propósito -- ganhou nota própria abaixo do
// grid e uma seção inteira (05), não é uma "fonte de dados brutos" como as
// outras seis.
const SOURCES = [
  {
    icon: "🛰️",
    name: "MERGE/CPTEC",
    org: "INPE",
    description: "Precipitação em todo o Brasil, combinando satélite e pluviômetros",
    status: "active" as const,
  },
  {
    icon: "🌡️",
    name: "Open-Meteo",
    org: "Open-Meteo",
    description: "Vento, umidade, pressão e chuva horária",
    status: "active" as const,
  },
  {
    icon: "🏔️",
    name: "NASA SRTM",
    org: "NASA",
    description: "Altimetria do terreno com resolução de ~30 metros",
    status: "active" as const,
  },
  {
    icon: "🌊",
    name: "ANA/BHO",
    org: "Agência Nacional de Águas",
    description: "Rede hidrográfica nacional — rios, córregos e canais",
    status: "active" as const,
  },
  {
    icon: "🗺️",
    name: "IBGE Censo 2022",
    org: "IBGE",
    description: "Malha de bairros de todo o Brasil",
    status: "active" as const,
  },
  {
    icon: "🌊",
    name: "TideCheck",
    org: "UHSLC / FES2022",
    description: "Nível de maré real — 32 de 115 cidades costeiras já cobertas, as demais usam valor neutro",
    status: "rollout" as const,
    statusLabel: "Em rollout",
  },
];

const LIMITATIONS = [
  {
    title: "Sem dados de drenagem urbana",
    text: "Bueiros, galerias pluviais e a capacidade de escoamento de cada rua não existem como dado público estruturado no Brasil. Usamos hidrografia natural (rios e córregos) como aproximação.",
  },
  {
    title: "Maré ainda em rollout",
    text: "O serviço de tábua de marés do CPTEC está degradado desde 2018. Já substituímos por dado real via TideCheck, mas o rollout ainda está em andamento — 32 das 115 cidades costeiras já têm estação atribuída.",
  },
  {
    title: "Eventos muito localizados",
    text: "Chuvas convectivas em área menor que ~10km² podem ser subestimadas pelo modelo numérico. Os relatos de usuários ajudam a identificar esses casos.",
  },
  {
    title: "São Paulo, Campinas e Sorocaba",
    text: "O IBGE não disponibiliza limites de bairro pra essas cidades — usamos distritos administrativos, que cobrem áreas maiores.",
  },
  {
    title: "Pesos sem calibração regional",
    text: "Os pesos de cada variável foram definidos sem validação formal de hidrólogo. A estrutura pra calibração regional existe, mas os valores específicos por região ainda não foram ajustados.",
  },
];

const INSTALL_STEPS = [
  {
    title: "iPhone (Safari)",
    text: "Toque no ícone de compartilhar (□↑) na barra inferior → role até “Adicionar à Tela de Início” → toque em “Adicionar”.",
  },
  {
    title: "Android (Chrome)",
    text: "Toque nos três pontinhos (⋮) no canto superior direito → toque em “Adicionar à tela inicial” → confirme.",
  },
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 font-mono text-xs uppercase tracking-widest text-primary">{children}</p>;
}

function SectionIntro({
  title,
  description,
}: {
  title: string;
  description: React.ReactNode;
}) {
  return (
    <div className="mb-10">
      <h2 className="mb-3 text-3xl font-bold">{title}</h2>
      <p className="max-w-2xl text-base text-muted-foreground">{description}</p>
    </div>
  );
}

function SectionSeparator() {
  return <Separator className="mx-auto max-w-5xl opacity-30" />;
}

export default function ComoFuncionaPage() {
  const [suggestionOpen, setSuggestionOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="px-6 pt-8">
        <Button asChild variant="ghost" size="sm" className="h-auto gap-1 px-0 text-sm font-normal text-muted-foreground hover:bg-transparent hover:text-foreground hover:underline">
          <Link href="/">
            <ChevronLeft className="h-4 w-4" />
            Voltar para o mapa
          </Link>
        </Button>
      </div>

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <Eyebrow>Transparência total</Eyebrow>
        <h1 className="mb-6 text-4xl font-bold text-balance">Entenda como o Chuvarada calcula o risco do seu bairro</h1>
        <p className="text-lg text-muted-foreground">
          Dados públicos, cálculo aberto e limitações honestas. Aqui explicamos exatamente como funciona — e onde
          ainda precisamos melhorar.
        </p>
      </section>

      <SectionSeparator />

      {/* 01 — Como coletamos os dados */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <SectionIntro
          title="Como coletamos os dados"
          description="O Chuvarada combina seis fontes de dados públicos e gratuitos, atualizadas automaticamente, para calcular o risco de cada bairro."
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SOURCES.map((source) => (
            <Card key={source.name} className="border-border/50 p-6 shadow-none transition-colors hover:border-border">
              <div className="mb-3 text-2xl">{source.icon}</div>
              <div className="mb-2 flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{source.name}</p>
                <Badge
                  variant="outline"
                  className="shrink-0 border-none text-xs"
                  style={{
                    color: SOURCE_STATUS_COLOR[source.status],
                    backgroundColor: `${SOURCE_STATUS_COLOR[source.status]}1a`,
                  }}
                >
                  {source.status === "active" ? "Ativo" : source.statusLabel}
                </Badge>
              </div>
              <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground/70">{source.org}</p>
              <p className="text-sm text-muted-foreground">{source.description}</p>
            </Card>
          ))}
        </div>

        <div className="mt-6 flex items-start gap-3 rounded-lg border border-border/50 bg-muted/20 p-4">
          <span className="text-lg" aria-hidden="true">
            👥
          </span>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Relatos da comunidade</span> também alimentam o sistema —
            não como fonte primária, mas como validação do que o modelo calcula. Mais sobre isso na seção 05.
          </p>
        </div>
      </section>

      <SectionSeparator />

      {/* 02 — Como calculamos o risco */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <SectionIntro
          title="Como calculamos o risco"
          description="Seis variáveis são combinadas em um score de 1 a 10. Cada uma tem um peso diferente — quanto mais relevante para o risco de alagamento, maior o peso."
        />

        <div className="flex flex-col items-stretch gap-6 lg:flex-row lg:items-center lg:gap-4">
          <div className="flex w-full flex-col gap-3 lg:w-auto lg:min-w-[240px]">
            {VARIABLES.map((v) => (
              <div key={v.label} className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-4">
                <span className="text-lg" aria-hidden="true">
                  {v.icon}
                </span>
                <span className="flex-1 text-sm font-medium">{v.label}</span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{v.weight}%</span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-center gap-2 text-muted-foreground/50 lg:flex-col">
            <div className="hidden h-px w-12 bg-border/50 lg:block" />
            <span className="text-2xl">→</span>
            <div className="hidden h-px w-12 bg-border/50 lg:block" />
          </div>

          <Card className="shrink-0 border-primary/30 bg-primary/5 p-8 text-center shadow-none">
            <Eyebrow>Score</Eyebrow>
            <p className="mb-2 text-5xl font-bold tabular-nums">1–10</p>
            <p className="text-xs text-muted-foreground">Calculado a cada hora</p>
          </Card>

          <div className="flex items-center justify-center gap-2 text-muted-foreground/50 lg:flex-col">
            <div className="hidden h-px w-12 bg-border/50 lg:block" />
            <span className="text-2xl">→</span>
            <div className="hidden h-px w-12 bg-border/50 lg:block" />
          </div>

          <div className="flex w-full flex-col gap-3 lg:w-auto lg:min-w-[180px]">
            {LEVELS.map((level) => (
              <div
                key={level.key}
                className="flex min-h-[56px] items-center gap-3 rounded-lg border p-4"
                style={{ borderColor: `${level.color}40`, backgroundColor: `${level.color}10` }}
              >
                <div className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: level.color }} />
                <span className="flex-1 text-sm font-medium">{level.label}</span>
                <span className="font-mono text-xs text-muted-foreground">{level.range}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 rounded-lg border border-border/50 bg-muted/20 p-5">
          <p className="mb-2 text-sm font-medium">⚡ Regras automáticas</p>
          <p className="mb-2 text-sm text-muted-foreground">
            Algumas situações elevam o nível automaticamente para Crítico, independente do score calculado:
          </p>
          <ul className="ml-4 list-disc space-y-1 text-sm text-muted-foreground">
            {AUTO_ALERTS.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
      </section>

      <SectionSeparator />

      {/* 03 — O que cada nível significa */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <SectionIntro
          title="O que cada nível significa"
          description="Os níveis traduzem o score em linguagem direta. Cada um indica o que o modelo está detectando — não uma instrução de segurança."
        />

        <div className="flex flex-col gap-4">
          {LEVELS.map((level) => (
            <Card
              key={level.key}
              className="flex flex-col gap-4 border p-6 shadow-none sm:flex-row sm:items-center"
              style={{ borderColor: `${level.color}30`, backgroundColor: `${level.color}08` }}
            >
              <div className="flex shrink-0 items-center gap-4 sm:w-48">
                <div className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: level.color }} />
                <div>
                  <p className="font-semibold">{level.label}</p>
                  <p className="font-mono text-xs text-muted-foreground">Score {level.range}</p>
                </div>
              </div>
              <Separator orientation="vertical" className="hidden h-8 opacity-30 sm:block" />
              <p className="text-sm text-muted-foreground">{level.detail}</p>
            </Card>
          ))}
        </div>
      </section>

      <SectionSeparator />

      {/* 04 — Previsão de 7 dias */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <SectionIntro
          title="Previsão de 7 dias"
          description={
            <>
              Ao clicar em um bairro, você pode ver a previsão de risco para os próximos 7 dias. Ela usa dados do
              Open-Meteo combinados com as características físicas do bairro.
            </>
          }
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card className="border-border/50 p-6 shadow-none">
            <p className="mb-2 font-semibold">📡 Como é calculada</p>
            <p className="text-sm text-muted-foreground">
              Usa previsão meteorológica do Open-Meteo (modelos globais) combinada com as características
              permanentes do bairro — declividade, proximidade de rios e localização costeira.
            </p>
          </Card>
          <Card className="border-amber-500/20 bg-amber-500/5 p-6 shadow-none">
            <p className="mb-2 font-semibold">⚠️ Importante entender</p>
            <p className="text-sm text-muted-foreground">
              A previsão é diferente do monitoramento em tempo real. Quanto mais longe no tempo, maior a incerteza —
              especialmente para chuvas convectivas (pancadas rápidas e localizadas). Sempre consulte a Defesa Civil
              para decisões de segurança.
            </p>
          </Card>
        </div>
      </section>

      <SectionSeparator />

      {/* 05 — Relatos da comunidade */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <SectionIntro
          title="Relatos da comunidade"
          description="O dado calculado tem limites. O relato de quem está no local preenche o que o modelo não consegue ver."
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="border-border/50 p-6 shadow-none">
            <p className="mb-3 text-2xl">🧮</p>
            <p className="mb-2 font-semibold">O modelo calcula</p>
            <p className="text-sm text-muted-foreground">
              Score baseado em dados de satélite, terreno e hidrografia. Preciso para eventos de grande escala.
            </p>
          </Card>
          <Card className="border-border/50 p-6 shadow-none">
            <p className="mb-3 text-2xl">👥</p>
            <p className="mb-2 font-semibold">Você confirma</p>
            <p className="text-sm text-muted-foreground">
              Rua alagada, córrego transbordando. O sensor mais preciso é quem está no local — clique no mapa, escolha
              a gravidade e seu relato aparece pra outros usuários na hora.
            </p>
          </Card>
          <Card className="border-border/50 p-6 shadow-none">
            <p className="mb-3 text-2xl">📈</p>
            <p className="mb-2 font-semibold">O sistema aprende</p>
            <p className="text-sm text-muted-foreground">
              Quando relatos e modelo divergem, identificamos onde o cálculo precisa ser melhorado.
            </p>
          </Card>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Entre com uma conta para que seus relatos tenham mais peso na calibração.
        </p>
      </section>

      <SectionSeparator />

      {/* 06 — Limitações honestas */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <SectionIntro
          title="Limitações honestas"
          description="O Chuvarada é uma ferramenta de apoio, não de decisão. Estas são as limitações que você precisa conhecer."
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {LIMITATIONS.map((item) => (
            <Card key={item.title} className="border-amber-500/20 bg-amber-500/5 p-6 shadow-none">
              <p className="mb-2 text-sm font-semibold">⚠️ {item.title}</p>
              <p className="text-sm text-muted-foreground">{item.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <SectionSeparator />

      {/* 07 — Instalar como PWA */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <SectionIntro
          title="Instale no seu celular"
          description="Adicione o Chuvarada à tela inicial pra acessar mais rápido, como um app."
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {INSTALL_STEPS.map((step) => (
            <Card key={step.title} className="border-border/50 p-6 shadow-none">
              <p className="mb-2 font-semibold">{step.title}</p>
              <p className="text-sm text-muted-foreground">{step.text}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* CTA final */}
      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <SectionSeparator />
        <div className="mt-16">
          <Eyebrow>Pronto para usar</Eyebrow>
          <h2 className="mb-4 text-3xl font-bold">Ver o mapa agora</h2>
          <p className="mb-8 text-base text-muted-foreground">
            O Chuvarada é open source e sem fins lucrativos. Se quiser contribuir com conhecimento ou código, o
            projeto está aberto.
          </p>
          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/">Ver o mapa</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="https://github.com/luarawork/chuvarada" target="_blank" rel="noopener noreferrer">
                Ver no GitHub
              </a>
            </Button>
            <Button variant="outline" size="lg" onClick={() => setSuggestionOpen(true)}>
              Sugerir melhoria
            </Button>
          </div>
        </div>
      </section>

      {suggestionOpen && <SuggestionModal onClose={() => setSuggestionOpen(false)} />}
    </div>
  );
}
