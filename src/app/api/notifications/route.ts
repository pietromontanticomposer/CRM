import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { getOwnerFilter, isUnauthorizedError, requireCurrentUser } from "@/lib/server/currentUser";
import { isLegacySchemaError } from "@/lib/server/supabaseSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const AUTOMATION_SCOPE = "automation";

type Section = "cinema" | "live_music";
const VALID_SECTIONS: readonly Section[] = ["cinema", "live_music"];
const parseSection = (value: unknown): Section => {
  if (typeof value === "string" && (VALID_SECTIONS as readonly string[]).includes(value)) {
    return value as Section;
  }
  return "cinema";
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
  const parsed = Number(value ?? 10);
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(1, Math.min(200, Math.floor(parsed)));
};

const normalizeScope = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : AUTOMATION_SCOPE;

const isAutomationNotification = (row: {
  type?: string | null;
  title?: string | null;
}) => {
  if (row.type !== "email_sent") return false;
  const title = row.title?.trim().toLowerCase() ?? "";
  return (
    title.startsWith("follow-up automatico inviato") ||
    title.startsWith("follow-up inviato") ||
    title.startsWith("mantenimento rapporto inviato")
  );
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scope = normalizeScope(url.searchParams.get("scope"));
    const limit = parseLimit(url.searchParams.get("limit"));
    const section = parseSection(url.searchParams.get("section"));

    const supabase = getSupabaseAdmin();
    const user = await requireCurrentUser(supabase);
    const legacyMode = user.usesLegacySchema;
    if (legacyMode && section === "live_music") {
      return NextResponse.json({ notifications: [] });
    }
    let query = supabase
      .from("notifications")
      .select("id, type, contact_id, email_id, title, body, is_read, created_at")
      .order("created_at", { ascending: false })
      .limit(scope === AUTOMATION_SCOPE ? Math.max(limit * 3, 100) : limit);

    if (!legacyMode) {
      query = query.or(getOwnerFilter(user)).eq("section", section);
    }

    if (scope === AUTOMATION_SCOPE) {
      query = query.eq("type", "email_sent");
    }

    const { data, error } = await query;

    if (error) {
      if (isLegacySchemaError(error, ["owner_id", "section"])) {
        return NextResponse.json({ notifications: [] });
      }
      console.error("GET /api/notifications failed", error);
      return NextResponse.json(
        {
          error: getErrorMessage(
            error,
            "Impossibile caricare le notifiche del CRM."
          ),
        },
        { status: 500 }
      );
    }

    const notifications =
      scope === AUTOMATION_SCOPE
        ? (data ?? []).filter(isAutomationNotification).slice(0, limit)
        : (data ?? []);

    return NextResponse.json({ notifications });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/notifications unexpected error", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Impossibile caricare le notifiche del CRM.") },
      { status: 500 }
    );
  }
}

type PatchBody = {
  scope?: string;
  markAll?: boolean;
  notificationId?: string;
  section?: string;
};

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as PatchBody | null;
    const scope = normalizeScope(body?.scope);
    const notificationId =
      typeof body?.notificationId === "string" ? body.notificationId.trim() : "";
    const markAll = Boolean(body?.markAll);
    const section = parseSection(body?.section);

    if (!markAll && !notificationId) {
      return NextResponse.json(
        { error: "Richiesta non valida." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const user = await requireCurrentUser(supabase);
    const legacyMode = user.usesLegacySchema;
    if (markAll) {
      let updateQuery = supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("is_read", false);

      if (!legacyMode) {
        updateQuery = updateQuery.eq("section", section).or(getOwnerFilter(user));
      }

      if (scope === AUTOMATION_SCOPE) {
        updateQuery = updateQuery.eq("type", "email_sent");
      }

      const { error, count } = await updateQuery;

      if (error) {
        console.error("PATCH /api/notifications markAll failed", error);
        return NextResponse.json(
          {
            error: getErrorMessage(
              error,
              "Impossibile segnare le notifiche come lette."
            ),
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ ok: true, updated: count ?? 0 });
    }

    const { data: current, error: currentError } = await supabase
      .from("notifications")
      .select("id, type, title")
      .eq("id", notificationId)
      .maybeSingle();

    if (!legacyMode) {
      const ownerFilteredCurrent = await supabase
        .from("notifications")
        .select("id, type, title")
        .eq("id", notificationId)
        .or(getOwnerFilter(user))
        .maybeSingle();

      if (ownerFilteredCurrent.error) {
        console.error("PATCH /api/notifications single fetch failed", ownerFilteredCurrent.error);
        return NextResponse.json(
          {
            error: getErrorMessage(
              ownerFilteredCurrent.error,
              "Impossibile segnare la notifica come letta."
            ),
          },
          { status: 500 }
        );
      }

      if (!ownerFilteredCurrent.data) {
        return NextResponse.json(
          { error: "Notifica non trovata." },
          { status: 404 }
        );
      }

      if (scope === AUTOMATION_SCOPE && !isAutomationNotification(ownerFilteredCurrent.data)) {
        return NextResponse.json(
          { error: "Notifica non trovata." },
          { status: 404 }
        );
      }

      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notificationId);

      if (error) {
        console.error("PATCH /api/notifications single update failed", error);
        return NextResponse.json(
          {
            error: getErrorMessage(
              error,
              "Impossibile segnare la notifica come letta."
            ),
          },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true });
    }

    if (currentError) {
      console.error("PATCH /api/notifications single fetch failed", currentError);
      return NextResponse.json(
        {
          error: getErrorMessage(
            currentError,
            "Impossibile segnare la notifica come letta."
          ),
        },
        { status: 500 }
      );
    }

    if (!current) {
      return NextResponse.json(
        { error: "Notifica non trovata." },
        { status: 404 }
      );
    }

    if (scope === AUTOMATION_SCOPE && !isAutomationNotification(current)) {
      return NextResponse.json(
        { error: "Notifica non trovata." },
        { status: 404 }
      );
    }

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", notificationId);

    if (error) {
      console.error("PATCH /api/notifications single update failed", error);
      return NextResponse.json(
        {
          error: getErrorMessage(
            error,
            "Impossibile segnare la notifica come letta."
          ),
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PATCH /api/notifications unexpected error", error);
    return NextResponse.json(
      {
        error: getErrorMessage(
          error,
          "Impossibile aggiornare le notifiche del CRM."
        ),
      },
      { status: 500 }
    );
  }
}
