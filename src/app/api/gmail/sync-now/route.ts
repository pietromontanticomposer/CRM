import { NextResponse } from "next/server";
import { runSync } from "../sync/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const withCronSecret = (request: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Missing CRON_SECRET" },
      { status: 500 }
    );
  }

  const headers = new Headers(request.headers);
  headers.set("x-cron-secret", secret);
  return runSync(
    new Request(request.url, {
      method: request.method,
      headers,
    })
  );
};

export async function GET(request: Request) {
  return withCronSecret(request);
}

export async function POST(request: Request) {
  return withCronSecret(request);
}
