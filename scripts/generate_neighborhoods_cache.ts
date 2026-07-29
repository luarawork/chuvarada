import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Pool } from "pg";
import { saveToB2, getNeighborhoodsCacheKey } from "../lib/b2";
import type { Neighborhood } from "../types";

// Gera o snapshot de neighborhoods usado pelo Cron A/B em vez da leitura
// nacional direta no Postgres (diagnóstico de egress de 29/07/2026) --
// mesmas 10 colunas que app/api/cron/scores/route.ts já seleciona hoje
// (sem geometry_simplified). Regenerado 1x/dia via
// .github/workflows/regenerate-neighborhoods-cache.yml -- dado novo
// (bairro/cidade recém-cadastrado) só aparece no cache depois da próxima
// regeneração ou de um workflow_dispatch manual.
async function main() {
  const connectionString = process.env.SUPABASE_CONNECTION_STRING;
  if (!connectionString) throw new Error("SUPABASE_CONNECTION_STRING não definida");

  const db = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    const { rows } = await db.query<Neighborhood>(
      `select id, city_id, name, name_source, centroid_lat, centroid_lng,
              terrain_slope, hydro_proximity, is_coastal, created_at
       from neighborhoods`
    );

    const payload = {
      generated_at: new Date().toISOString(),
      count: rows.length,
      neighborhoods: rows,
    };

    await saveToB2(getNeighborhoodsCacheKey(), payload);

    const bytes = Buffer.byteLength(JSON.stringify(payload));
    console.log(`Cache gerado: ${rows.length} bairros, ${(bytes / 1024).toFixed(1)}KB não comprimido (B2 salva gzip automaticamente).`);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
