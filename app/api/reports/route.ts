import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerSupabase } from "@/lib/supabase";
import { calculateExpiresAt } from "@/lib/reports";
import { hashIp, checkRateLimit } from "@/lib/reportRateLimit";
import type { ReportSeverity, UserReport } from "@/types";

const VALID_SEVERITIES: ReportSeverity[] = ["leve", "moderado", "grave"];
const MAX_DESCRIPTION_LENGTH = 280;
const MAX_REPORTS_PER_REQUEST = 100;

// Bbox de busca do bairro/cidade mais próximo do ponto relatado -- ~0.1°
// (~11km no equador) é generoso o bastante pra sempre achar o bairro mais
// próximo mesmo em áreas de baixa densidade de bairros (interior), sem
// escanear a tabela inteira.
const NEAREST_SEARCH_DEGREES = 0.1;

function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

async function getUserIdFromAuthHeader(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length);
  const { data, error } = await getServerSupabase().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }

  const { lat, lng, severity, description, app_version } = body;

  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "lat/lng são obrigatórios e devem ser numéricos" }, { status: 400 });
  }
  if (!VALID_SEVERITIES.includes(severity)) {
    return NextResponse.json({ error: "severity deve ser leve, moderado ou grave" }, { status: 400 });
  }
  if (description !== undefined && description !== null) {
    if (typeof description !== "string" || description.length > MAX_DESCRIPTION_LENGTH) {
      return NextResponse.json(
        { error: `description deve ter no máximo ${MAX_DESCRIPTION_LENGTH} caracteres` },
        { status: 400 }
      );
    }
  }

  const userId = await getUserIdFromAuthHeader(req);
  const isAnonymous = !userId;
  const ip = getClientIp(req);
  const ipHash = hashIp(ip);

  if (isAnonymous) {
    const { allowed, count } = await checkRateLimit(ipHash);
    if (!allowed) {
      return NextResponse.json(
        { error: `Limite de relatos anônimos atingido (${count} na última hora). Entre numa conta para relatar sem limite.` },
        { status: 429 }
      );
    }
  }

  const db = getDb();

  const { rows: nearestRows } = await db.query(
    `select n.id as neighborhood_id, n.city_id,
            rs.score as model_score, rs.level as model_level,
            rs.rain_72h as model_rain_72h, rs.rain_peak_3h as model_rain_peak_3h
     from neighborhoods n
     left join lateral (
       select * from risk_scores r
       where r.neighborhood_id = n.id
       order by r.calculated_at desc
       limit 1
     ) rs on true
     where n.centroid_lat between $1 and $2
       and n.centroid_lng between $3 and $4
     order by (n.centroid_lat - $5) ^ 2 + (n.centroid_lng - $6) ^ 2
     limit 1`,
    [
      lat - NEAREST_SEARCH_DEGREES,
      lat + NEAREST_SEARCH_DEGREES,
      lng - NEAREST_SEARCH_DEGREES,
      lng + NEAREST_SEARCH_DEGREES,
      lat,
      lng,
    ]
  );
  const nearest = nearestRows[0] ?? null;

  const expiresAt = calculateExpiresAt(severity as ReportSeverity, 0);

  const { rows } = await db.query(
    `insert into user_reports
       (lat, lng, neighborhood_id, city_id, severity, description, user_id, is_anonymous,
        ip_hash, model_score, model_level, model_rain_72h, model_rain_peak_3h,
        expires_at, app_version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     returning *`,
    [
      lat,
      lng,
      nearest?.neighborhood_id ?? null,
      nearest?.city_id ?? null,
      severity,
      description ?? null,
      userId,
      isAnonymous,
      ipHash,
      nearest?.model_score ?? null,
      nearest?.model_level ?? null,
      nearest?.model_rain_72h ?? null,
      nearest?.model_rain_peak_3h ?? null,
      expiresAt.toISOString(),
      typeof app_version === "string" ? app_version : null,
    ]
  );

  return NextResponse.json({ report: rows[0] as UserReport }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const db = getDb();

  // Modo histórico (página /analise) -- por estado/período, sem filtro de
  // status/expires_at (o objetivo ali é ver relatos passados, inclusive já
  // expirados/resolvidos, cruzados com o score do modelo na época).
  const state = searchParams.get("state");
  if (state) {
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const { rows } = await db.query(
      `select r.* from user_reports r
       join cities c on c.id = r.city_id
       where c.state = $1
         and ($2::date is null or r.created_at >= $2::date)
         and ($3::date is null or r.created_at < ($3::date + interval '1 day'))
       order by r.created_at desc
       limit ${MAX_REPORTS_PER_REQUEST}`,
      [state, start, end]
    );
    return NextResponse.json({ reports: rows as UserReport[] });
  }

  const north = parseFloat(searchParams.get("north") ?? "");
  const south = parseFloat(searchParams.get("south") ?? "");
  const east = parseFloat(searchParams.get("east") ?? "");
  const west = parseFloat(searchParams.get("west") ?? "");

  if ([north, south, east, west].some((v) => Number.isNaN(v))) {
    return NextResponse.json(
      { error: "Parâmetros north/south/east/west são obrigatórios e devem ser numéricos, ou use ?state=" },
      { status: 400 }
    );
  }

  const { rows } = await db.query(
    `select * from user_reports
     where status = 'active'
       and expires_at > now()
       and lat between $1 and $2
       and lng between $3 and $4
     order by created_at desc
     limit $5`,
    [south, north, west, east, MAX_REPORTS_PER_REQUEST]
  );

  return NextResponse.json({ reports: rows as UserReport[] });
}
