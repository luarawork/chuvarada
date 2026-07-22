import Link from "next/link";
import { VariableCard } from "@/components/how-it-works/VariableCard";
import { RiskDiagram } from "@/components/how-it-works/RiskDiagram";
import { SourcesList } from "@/components/how-it-works/SourcesList";

const VARIABLES = [
  {
    emoji: "🌧",
    title: "Pico de chuva (3h)",
    weight: 0.25,
    description:
      "O maior volume de chuva em uma hora só, dentro das últimas 3 horas — não apenas o instante atual. Um pico forte de 30mm/h que já passou ainda pesa no risco, porque picos de chuva forte costumam durar menos que a hora entre atualizações do mapa. Vem do produto MERGE do CPTEC/INPE (satélite + pluviômetros reais) quando disponível; usa a Open-Meteo como alternativa quando não.",
  },
  {
    emoji: "🌧",
    title: "Chuva na última hora",
    weight: 0.2,
    description: "Volume total de chuva na última hora, direto da WeatherAPI.com. Mesmo sem ser intensa, chuva contínua acumula.",
  },
  {
    emoji: "🌧",
    title: "Chuva nos últimos 3 dias",
    weight: 0.2,
    description:
      "Se já choveu muito nos últimos dias, o solo está saturado e não absorve mais água. Qualquer nova chuva vai direto para as ruas. Vem do produto MERGE do CPTEC/INPE (satélite + pluviômetros reais) quando disponível; usa a Open-Meteo como alternativa quando não.",
  },
  {
    emoji: "⛰",
    title: "Terreno",
    weight: 0.15,
    description:
      "Áreas baixas acumulam água com muito mais facilidade do que áreas elevadas. Usamos dados de altimetria da NASA para mapear a declividade de cada bairro.",
  },
  {
    emoji: "🏞",
    title: "Proximidade de rios e canais",
    weight: 0.12,
    description:
      "Bairros próximos a rios, canais e córregos têm maior risco de inundação quando o volume de água supera a capacidade de escoamento.",
  },
  {
    emoji: "🌊",
    title: "Maré",
    weight: 0.08,
    description:
      "Em cidades costeiras como Salvador e Recife, a maré alta reduz a capacidade de escoamento das águas pluviais para o mar. Usamos dados oficiais da Marinha do Brasil. " +
      "A variável de maré é considerada apenas em municípios com estação de monitoramento da Marinha do Brasil nas proximidades. Onde não há estação, o peso é redistribuído entre as demais variáveis.",
  },
];

