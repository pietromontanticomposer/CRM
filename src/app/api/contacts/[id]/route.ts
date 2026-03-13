import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type ContactUpdate = {
  name?: string;
  email?: string | null;
  company?: string | null;
  role?: string | null;
  status?: string;
  last_action_at?: string | null;
  last_action_note?: string | null;
  next_action_at?: string | null;
  next_action_note?: string | null;
  notes?: string | null;
  mark_followup_read?: boolean;
};

const normalizeString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const normalizeNullableString = (value: unknown) => {
  const normalized = normalizeString(value);
  return normalized || null;
};

const normalizeUpdatePayload = (value: unknown): ContactUpdate | null => {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;

  return {
    name:
      typeof payload.name === "string" ? normalizeString(payload.name) : undefined,
    email:
      payload.email === undefined
        ? undefined
        : normalizeNullableString(payload.email),
    company:
      payload.company === undefined
        ? undefined
        : normalizeNullableString(payload.company),
    role:
      payload.role === undefined ? undefined : normalizeNullableString(payload.role),
    status:
      typeof payload.status === "string"
        ? normalizeString(payload.status)
        : undefined,
    last_action_at:
      payload.last_action_at === undefined
        ? undefined
        : normalizeNullableString(payload.last_action_at),
    last_action_note:
      payload.last_action_note === undefined
        ? undefined
        : normalizeNullableString(payload.last_action_note),
    next_action_at:
      payload.next_action_at === undefined
        ? undefined
        : normalizeNullableString(payload.next_action_at),
    next_action_note:
      payload.next_action_note === undefined
        ? undefined
        : normalizeNullableString(payload.next_action_note),
    notes:
      payload.notes === undefined ? undefined : normalizeNullableString(payload.notes),
    mark_followup_read: Boolean(payload.mark_followup_read),
  };
};

const getErrorMessage = (error: unknown, fallback: string) => {
  const details = [
    error instanceof Error ? error.message : "",
    typeof error === "object" && error
      ? JSON.stringify(error, Object.getOwnPropertyNames(error))
      : String(error),
  ]
    .join(" ")
    .toLowerCase();

  if (details.includes("enotfound") || details.includes("fetch failed")) {
    return "Database non raggiungibile. Controlla SUPABASE_URL o che il progetto Supabase esista ancora.";
  }

  return fallback;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    const payload = normalizeUpdatePayload(body);

    if (!payload) {
      return NextResponse.json(
        { error: "Payload aggiornamento non valido." },
        { status: 400 }
      );
    }

    const { mark_followup_read: markFollowUpRead, ...updates } = payload;
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("contacts")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      console.error(`PATCH /api/contacts/${id} failed`, error);
      return NextResponse.json(
        { error: getErrorMessage(error, "Impossibile aggiornare il contatto.") },
        { status: 500 }
      );
    }

    if (markFollowUpRead) {
      const { error: notificationError } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("contact_id", id)
        .eq("type", "followup_due")
        .eq("is_read", false);

      if (notificationError) {
        console.error(
          `PATCH /api/contacts/${id} follow-up notification update failed`,
          notificationError
        );
      }
    }

    return NextResponse.json({ contact: data });
  } catch (error) {
    console.error("PATCH /api/contacts/[id] unexpected error", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Impossibile aggiornare il contatto.") },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("contacts").delete().eq("id", id);

    if (error) {
      console.error(`DELETE /api/contacts/${id} failed`, error);
      return NextResponse.json(
        { error: getErrorMessage(error, "Impossibile eliminare il contatto.") },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/contacts/[id] unexpected error", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Impossibile eliminare il contatto.") },
      { status: 500 }
    );
  }
}
