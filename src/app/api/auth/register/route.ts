import { NextResponse } from "next/server";
import { normalizeNextPath } from "@/lib/auth";
import {
  checkRateLimit,
  createAuthToken,
  getClientIp,
  sendAuthEmail,
} from "@/lib/server/authSecurity";
import { createAppUser } from "@/lib/server/currentUser";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RegisterBody = {
  email?: string;
  password?: string;
  next?: string;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as RegisterBody | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  const nextPath = normalizeNextPath(body?.next);

  if (!email || password.length < 8) {
    return NextResponse.json(
      { error: "Email obbligatoria e password minimo 8 caratteri." },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabaseAdmin();
    const rateLimit = await checkRateLimit(supabase, {
      action: "register",
      identifier: `${getClientIp(request)}:${email}`,
      maxAttempts: 8,
      windowSeconds: 60 * 60,
      blockSeconds: 60 * 60,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Troppi tentativi. Riprova piu tardi." },
        { status: 429 }
      );
    }

    const user = await createAppUser(supabase, email, password);
    const token = await createAuthToken(
      supabase,
      user.id,
      "email_verification",
      60 * 24
    );
    const verifyUrl = new URL("/api/auth/verify-email", request.url);
    verifyUrl.searchParams.set("token", token);
    verifyUrl.searchParams.set("next", nextPath);

    await sendAuthEmail({
      to: email,
      subject: "Verifica email CRM",
      text: [
        "Conferma il tuo account CRM:",
        "",
        verifyUrl.toString(),
        "",
        "Il link scade tra 24 ore.",
      ].join("\n"),
    });

    return NextResponse.json({
      ok: true,
      message: "Account creato. Controlla la mail per confermare.",
    });
  } catch (error) {
    console.error("POST /api/auth/register failed", error);
    const message =
      error instanceof Error && error.message.includes("esistente")
        ? "Account gia esistente."
        : "Impossibile creare account.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
