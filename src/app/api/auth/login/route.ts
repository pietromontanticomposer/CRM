import { NextResponse } from "next/server";
import {
  createSessionToken,
  getSessionCookieOptions,
  isSessionConfigured,
  normalizeNextPath,
  SESSION_COOKIE_NAME,
  validateLogin,
} from "@/lib/auth";
import {
  ensureAppUser,
  validateAppUserLogin,
} from "@/lib/server/currentUser";
import { checkRateLimit, getClientIp } from "@/lib/server/authSecurity";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LoginBody = {
  email?: string;
  password?: string;
  next?: string;
};

export async function POST(request: Request) {
  if (!isSessionConfigured()) {
    return NextResponse.json(
      { error: "Login non configurato sul server." },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as LoginBody | null;
  const email = body?.email?.trim() ?? "";
  const password = body?.password ?? "";
  const nextPath = normalizeNextPath(body?.next);

  const supabase = getSupabaseAdmin();
  const rateLimit = await checkRateLimit(supabase, {
    action: "login",
    identifier: `${getClientIp(request)}:${email.toLowerCase()}`,
    maxAttempts: 30,
    windowSeconds: 15 * 60,
    blockSeconds: 30 * 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Troppi tentativi. Riprova tra qualche minuto." },
      { status: 429 }
    );
  }

  let appUser = null;
  try {
    appUser = await validateAppUserLogin(supabase, email, password);
  } catch (error) {
    if (error instanceof Error && error.message === "EMAIL_NOT_VERIFIED") {
      return NextResponse.json(
        { error: "Verifica prima la tua email." },
        { status: 403 }
      );
    }
    throw error;
  }
  const isLegacyValid = appUser ? false : await validateLogin(email, password);

  if (!appUser && !isLegacyValid) {
    return NextResponse.json(
      { error: "Credenziali non valide." },
      { status: 401 }
    );
  }

  if (isLegacyValid) {
    await ensureAppUser(supabase, email);
  } else if (appUser) {
    await supabase
      .from("app_users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", appUser.id);
  }

  const response = NextResponse.json({ ok: true, redirectTo: nextPath });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: await createSessionToken(email),
    ...getSessionCookieOptions(),
  });
  return response;
}
