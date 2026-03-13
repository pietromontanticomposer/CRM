import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("email_id", id)
      .eq("type", "email_received");

    if (error) {
      console.error(`POST /api/emails/${id}/read failed`, error);
      return NextResponse.json(
        { error: "Impossibile aggiornare la notifica." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/emails/[id]/read unexpected error", error);
    return NextResponse.json(
      { error: "Impossibile aggiornare la notifica." },
      { status: 500 }
    );
  }
}
