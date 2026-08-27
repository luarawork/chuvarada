// Recalcula centroid_lat/lng de distritos usando centroide ponderado pela
// população (v0001) dos setores censitários do Censo 2022.
//
// Escrito em Node, não Python: geopandas/shapely exigem um interpretador
// Python real, que não existe neste ambiente (só o stub da Microsoft
// Store). A lógica é a mesma pedida originalmente -- lib/wkb_centroid.js
// decodifica a geometria GeoPackage/WKB direto (sem libs espaciais) e
// calcula o centroide de cada setor pela fórmula de área (shoelace).
//
// Fonte: {UF}_setores_CD2022.gpkg
// URL: https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/
//      Agregados_por_Setores_Censitarios/malha_com_atributos/
//      setores/gpkg/UF/{UF}/{UF}_setores_CD2022.gpkg
//
// Fallback quando população = 0: centroide geométrico simples (média)
// dos centroides dos setores -- melhor que o centroide atual do polígono
// do distrito inteiro.
//
// Match: normalização de texto (sem acento, uppercase) em
// n.name vs NM_DIST e c.name vs NM_MUN.
//
// Saída: CSV com novos centroides para validação antes de UPDATE.
// NÃO faz nenhum UPDATE no banco -- só leitura (fetchDistricts) e escrita
// de arquivo local.

require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const https = require("https");
const { Client } = require("pg");
const { DatabaseSync } = require("node:sqlite");
const { geometryCentroidFromGpkgBlob } = require("./lib/wkb_centroid");

const DB_URL = process.env.SUPABASE_CONNECTION_STRING;
const IBGE_BASE = (uf) =>
  `https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/malha_com_atributos/setores/gpkg/UF/${uf}/${uf}_setores_CD2022.gpkg`;

const DADOS_BRUTOS = path.join(__dirname, "..", "dados-brutos");
const CHECKPOINT_CSV = path.join(DADOS_BRUTOS, "district_centroids_checkpoint.csv");
const OUTPUT_CSV = path.join(DADOS_BRUTOS, "district_centroids_new.csv");
const TEMP_DIR = path.join(DADOS_BRUTOS, "tmp_gpkg");
fs.mkdirSync(TEMP_DIR, { recursive: true });

function normalize(s) {
  if (!s) return "";
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos/diacríticos
    .toUpperCase()
    .trim();
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const CSV_COLUMNS = [
  "neighborhood_id",
  "district_name",
  "city_name",
  "state",
  "current_lat",
  "current_lng",
  "new_lat",
  "new_lng",
  "method",
  "sector_count",
  "total_pop",
];

function rowsToCsv(rows) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push(CSV_COLUMNS.map((c) => csvEscape(r[c])).join(","));
  }
  return lines.join("\n") + "\n";
}

