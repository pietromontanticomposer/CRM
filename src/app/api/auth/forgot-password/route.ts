import { NextResponse } from "next/server";
import {
  checkRateLimit,
  createAuthToken,
  getClientIp,
  sendAuthEmail,
} from "@/lib/server/authSecurity";
import { findAppUserByEmail } from "@/lib/server/currentUser";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ForgotBody = {
  email?: string;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as ForgotBody | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  const supabase = getSupabaseAdmin();

  const rateLimit = await checkRateLimit(supabase, {
    action: "forgot_password",
    identifier: `${getClientIp(request)}:${email}`,
    maxAttempts: 6,
    windowSeconds: 60 * 60,
    blockSeconds: 60 * 60,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Troppi tentativi. Riprova piu tardi." },
      { status: 429 }
    );
  }

  if (email) {
    const user = await findAppUserByEmail(supabase, email);
    if (user?.password_hash && user.email_verified_at && !user.disabled_at) {
      const token = await createAuthToken(
        supabase,
        user.id,
        "password_reset",
        30
      );
      const resetUrl = new URL("/login", request.url);
      resetUrl.searchParams.set("resetToken", token);
      await sendAuthEmail({
        to: email,
        subject: "Reset password CRM",
        text: [
          "Usa questo link per impostare una nuova password:",
          "",
          resetUrl.toString(),
          "",
          "Il link scade tra 30 minuti.",
        ].join("\n"),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    message: "Se l'account esiste, riceverai una mail.",
  });
}
