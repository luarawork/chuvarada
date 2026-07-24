import { NextResponse, type NextRequest } from "next/server";

const DEFAULT_MAX_BODY_BYTES = 10 * 1024;

// Corrige achado médio M9 da auditoria de segurança: os endpoints POST não
// tinham limite de tamanho de corpo nenhum -- req.json() bufferiza o body
// inteiro em memória antes de qualquer validação de campo rodar. Checa
// Content-Length ANTES de chamar req.json(), então um payload gigante nem
// chega a ser parseado.
export function rejectIfPayloadTooLarge(req: NextRequest, maxBytes = DEFAULT_MAX_BODY_BYTES): NextResponse | null {
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > maxBytes) {
    return NextResponse.json({ error: "Payload muito grande" }, { status: 413 });
  }
  return null;
}

// Corrige achado médio M4 da auditoria de segurança (24/07/2026,
// scripts/relatorio_vulnerabilidades.md): vários endpoints devolviam
// `(err as Error).message` direto no JSON de resposta -- podia vazar
// detalhes internos (nome de coluna/constraint do Postgres, mensagem de
// erro de biblioteca interna) pro cliente. O erro real ainda é logado
// server-side (console.error), só não chega mais na resposta.
export function handleApiError(err: unknown, context: string): NextResponse {
  console.error(`[${context}]`, err);
  return NextResponse.json({ error: "Erro interno. Tente novamente." }, { status: 500 });
}
