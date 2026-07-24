const SOURCES = [
  { name: "MERGE/CPTEC", provides: "Precipitação (satélite + pluviômetros)", status: "active" },
  { name: "Open-Meteo", provides: "Vento, umidade, pressão", status: "active" },
  { name: "NASA SRTM", provides: "Altimetria do terreno", status: "active" },
  { name: "ANA/BHO", provides: "Rede hidrográfica nacional", status: "active" },
  { name: "IBGE Censo 2022", provides: "Malha de bairros", status: "active" },
  { name: "Marinha/CPTEC", provides: "Tábua de marés", status: "degraded" },
  { name: "Relatos de usuários", provides: "Validação comunitária", status: "new" },
] as const;

const STATUS_CONFIG = {
  active: { label: "✅ Ativo", color: "#2a9d72" },
  degraded: { label: "⚠️ Degradado", color: "#f0a500" },
  new: { label: "✅ Novo", color: "#2a9d72" },
};

export function SourcesList() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="border-b" style={{ borderColor: "rgba(46, 125, 184, 0.2)" }}>
            <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>
              Fonte
            </th>
            <th className="py-2 pr-4 text-left font-medium" style={{ color: "#f0f4f8" }}>
              O que fornece
            </th>
            <th className="py-2 text-left font-medium" style={{ color: "#f0f4f8" }}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {SOURCES.map((source) => (
            <tr key={source.name} className="border-b last:border-0" style={{ borderColor: "rgba(46, 125, 184, 0.1)" }}>
              <td className="py-2.5 pr-4 font-medium" style={{ color: "#f0f4f8" }}>
                {source.name}
              </td>
              <td className="py-2.5 pr-4" style={{ color: "#a8d4f0" }}>
                {source.provides}
              </td>
              <td className="py-2.5" style={{ color: STATUS_CONFIG[source.status].color }}>
                {STATUS_CONFIG[source.status].label}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
