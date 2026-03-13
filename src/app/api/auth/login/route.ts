import { NextResponse } from "next/server";
import {
  createSessionToken,
  getSessionCookieOptions,
  isAuthConfigured,
  normalizeNextPath,
  SESSION_COOKIE_NAME,
  validateLogin,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LoginBody = {
  email?: string;
  password?: string;
  next?: string;
};

export async function POST(request: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      { error: "Login non configurato sul server." },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as LoginBody | null;
  const email = body?.email?.trim() ?? "";
  const password = body?.password ?? "";
  const nextPath = normalizeNextPath(body?.next);

  const isValid = await validateLogin(email, password);
  if (!isValid) {
    return NextResponse.json(
      { error: "Credenziali non valide." },
      { status: 401 }
    );
  }

  const response = NextResponse.json({ ok: true, redirectTo: nextPath });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: await createSessionToken(email),
    ...getSessionCookieOptions(),
  });
  return response;
}
