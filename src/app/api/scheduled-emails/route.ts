import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getOwnerFilter, requireCurrentUser } from "@/lib/server/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Section = "cinema" | "live_music";
const VALID_SECTIONS: readonly Section[] = ["cinema", "live_music"];
const parseSection = (value: unknown): Section => {
  if (typeof value === "string" && (VALID_SECTIONS as readonly string[]).includes(value)) {
    return value as Section;
  }
  return "cinema";
};

const getEnv = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var ${key}`);
  return value;
};

const getSupabase = () =>
  createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

type SchedulePayload = {
  contactId?: string;
  to: string;
  subject?: string;
  text?: string;
  html?: string;
  replyToEmailId?: string;
  emailAccountId?: string;
  notificationKind?: string;
  sendAt: string; // YYYY-MM-DD
};

const isValidDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const section = parseSection(url.searchParams.get("section"));
    const supabase = getSupabase();
    const currentUser = await requireCurrentUser(supabase);

    const { data, error } = await supabase
      .from("scheduled_emails")
      .select(
        "id, to_email, subject, text_body, send_at, status, created_at, contact_id"
      )
      .eq("owner_id", currentUser.id)
      .eq("section", section)
      .eq("status", "pending")
      .order("send_at", { ascending: true });

    if (error) {
      console.error("GET /api/scheduled-emails failed", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, items: data });
  } catch (err) {
    console.error("GET /api/scheduled-emails unexpected error", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore interno." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    let payload: SchedulePayload;
    try {
      payload = (await request.json()) as SchedulePayload;
    } catch {
      return NextResponse.json({ ok: false, error: "Payload non valido." }, { status: 400 });
    }

    if (!payload?.to?.trim()) {
      return NextResponse.json({ ok: false, error: "Destinatario mancante." }, { status: 400 });
    }
    if (!payload?.sendAt || !isValidDate(payload.sendAt)) {
      return NextResponse.json(
        { ok: false, error: "Data invio non valida (YYYY-MM-DD)." },
        { status: 400 }
      );
    }

    const supabase = getSupabase();
    const currentUser = await requireCurrentUser(supabase);
    const ownerFilter = getOwnerFilter(currentUser);

    const contactId = payload.contactId?.trim() || null;
    if (contactId) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("id")
        .eq("id", contactId)
        .or(ownerFilter)
        .maybeSingle();
      if (!contact) {
        return NextResponse.json(
          { ok: false, error: "Contatto non trovato." },
          { status: 404 }
        );
      }
    }

    const { data, error } = await supabase
      .from("scheduled_emails")
      .insert({
        owner_id: currentUser.id,
        contact_id: contactId,
        email_account_id: payload.emailAccountId?.trim() || null,
        to_email: payload.to.trim(),
        subject: payload.subject?.trim() || null,
        text_body: payload.text?.trim() || null,
        html_body: payload.html?.trim() || null,
        reply_to_email_id: payload.replyToEmailId?.trim() || null,
        notification_kind: payload.notificationKind || null,
        send_at: payload.sendAt,
      })
      .select("id, send_at")
      .single();

    if (error) {
      console.error("POST /api/scheduled-emails failed", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, scheduled: data });
  } catch (err) {
    console.error("POST /api/scheduled-emails unexpected error", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Errore interno." },
      { status: 500 }
    );
  }
}
