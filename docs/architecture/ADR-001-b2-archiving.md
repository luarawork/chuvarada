# ADR-001: Backblaze B2 para archiving histórico

**Status:** Aceito

## Contexto

O plano gratuito do Supabase tem limite de 500MB de banco. `risk_scores`,
`merge_cache` e `weather_cache` crescem continuamente — com 28.483 bairros
sendo recalculados a cada hora, o histórico de scores sozinho já ameaçava
estourar o limite.

## Decisão

Arquivar dados antigos do Supabase pro Backblaze B2 (comprimido,
particionado por data/estado), via `scripts/archive_to_b2.ts` rodando
diariamente (`archive-history.yml`):

- `risk_scores` com mais de 48h
- `merge_cache`: 4 dias pra células próximas de algum bairro
  (`is_near_neighborhood = true`), 1 dia pras demais
- `weather_cache` com mais de 24h
- Arquivos no B2 em si retidos por 1 ano

## Consequências

- Consultas de histórico além do período retido no Supabase passam a
  precisar ler do B2 (`GET /api/history` já implementa esse fallback).
- Custo operacional extra: mais uma credencial/serviço pra manter
  (`B2_ENDPOINT`, `B2_BUCKET_NAME`, `B2_KEY_ID`, `B2_APPLICATION_KEY`).
- Ganho: o banco de produção fica com um volume previsível, independente
  de quanto tempo o projeto rodar.

## Alternativas consideradas

- **Segundo projeto Supabase** (500MB × 2 = 1GB) — descartado: ainda
  assim menor capacidade que o plano gratuito do B2 (10GB), e duplicaria
  a complexidade de conexão sem resolver o problema, só adiá-lo.
- **Firebase** (1GB, NoSQL) — descartado: não suporta SQL/JOIN/RLS, que o
  resto do projeto depende (histórico por bairro, agregações por
  estado/cidade).
- **Cloudflare R2** — descartado: exige cartão de crédito no cadastro,
  mesmo dentro do free tier.
