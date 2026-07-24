// Constantes compartilhadas entre mais de um módulo de lib/. Antes duplicada
// (mesmo nome, mesmo valor) em lib/merge.ts e lib/weather.ts.
//
// Acima disso, o dado do MERGE/CPTEC em merge_cache é considerado velho
// demais pra representar "agora" -- lib/merge.ts usa isso pra decidir se
// devolve o dado ou null (cai pro fallback da Open-Meteo); lib/weather.ts
// checa de novo como defesa, não por confiança cega no que getMergeData já
// filtrou.
export const MERGE_MAX_AGE_HOURS = 6;