export default function ComoFuncionaPage() {
  return (
    <div className="min-h-screen bg-brand-gray-light">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Link href="/" className="text-sm text-brand-blue-mid hover:underline">
          ← Voltar para o mapa
        </Link>

        {/* Hero */}
        <header className="mt-6">
          <h1 className="font-heading text-3xl font-bold text-brand-blue-deep md:text-4xl">
            Como o Chuvarada funciona
          </h1>
          <p className="mt-2 text-lg text-brand-gray-urban/80">
            Transparência total sobre como calculamos o risco de alagamento na sua cidade.
          </p>
        </header>

        {/* Introdução */}
        <section className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
          <p className="leading-relaxed text-brand-gray-urban">
            O Chuvarada cruza dados públicos disponibilizados pelo governo para estimar, em tempo
            real, o risco de alagamento por bairro em cidades de 16 estados brasileiros. Nosso modelo não é
            perfeito — nenhum é — mas é transparente, honesto e atualizado a cada hora. Use
            como apoio para suas decisões. Não substitui alertas oficiais da Defesa Civil.
          </p>
        </section>

        {/* O que analisamos */}
        <section className="mt-10">
          <h2 className="font-heading text-2xl font-bold text-brand-blue-deep">O que analisamos</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {VARIABLES.map((v) => (
              <VariableCard key={v.title} {...v} />
            ))}
          </div>
          <p className="mt-4 text-sm text-brand-gray-urban/70">
            Dados de precipitação acumulada fornecidos pelo produto MERGE do CPTEC/INPE, que combina
            estimativas do satélite GPM/IMERG com a rede de pluviômetros do Brasil. Vento, umidade,
            pressão e a chuva da última hora vêm da WeatherAPI.com.
          </p>
        </section>

        {/* Como calculamos */}
        <section className="mt-10">
          <h2 className="font-heading text-2xl font-bold text-brand-blue-deep">
            Como calculamos o risco
          </h2>
          <div className="mt-4">
            <RiskDiagram />
          </div>

          <div className="mt-6 space-y-2 text-sm">
            <p className="rounded-xl bg-brand-green-water/10 px-4 py-3 text-brand-green-water">
              🟢 <strong>Normal (0.0 – 0.3):</strong> Condições seguras. Monitore se houver chuva
              prevista.
            </p>
            <p className="rounded-xl bg-brand-yellow-warn/10 px-4 py-3 text-brand-yellow-warn">
              🟡 <strong>Atenção (0.3 – 0.6):</strong> Risco moderado. Evite áreas conhecidas por
              alagamento.
            </p>
            <p className="rounded-xl bg-brand-red-alert/10 px-4 py-3 text-brand-red-alert">
              🔴 <strong>Crítico (0.6 – 1.0):</strong> Risco alto. Evite áreas alagáveis e fique em
              local seguro.
            </p>
          </div>
        </section>

        {/* Alertas automáticos */}
        <section className="mt-10 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="font-heading text-xl font-bold text-brand-blue-deep">
            Alertas automáticos
          </h2>
          <p className="mt-2 text-brand-gray-urban/80">
            Algumas situações entram automaticamente em nível Crítico, independente do score
            calculado:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-brand-gray-urban">
            <li>Chuva acima de 50mm na última hora</li>
            <li>Maré alta (acima de 80% do máximo) com chuva em zona costeira</li>
            <li>Solo saturado (mais de 100mm em 3 dias) com qualquer nova chuva</li>
          </ul>
        </section>

        {/* Limitações */}
        <section className="mt-10 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="font-heading text-xl font-bold text-brand-blue-deep">
            O que não temos — e por quê isso importa
          </h2>
          <p className="mt-2 leading-relaxed text-brand-gray-urban/80">
            Não dispomos de dados públicos sobre bueiros e galerias pluviais. Essas informações
            não estão disponíveis publicamente em nenhuma capital nordestina mapeada. Por isso
            usamos hidrografia natural (rios, canais, córregos) e a declividade do terreno como
            aproximação da capacidade de escoamento urbano. O modelo é conservador: prefere
            alertar quando o risco pode ser menor do que silenciar quando o risco é real.
          </p>

          <h3 className="mt-5 font-heading text-base font-semibold text-brand-gray-urban">
            Níveis de cobertura por cidade
          </h3>
          <ul className="mt-2 space-y-1 text-sm text-brand-gray-urban">
            <li>
              <strong>Salvador, Recife, Natal:</strong> modelo completo com todas as variáveis
            </li>
            <li>
              <strong>Fortaleza, Maceió, Aracaju, João Pessoa:</strong> modelo com hidrografia
              regional (sem dados municipais)
            </li>
            <li>
              <strong>São Luís, Teresina:</strong> modelo baseado apenas em clima e terreno
            </li>
          </ul>
        </section>

        {/* Fontes */}
        <section className="mt-10">
          <h2 className="font-heading text-2xl font-bold text-brand-blue-deep">Fontes de dados</h2>
          <div className="mt-4 rounded-2xl bg-white p-6 shadow-sm">
            <SourcesList />
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-12 border-t border-brand-gray-urban/10 pt-6 pb-4 text-sm text-brand-gray-urban/70">
          O Chuvarada complementa a informação pública, colocando dados abertos do governo nas
          mãos do cidadão comum. Não é crítica ao poder público — é parceria.
        </footer>
      </div>
    </div>
  );
}
