import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { gzip, gunzip } from "zlib";
import { promisify } from "util";

// Backblaze B2 (S3-compatible) -- arquivamento de histórico fora do
// Supabase (23/07/2026). Mesmo SDK usado pra AWS S3, só muda endpoint e
// credenciais -- ver scripts/SETUP_ACTIONS.md pros secrets necessários.
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// Client construído sob demanda (não no top-level do módulo) -- scripts
// standalone rodados via tsx carregam .env.local depois que os imports do
// arquivo já foram avaliados (hoisting de ESM), então ler process.env no
// topo do módulo pegava as env vars ainda undefined.
let b2Client: S3Client | null = null;

function getB2Client(): S3Client {
  if (!b2Client) {
    b2Client = new S3Client({
      region: "us-east-005",
      endpoint: process.env.B2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.B2_KEY_ID!,
        secretAccessKey: process.env.B2_APPLICATION_KEY!,
      },
    });
  }
  return b2Client;
}

function getBucket(): string {
  return process.env.B2_BUCKET_NAME!;
}

export async function saveToB2(key: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data);
  const compressed = await gzipAsync(json);

  await getB2Client().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: compressed,
      ContentType: "application/json",
      ContentEncoding: "gzip",
    })
  );
}

export async function readFromB2<T>(key: string): Promise<T | null> {
  try {
    const response = await getB2Client().send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));

    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) return null;

    const decompressed = await gunzipAsync(Buffer.from(bytes));
    return JSON.parse(decompressed.toString());
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
}

export async function listB2Files(prefix: string): Promise<string[]> {
  const response = await getB2Client().send(new ListObjectsV2Command({ Bucket: getBucket(), Prefix: prefix }));
  return (response.Contents ?? []).map((obj) => obj.Key).filter((key): key is string => !!key);
}

// Keys padronizadas -- mesmo esquema de particionamento por ano/mês/dia
// pros 3 tipos de dado arquivado.
export function getRiskScoresKey(date: string, state: string): string {
  const [year, month, day] = date.split("-");
  return `risk_scores/${year}/${month}/${day}/scores_${date}_${state.toLowerCase()}.json.gz`;
}

export function getSnapshotKey(date: string): string {
  const [year, month, day] = date.split("-");
  return `snapshots/daily/${year}/${month}/${day}/snapshot_${date}.json.gz`;
}

export function getMergeCacheKey(date: string): string {
  const [year, month, day] = date.split("-");
  return `merge_cache/${year}/${month}/${day}/merge_${date}.json.gz`;
}
