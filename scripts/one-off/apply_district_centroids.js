#!/usr/bin/env node
/**
 * Aplica os novos centroides ponderados por população
 * nos distritos do banco.
 *
 * Fonte: dados-brutos/district_centroids_new.csv
 * Apenas atualiza centroid_lat e centroid_lng.
 * Processa em lotes de 500 para evitar timeout no pooler.
 *
 * Desvios do roteiro original:
 * - Parser de CSV próprio (sem quotes aninhadas complexas) em vez de
 *   csv-parse, que não é dependência do projeto -- evita adicionar um
 *   pacote novo só pra rodar este script uma vez. É o mesmo parser usado
 *   em scripts/recalculate_district_centroids.js pra ler o checkpoint,
 *   então já é compatível com o formato exato que gerou este CSV.
 * - ssl: { rejectUnauthorized: false } no Client -- necessário pro
 *   pooler do Supabase neste ambiente (padrão usado em todo um-off
 *   script desta sessão; sem isso a conexão falha).
 */

require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const { Client } = require("pg");

const BATCH_SIZE = 500;
const CSV_PATH = "dados-brutos/district_centroids_new.csv";

function parseCsv(text) {
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

async function main() {
  // Ler CSV
  const content = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(content);

  // Filtrar só os que têm novo centroide (exclui NO_MATCH e eventuais erros)
  const toUpdate = rows.filter((r) => r.new_lat && r.new_lng && r.method !== "NO_MATCH");

  console.log(`Total no CSV: ${rows.length}`);
  console.log(`Para atualizar: ${toUpdate.length}`);
  console.log(`Pulando (sem novo centroide): ${rows.length - toUpdate.length}`);

  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  let updated = 0;
  let errors = 0;

  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + BATCH_SIZE);

    try {
      const ids = batch.map((r) => r.neighborhood_id);
      const lats = batch.map((r) => parseFloat(r.new_lat));
      const lngs = batch.map((r) => parseFloat(r.new_lng));

      await client.query(
        `
        UPDATE neighborhoods AS n
        SET
          centroid_lat = v.lat,
          centroid_lng = v.lng
        FROM unnest($1::uuid[], $2::float8[], $3::float8[])
          AS v(id, lat, lng)
        WHERE n.id = v.id
      `,
        [ids, lats, lngs]
      );

      updated += batch.length;
      console.log(`Lote ${Math.floor(i / BATCH_SIZE) + 1}: ${updated}/${toUpdate.length} atualizados`);
    } catch (err) {
      console.error(`ERRO no lote ${Math.floor(i / BATCH_SIZE) + 1}:`, err.message);
      errors += batch.length;
    }
  }

  await client.end();

  console.log(`\nConcluído:`);
  console.log(`  Atualizados: ${updated}`);
  console.log(`  Erros: ${errors}`);
}

main().catch(console.error);
