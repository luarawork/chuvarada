import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getUserIdFromAuthHeader } from "@/lib/auth";
import { calculateExpiresAt } from "@/lib/reports";
import { getClientIp, hashIp, checkRateLimit, checkAuthenticatedRateLimit } from "@/lib/reportRateLimit";
import { isValidBrazilState, parseBbox } from "@/lib/geo";
import { rejectIfPayloadTooLarge, handleApiError } from "@/lib/apiError";
import type { ReportSeverity, UserReport } from "@/types";

const VALID_SEVERITIES: ReportSeverity[] = ["leve", "moderado", "grave"];
const MAX_DESCRIPTION_LENGTH = 280;
const MAX_REPORTS_PER_REQUEST = 100;

// Bbox de busca do bairro/cidade mais próximo do ponto relatado -- ~0.1°
// (~11km no equador) é generoso o bastante pra sempre achar o bairro mais
// próximo mesmo em áreas de baixa densidade de bairros (interior), sem
// escanear a tabela inteira.
const NEAREST_SEARCH_DEGREES = 0.1;

export async function POST(req: NextRequest) {
  const tooLarge = rejectIfPayloadTooLarge(req);
  if (tooLarge) return tooLarge;

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }

  const { lat, lng, severity, description, app_version } = body;

  if (typeof lat !== "number" || lat < -90 || lat > 90) {
    return NextResponse.json({ error: "lat inválido (deve estar entre -90 e 90)" }, { status: 400 });
  }
  if (typeof lng !== "number" || lng < -180 || lng > 180) {
    return NextResponse.json({ error: "lng inválido (deve estar entre -180 e 180)" }, { status: 400 });
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

  try {
    const userId = await getUserIdFromAuthHeader(req.headers.get("authorization"));
    const isAnonymous = !userId;
    const ip = getClientIp(req);
    const ipHash = hashIp(ip);

    if (isAnonymous) {
      const { allowed, count } = await checkRateLimit(ipHash);
      if (!allowed) {
        return NextResponse.json(
          { error: `Limite de relatos anônimos atingido (${count} na última hora). Entre numa conta para relatar com um limite maior.` },
          { status: 429 }
        );
      }
    } else {
      const { allowed, count } = await checkAuthenticatedRateLimit(userId!);
      if (!allowed) {
        return NextResponse.json(
          { error: `Limite de relatos atingido (${count} na última hora). Tente novamente mais tarde.` },
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
  } catch (err) {
    return handleApiError(err, "api/reports POST");
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // Modo histórico (página /analise) -- por estado/período, sem filtro de
  // status/expires_at (o objetivo ali é ver relatos passados, inclusive já
  // expirados/resolvidos, cruzados com o score do modelo na época).
  const state = searchParams.get("state");
  if (state) {
    if (!isValidBrazilState(state)) {
      return NextResponse.json({ error: "state deve ser uma UF válida (2 letras maiúsculas)" }, { status: 400 });
    }
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    if ((start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) || (end && !/^\d{4}-\d{2}-\d{2}$/.test(end))) {
      return NextResponse.json({ error: "start/end devem estar no formato YYYY-MM-DD" }, { status: 400 });
    }
    try {
      const db = getDb();
      const { rows } = await db.query(
        `select r.* from user_reports r
         join cities c on c.id = r.city_id
         where c.state = $1
           and ($2::date is null or r.created_at >= $2::date)
           and ($3::date is null or r.created_at < ($3::date + interval '1 day'))
         order by r.created_at desc
         limit $4`,
        [state, start, end, MAX_REPORTS_PER_REQUEST]
      );
      return NextResponse.json({ reports: rows as UserReport[] });
    } catch (err) {
      return handleApiError(err, "api/reports GET (state)");
    }
  }

  const bbox = parseBbox(searchParams);
  if (!bbox) {
    return NextResponse.json(
      { error: "Parâmetros north/south/east/west são obrigatórios, numéricos e dentro de um bbox razoável, ou use ?state=" },
      { status: 400 }
    );
  }

  try {
    const db = getDb();
    const { rows } = await db.query(
      `select * from user_reports
       where status = 'active'
         and expires_at > now()
         and lat between $1 and $2
         and lng between $3 and $4
       order by created_at desc
       limit $5`,
      [bbox.south, bbox.north, bbox.west, bbox.east, MAX_REPORTS_PER_REQUEST]
    );
    return NextResponse.json({ reports: rows as UserReport[] });
  } catch (err) {
    return handleApiError(err, "api/reports GET (bbox)");
  }
}
