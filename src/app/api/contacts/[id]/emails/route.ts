import { NextResponse } from "next/server";
import { loadContactEmailHistory } from "@/lib/server/contactEmailHistory";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { getOwnerFilter, isUnauthorizedError, requireCurrentUser } from "@/lib/server/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type ContactEmailRow = {
  id: string;
  contact_id: string | null;
  direction: "inbound" | "outbound" | null;
  gmail_uid: number | null;
  message_id_header: string | null;
  in_reply_to: string | null;
  references: string | null;
  from_email: string | null;
  from_name: string | null;
  to_email: string | null;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  received_at: string | null;
  created_at: string | null;
  raw: Record<string, unknown> | null;
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

  if (
    details.includes("enotfound") ||
    details.includes("fetch failed") ||
    details.includes("timed out")
  ) {
    return "Database non raggiungibile.";
  }

  return fallback;
};

const parseLimit = (value: string | null) => {
  const parsed = Number(value ?? 150);
  if (!Number.isFinite(parsed)) return 150;
  return Math.max(50, Math.min(500, Math.floor(parsed)));
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const emailParam = url.searchParams.get("email");
    const limit = parseLimit(url.searchParams.get("limit"));

    const supabase = getSupabaseAdmin();
    const user = await requireCurrentUser(supabase);
    const ownerFilter = getOwnerFilter(user);

    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", id)
      .or(ownerFilter)
      .maybeSingle();

    if (contactError) {
      throw contactError;
    }

    if (!contact) {
      return NextResponse.json(
        { error: "Contatto non trovato." },
        { status: 404 }
      );
    }

    const { data, error } = await loadContactEmailHistory<ContactEmailRow>(
      supabase,
      {
        contactId: id,
        emailText: emailParam,
        select:
          "id, contact_id, direction, gmail_uid, message_id_header, in_reply_to, references, from_email, from_name, to_email, subject, text_body, html_body, received_at, created_at, raw",
        limit,
        ownerId: user.id,
        includeLegacy: user.canAccessLegacyData,
      }
    );

    if (error) {
      console.error(`GET /api/contacts/${id}/emails failed`, error);
      return NextResponse.json(
        { error: getErrorMessage(error, "Impossibile caricare le email.") },
        { status: 500 }
      );
    }

    const emails = data ?? [];
    const readMap: Record<string, boolean> = {};
    emails.forEach((row) => {
      readMap[row.id] = true;
    });

    const inboundIds = emails
      .filter((row) => row.direction === "inbound")
      .map((row) => row.id);

    if (inboundIds.length) {
      const { data: notifications, error: notificationsError } = await supabase
        .from("notifications")
        .select("email_id, is_read")
        .in("email_id", inboundIds)
        .eq("type", "email_received")
        .or(ownerFilter);

      if (!notificationsError && notifications) {
        notifications.forEach((notification) => {
          if (!notification.email_id) return;
          const isRead = Boolean(notification.is_read);
          if (readMap[notification.email_id] === undefined) {
            readMap[notification.email_id] = isRead;
          } else {
            readMap[notification.email_id] =
              readMap[notification.email_id] && isRead;
          }
        });
      }
    }

    return NextResponse.json({ emails, readMap });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/contacts/[id]/emails unexpected error", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Impossibile caricare le email.") },
      { status: 500 }
    );
  }
}
