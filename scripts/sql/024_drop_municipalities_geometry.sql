-- A coluna `geometry` (resolução plena) de `municipalities` nunca foi lida
-- em lugar nenhum do app -- app/api/municipalities/route.ts sempre serviu
-- geometry_simplified (ver comentário na própria rota). Passou despercebida
-- enquanto cabiam só 16 estados (Nordeste+Sul/Sudeste); na expansão pra
-- cobertura nacional (27 estados, 22/07/2026) o malha nacional inteira em
-- resolução plena gerou um municipalities.geojson de 604MB -- estourou o
-- limite de string do Node (fs.readFileSync) no upload. Removida por ser
-- peso morto real (nunca consultada), não só por causa do limite.
alter table municipalities drop column if exists geometry;
