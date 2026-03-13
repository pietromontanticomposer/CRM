import { NextResponse } from "next/server";
import { loadContactEmailHistory } from "@/lib/server/contactEmailHistory";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

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

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const emailParam = url.searchParams.get("email");

    const supabase = getSupabaseAdmin();
    const { data, error } = await loadContactEmailHistory<ContactEmailRow>(
      supabase,
      {
        contactId: id,
        emailText: emailParam,
        select:
          "id, contact_id, direction, gmail_uid, message_id_header, in_reply_to, references, from_email, from_name, to_email, subject, text_body, html_body, received_at, created_at, raw",
        limit: 2000,
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
        .eq("type", "email_received");

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
    console.error("GET /api/contacts/[id]/emails unexpected error", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Impossibile caricare le email.") },
      { status: 500 }
    );
  }
}
