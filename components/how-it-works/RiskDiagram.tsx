const VARIABLES = [
  "🌧️ Pico de chuva (3h)",
  "🌧️ Chuva última hora",
  "🌧️ Chuva 72h",
  "⛰️ Terreno",
  "🏞️ Proximidade hídrica",
  "🌊 Maré",
];

export function RiskDiagram() {
  return (
    <div
      className="rounded-2xl border p-6 backdrop-blur-sm"
      style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.2)" }}
    >
      <div className="flex flex-col items-stretch gap-4 md:flex-row md:items-center">
        <div className="flex flex-col gap-2">
          {VARIABLES.map((v) => (
            <div
              key={v}
              className="rounded-lg px-3 py-2 text-sm"
              style={{ backgroundColor: "rgba(240, 244, 248, 0.06)", color: "#a8d4f0" }}
            >
              {v}
            </div>
          ))}
        </div>

        <div className="flex justify-center text-2xl" style={{ color: "#2e7db8" }}>
          →
        </div>

        <div
          className="flex items-center justify-center rounded-xl px-6 py-4 text-center"
          style={{ backgroundColor: "rgba(46, 125, 184, 0.15)" }}
        >
          <span className="font-heading text-sm font-semibold" style={{ color: "#f0f4f8" }}>
            Score
            <br />
            0.0 – 1.0
          </span>
        </div>

        <div className="flex justify-center text-2xl" style={{ color: "#2e7db8" }}>
          →
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <span className="rounded-lg px-3 py-2" style={{ backgroundColor: "rgba(42, 157, 114, 0.12)", color: "#2a9d72" }}>
            🟢 Normal
          </span>
          <span className="rounded-lg px-3 py-2" style={{ backgroundColor: "rgba(240, 165, 0, 0.12)", color: "#f0a500" }}>
            🟡 Atenção
          </span>
          <span className="rounded-lg px-3 py-2" style={{ backgroundColor: "rgba(214, 64, 69, 0.12)", color: "#d64045" }}>
            🔴 Crítico
          </span>
        </div>
      </div>
    </div>
  );
}
