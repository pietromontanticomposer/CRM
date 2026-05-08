import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETENTION_DAYS = 60;
const BATCH_SIZE = 500;

const getEnv = (key: string) => {
  const value = process.env[key];
  if (!value || !value.trim()) throw new Error(`Missing env ${key}`);
  return value.trim();
};

const getCronSecretFromRequest = (request: Request) => {
  const headerSecret = request.headers.get("x-cron-secret");
  if (headerSecret && headerSecret.trim().length > 0) return headerSecret.trim();
  const authHeader = request.headers.get("authorization");
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, "").trim();
  }
  return null;
};

const handleRetention = async (request: Request) => {
  const cronSecret = getCronSecretFromRequest(request);
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const supabase = createClient(
    getEnv("SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const cutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  let totalCleared = 0;
  for (;;) {
    const { data: candidates, error: selectError } = await supabase
      .from("emails")
      .select("id")
      .lt("received_at", cutoff)
      .not("html_body", "is", null)
      .limit(BATCH_SIZE);

    if (selectError) {
      console.error("emails retention select failed", selectError);
      return NextResponse.json(
        { ok: false, error: selectError.message, cleared: totalCleared },
        { status: 500 }
      );
    }

    if (!candidates || candidates.length === 0) break;

    const ids = candidates.map((row) => row.id as string);
    const { error: updateError } = await supabase
      .from("emails")
      .update({ html_body: null })
      .in("id", ids);

    if (updateError) {
      console.error("emails retention update failed", updateError);
      return NextResponse.json(
        { ok: false, error: updateError.message, cleared: totalCleared },
        { status: 500 }
      );
    }

    totalCleared += ids.length;
    if (ids.length < BATCH_SIZE) break;
  }

  return NextResponse.json({
    ok: true,
    cleared: totalCleared,
    retentionDays: RETENTION_DAYS,
    cutoff,
  });
};

export async function GET(request: Request) {
  return handleRetention(request);
}

export async function POST(request: Request) {
  return handleRetention(request);
}
