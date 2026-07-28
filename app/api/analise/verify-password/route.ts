import { NextRequest, NextResponse } from "next/server";
import { verifyAdminPassword } from "@/lib/auth";

// Só verifica a senha pro gate de /analise -- ao contrário de /sugestoes
// (onde a senha é enviada em TODA chamada aos endpoints de dado, que são
// exclusivos da página admin), os endpoints que /analise consome
// (/api/history, /api/reports, /api/analise/metrics,
// /api/analise/active-users) são compartilhados com outras partes públicas
// do app (ex: ReportLayer.tsx no mapa usa /api/reports) e não podem ser
// gateados por senha sem quebrar essas outras features. Este endpoint só
// autentica a entrada na página em si.
export async function POST(req: NextRequest) {
  const password = req.headers.get("x-admin-password");
  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ error: "Senha incorreta" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
