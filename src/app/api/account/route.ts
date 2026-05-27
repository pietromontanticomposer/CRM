import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { isUnauthorizedError, requireCurrentUser } from "@/lib/server/currentUser";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireCurrentUser(supabase);
    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        legacy: user.canAccessLegacyData,
      },
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }
}

export async function DELETE() {
  const supabase = getSupabaseAdmin();
  let user: Awaited<ReturnType<typeof requireCurrentUser>>;
  try {
    user = await requireCurrentUser(supabase);
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }
  if (user.canAccessLegacyData) {
    return NextResponse.json(
      { error: "Account principale non eliminabile da qui." },
      { status: 400 }
    );
  }

  const { error } = await supabase.from("app_users").delete().eq("id", user.id);
  if (error) {
    return NextResponse.json(
      { error: "Impossibile eliminare account." },
      { status: 500 }
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    path: "/",
    maxAge: 0,
  });
  return response;
}
