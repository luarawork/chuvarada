const SOURCES = [
  { name: "Marinha do Brasil / DHN — dados de maré", url: "https://www.marinha.mil.br/chm" },
  { name: "CPTEC/INPE — distribuição das tábuas de maré", url: "https://ondas.cptec.inpe.br" },
  { name: "Cemaden — alertas e pluviômetros", url: "https://www.cemaden.gov.br" },
  { name: "ANA — rede hidrográfica nacional", url: "https://www.snirh.gov.br" },
  { name: "NASA SRTM — altimetria do terreno", url: "https://www.earthdata.nasa.gov" },
  { name: "IBGE — malha de bairros", url: "https://www.ibge.gov.br" },
  { name: "Open-Meteo — clima em tempo real e histórico", url: "https://open-meteo.com" },
  { name: "Prefeitura do Recife — hidrografia municipal", url: "https://dados.recife.pe.gov.br" },
  { name: "Codevasf — bacias hidrográficas do RN", url: "https://www.codevasf.gov.br" },
];

export function SourcesList() {
  return (
    <ul className="space-y-2">
      {SOURCES.map((source) => (
        <li key={source.url}>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-brand-blue-mid underline underline-offset-2 hover:text-brand-blue-deep"
          >
            {source.name}
          </a>
        </li>
      ))}
    </ul>
  );
}
