const VARIABLES = [
  "🌧 Intensidade da chuva",
  "🌧 Chuva última hora",
  "🌧 Chuva 72h",
  "⛰ Terreno",
  "🏞 Proximidade hídrica",
  "🌊 Maré",
];

export function RiskDiagram() {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="flex flex-col items-stretch gap-4 md:flex-row md:items-center">
        <div className="flex flex-col gap-2">
          {VARIABLES.map((v) => (
            <div
              key={v}
              className="rounded-lg bg-brand-gray-light px-3 py-2 text-sm text-brand-gray-urban"
            >
              {v}
            </div>
          ))}
        </div>

        <div className="flex justify-center text-2xl text-brand-blue-mid md:rotate-0">→</div>

        <div className="flex items-center justify-center rounded-xl bg-brand-blue-mid/10 px-6 py-4 text-center">
          <span className="font-heading text-sm font-semibold text-brand-blue-mid">
            Índice de risco
            <br />
            0.0 – 1.0
          </span>
        </div>

        <div className="flex justify-center text-2xl text-brand-blue-mid">→</div>

        <div className="flex flex-col gap-2 text-sm">
          <span className="rounded-lg bg-brand-green-water/10 px-3 py-2 text-brand-green-water">
            🟢 Normal
          </span>
          <span className="rounded-lg bg-brand-yellow-warn/10 px-3 py-2 text-brand-yellow-warn">
            🟡 Atenção
          </span>
          <span className="rounded-lg bg-brand-red-alert/10 px-3 py-2 text-brand-red-alert">
            🔴 Crítico
          </span>
        </div>
      </div>
    </div>
  );
}
