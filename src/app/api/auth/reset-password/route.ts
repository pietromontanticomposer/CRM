import { NextResponse } from "next/server";
import {
  createSessionToken,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";
import {
  checkRateLimit,
  consumeAuthToken,
  getClientIp,
} from "@/lib/server/authSecurity";
import { updateAppUserPassword } from "@/lib/server/currentUser";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResetBody = {
  token?: string;
  password?: string;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as ResetBody | null;
  const token = body?.token?.trim() ?? "";
  const password = body?.password ?? "";

  if (!token || password.length < 8) {
    return NextResponse.json(
      { error: "Link non valido o password troppo corta." },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();
  const rateLimit = await checkRateLimit(supabase, {
    action: "reset_password",
    identifier: getClientIp(request),
    maxAttempts: 10,
    windowSeconds: 60 * 60,
    blockSeconds: 60 * 60,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Troppi tentativi. Riprova piu tardi." },
      { status: 429 }
    );
  }

  const consumed = await consumeAuthToken(supabase, "password_reset", token);
  if (!consumed) {
    return NextResponse.json(
      { error: "Link scaduto o gia usato." },
      { status: 400 }
    );
  }

  const user = await updateAppUserPassword(supabase, consumed.userId, password);
  const response = NextResponse.json({ ok: true, redirectTo: "/crm" });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: await createSessionToken(user.email),
    ...getSessionCookieOptions(),
  });
  return response;
}
