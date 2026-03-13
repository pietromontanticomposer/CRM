import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const escapeIlike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const extractEmails = (value?: string | null) => {
  if (!value) return [];
  const matches = value.match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
  );
  if (!matches) return [];
  const unique = new Set(matches.map((item) => item.toLowerCase()));
  return Array.from(unique);
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
    const query = supabase
      .from("emails")
      .select(
        "id, contact_id, direction, gmail_uid, message_id_header, from_email, from_name, to_email, subject, text_body, html_body, received_at, created_at, raw"
      )
      .order("received_at", { ascending: false });

    const emailList = extractEmails(emailParam);
    const emailFilters = [`contact_id.eq.${id}`];
    emailList.forEach((address) => {
      const safe = escapeIlike(address);
      emailFilters.push(`from_email.ilike.%${safe}%`);
      emailFilters.push(`to_email.ilike.%${safe}%`);
    });

    const { data, error } =
      emailFilters.length > 1
        ? await query.or(emailFilters.join(","))
        : await query.eq("contact_id", id);

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
