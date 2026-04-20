import { NextResponse } from "next/server";
import {
  createSessionToken,
  getSessionCookieOptions,
  normalizeNextPath,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";
import { consumeAuthToken } from "@/lib/server/authSecurity";
import { markEmailVerified } from "@/lib/server/currentUser";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const nextPath = normalizeNextPath(url.searchParams.get("next"));

  try {
    const supabase = getSupabaseAdmin();
    const consumed = await consumeAuthToken(
      supabase,
      "email_verification",
      token
    );
    if (!consumed) {
      return NextResponse.redirect(new URL("/login?verified=0", request.url));
    }

    const user = await markEmailVerified(supabase, consumed.userId);
    const response = NextResponse.redirect(new URL(nextPath, request.url));
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: await createSessionToken(user.email),
      ...getSessionCookieOptions(),
    });
    return response;
  } catch (error) {
    console.error("GET /api/auth/verify-email failed", error);
    return NextResponse.redirect(new URL("/login?verified=0", request.url));
  }
}