function parseCsv(text) {
  // Parser simples o bastante pro nosso próprio formato (sem aspas
  // aninhadas complexas) -- só usado pra retomar checkpoint.
  const lines = text.trim().split("\n");
  const header = lines[0].split(",");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = [];
    let cur = "";
    let inQuotes = false;
    for (let j = 0; j < lines[i].length; j++) {
      const ch = lines[i][j];
      if (inQuotes) {
        if (ch === '"' && lines[i][j + 1] === '"') {
          cur += '"';
          j++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        cells.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    const row = {};
    header.forEach((h, idx) => (row[h] = cells[idx]));
    rows.push(row);
  }
  return rows;
}

async function fetchDistricts(db) {
  const r = await db.query(`
    SELECT
        n.id as neighborhood_id,
        n.name as district_name,
        n.centroid_lat as current_lat,
        n.centroid_lng as current_lng,
        c.name as city_name,
        c.state
    FROM neighborhoods n
    JOIN cities c ON c.id = n.city_id
    WHERE n.name_source = 'distrito'
    AND c.active = true
    ORDER BY c.state, c.name, n.name
  `);
  const rows = r.rows.map((row) => ({
    ...row,
    district_norm: normalize(row.district_name),
    city_norm: normalize(row.city_name),
  }));
  console.log(`[fetch] ${rows.length} distritos no banco`);
  return rows;
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const req = https.get(url, { timeout: 300000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(destPath, () => {});
        return downloadFile(res.headers.location, destPath).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
    });
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function processState(uf, districtsForState) {
  if (districtsForState.length === 0) {
    console.log(`[${uf}] Nenhum distrito no banco -- pulando`);
    return [];
  }

  const url = IBGE_BASE(uf);
  const gpkgPath = path.join(TEMP_DIR, `${uf}_setores_CD2022.gpkg`);

  console.log(`[${uf}] Baixando ${url}...`);
  try {
    await downloadFile(url, gpkgPath);
    const sizeMb = fs.statSync(gpkgPath).size / 1024 / 1024;
    console.log(`[${uf}] Baixado: ${sizeMb.toFixed(1)}MB`);
  } catch (e) {
    console.log(`[${uf}] ERRO no download: ${e.message}`);
    return districtsForState.map((d) => baseResult(d, uf, "DOWNLOAD_ERROR"));
  }

  let db;
  let sectorRows;
  try {
    db = new DatabaseSync(gpkgPath, { readOnly: true });
    const tableName = `${uf}_setores_CD2022`;
    sectorRows = db
      .prepare(`SELECT NM_DIST, NM_MUN, v0001, geom FROM "${tableName}"`)
      .all();
    console.log(`[${uf}] ${sectorRows.length} setores censitários`);
  } catch (e) {
    console.log(`[${uf}] ERRO ao ler gpkg: ${e.message}`);
    fs.rmSync(gpkgPath, { force: true });
    return districtsForState.map((d) => baseResult(d, uf, "READ_ERROR"));
  }

  // Agrupa setores por (distrito normalizado, município normalizado),
  // já acumulando os totais necessários (evita guardar todo mundo em
  // memória por muito tempo).
  const groups = new Map();
  for (const row of sectorRows) {
    const key = `${normalize(row.NM_DIST)}|${normalize(row.NM_MUN)}`;
    let g = groups.get(key);
    if (!g) {
      g = { sumPopLat: 0, sumPopLng: 0, totalPop: 0, sumLat: 0, sumLng: 0, count: 0 };
      groups.set(key, g);
    }
    const c = geometryCentroidFromGpkgBlob(row.geom);
    if (!c) continue; // geometria degenerada, ignora esse setor
    const pop = Number(row.v0001) || 0;
    g.sumPopLat += c.lat * pop;
    g.sumPopLng += c.lng * pop;
    g.totalPop += pop;
    g.sumLat += c.lat;
    g.sumLng += c.lng;
    g.count += 1;
  }
  db.close();

  const results = [];
  for (const district of districtsForState) {
    const key = `${district.district_norm}|${district.city_norm}`;
    const g = groups.get(key);

    if (!g || g.count === 0) {
      console.log(`  [MISS] ${district.district_name} / ${district.city_name}/${uf} -- sem match`);
      results.push(baseResult(district, uf, "NO_MATCH"));
      continue;
    }

    let newLat, newLng, method;
    if (g.totalPop > 0) {
      newLat = g.sumPopLat / g.totalPop;
      newLng = g.sumPopLng / g.totalPop;
      method = "WEIGHTED";
    } else {
      newLat = g.sumLat / g.count;
      newLng = g.sumLng / g.count;
      method = "GEOMETRIC_FALLBACK";
    }

    results.push({
      neighborhood_id: district.neighborhood_id,
      district_name: district.district_name,
      city_name: district.city_name,
      state: uf,
      current_lat: district.current_lat,
      current_lng: district.current_lng,
      new_lat: Number(newLat.toFixed(6)),
      new_lng: Number(newLng.toFixed(6)),
      method,
      sector_count: g.count,
      total_pop: Math.round(g.totalPop),
    });
  }

  fs.rmSync(gpkgPath, { force: true });
  console.log(`[${uf}] ${results.length} distritos processados, gpkg deletado`);
  return results;
}

function baseResult(district, uf, method) {
  return {
    neighborhood_id: district.neighborhood_id,
    district_name: district.district_name,
    city_name: district.city_name,
    state: uf,
    current_lat: district.current_lat,
    current_lng: district.current_lng,
    new_lat: null,
    new_lng: null,
    method,
    sector_count: 0,
    total_pop: 0,
  };
}

async function main() {
  const db = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const allDistricts = await fetchDistricts(db);
  await db.end();

  const states = [...new Set(allDistricts.map((d) => d.state))].sort();
  console.log(`\n[main] ${states.length} estados para processar: ${states.join(", ")}\n`);

  let doneStates = new Set();
  let allResults = [];
  if (fs.existsSync(CHECKPOINT_CSV)) {
    const doneRows = parseCsv(fs.readFileSync(CHECKPOINT_CSV, "utf8"));
    doneStates = new Set(doneRows.map((r) => r.state));
    allResults = doneRows;
    console.log(`[main] Checkpoint: ${doneStates.size} estados já feitos`);
  }

  for (const uf of states) {
    if (doneStates.has(uf)) {
      console.log(`[${uf}] Já no checkpoint -- pulando`);
      continue;
    }
    const stateDistricts = allDistricts.filter((d) => d.state === uf);
    const result = await processState(uf, stateDistricts);
    if (result.length > 0) {
      allResults = allResults.concat(result);
      fs.writeFileSync(CHECKPOINT_CSV, rowsToCsv(allResults));
      console.log(`[${uf}] Checkpoint salvo (${allResults.length} linhas)\n`);
    }
  }

  if (allResults.length > 0) {
    fs.writeFileSync(OUTPUT_CSV, rowsToCsv(allResults));
    const weighted = allResults.filter((r) => r.method === "WEIGHTED").length;
    const fallback = allResults.filter((r) => r.method === "GEOMETRIC_FALLBACK").length;
    const noMatch = allResults.filter((r) => r.method === "NO_MATCH").length;
    const errors = allResults.filter((r) => r.method === "DOWNLOAD_ERROR" || r.method === "READ_ERROR").length;
    console.log(`\n[main] CSV final salvo: ${OUTPUT_CSV}`);
    console.log(`       Total: ${allResults.length} distritos`);
    console.log(`       WEIGHTED:           ${weighted}`);
    console.log(`       GEOMETRIC_FALLBACK: ${fallback}`);
    console.log(`       NO_MATCH:           ${noMatch}`);
    console.log(`       ERROS (download/leitura): ${errors}`);
  } else {
    console.log("[main] Nenhum resultado gerado");
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { fetchDistricts, processState, normalize, rowsToCsv, main };
