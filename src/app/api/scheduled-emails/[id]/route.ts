import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireCurrentUser } from "@/lib/server/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getEnv = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var ${key}`);
  return value;
};

const getSupabase = () =>
  createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id?.trim()) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const supabase = getSupabase();
    const currentUser = await requireCurrentUser(supabase);

    const { data, error } = await supabase
      .from("scheduled_emails")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("owner_id", currentUser.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("DELETE /api/scheduled-emails/[id] failed", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Email programmata non trovata." },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/scheduled-emails/[id] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore interno." },
      { status: 500 }
    );
  }
}
