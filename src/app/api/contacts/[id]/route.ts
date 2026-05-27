import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { linkExistingEmailsToContact } from "@/lib/server/linkContactEmails";
import { getOwnerFilter, isUnauthorizedError, requireCurrentUser } from "@/lib/server/currentUser";

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
  ai_batch_id?: string | null;
  ai_batch_name?: string | null;
  ai_status?: string;
  ai_email_subject?: string | null;
  ai_email_body?: string | null;
  verified_facts_json?: unknown;
  source_link?: string | null;
  prompt_master_rules?: string | null;
  ai_agent_checks_json?: unknown;
  ai_validation_summary?: string | null;
  ai_validation_status?: string;
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

const normalizeJsonField = (value: unknown, fallback: unknown) => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return value;
  if (value === null) return fallback;
  return undefined;
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
    ai_batch_id:
      payload.ai_batch_id === undefined
        ? undefined
        : normalizeNullableString(payload.ai_batch_id),
    ai_batch_name:
      payload.ai_batch_name === undefined
        ? undefined
        : normalizeNullableString(payload.ai_batch_name),
    ai_status:
      typeof payload.ai_status === "string"
        ? normalizeString(payload.ai_status)
        : undefined,
    ai_email_subject:
      payload.ai_email_subject === undefined
        ? undefined
        : normalizeNullableString(payload.ai_email_subject),
    ai_email_body:
      payload.ai_email_body === undefined
        ? undefined
        : normalizeNullableString(payload.ai_email_body),
    verified_facts_json: normalizeJsonField(payload.verified_facts_json, {}),
    source_link:
      payload.source_link === undefined
        ? undefined
        : normalizeNullableString(payload.source_link),
    prompt_master_rules:
      payload.prompt_master_rules === undefined
        ? undefined
        : normalizeNullableString(payload.prompt_master_rules),
    ai_agent_checks_json: normalizeJsonField(payload.ai_agent_checks_json, {}),
    ai_validation_summary:
      payload.ai_validation_summary === undefined
        ? undefined
        : normalizeNullableString(payload.ai_validation_summary),
    ai_validation_status:
      typeof payload.ai_validation_status === "string"
        ? normalizeString(payload.ai_validation_status)
        : undefined,
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
    const user = await requireCurrentUser(supabase);
    const ownerFilter = getOwnerFilter(user);
    const { data, error } = await supabase
      .from("contacts")
      .update({ ...updates, owner_id: user.id })
      .eq("id", id)
      .or(ownerFilter)
      .select("*")
      .single();

    if (error) {
      console.error(`PATCH /api/contacts/${id} failed`, error);
      return NextResponse.json(
        { error: getErrorMessage(error, "Impossibile aggiornare il contatto.") },
        { status: 500 }
      );
    }

    if (payload.email !== undefined) {
      try {
        await linkExistingEmailsToContact(
          supabase,
          data.id,
          data.email,
          user.id,
          user.canAccessLegacyData
        );
      } catch (linkError) {
        console.error(`PATCH /api/contacts/${id} email link failed`, linkError);
      }
    }

    if (markFollowUpRead) {
      const { error: notificationError } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("contact_id", id)
        .eq("type", "followup_due")
        .eq("is_read", false)
        .or(ownerFilter);

      if (notificationError) {
        console.error(
          `PATCH /api/contacts/${id} follow-up notification update failed`,
          notificationError
        );
      }
    }

    return NextResponse.json({ contact: data });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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
    const user = await requireCurrentUser(supabase);

    // The notifications.contact_id FK was created without ON DELETE CASCADE
    // (see migration 20260515120000), so for databases that haven't applied
    // the fix yet we clear dependent rows first to avoid a FK violation.
    const { error: notificationsError } = await supabase
      .from("notifications")
      .delete()
      .eq("contact_id", id);

    if (notificationsError) {
      console.error(
        `DELETE /api/contacts/${id} cleanup notifications failed`,
        notificationsError
      );
    }

    const { error } = await supabase
      .from("contacts")
      .delete()
      .eq("id", id)
      .or(getOwnerFilter(user));

    if (error) {
      console.error(`DELETE /api/contacts/${id} failed`, error);
      return NextResponse.json(
        { error: getErrorMessage(error, "Impossibile eliminare il contatto.") },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/contacts/[id] unexpected error", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Impossibile eliminare il contatto.") },
      { status: 500 }
    );
  }
}
