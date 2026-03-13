import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ContactRow = {
  id: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
};

type ContactInsert = {
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  status: string;
  last_action_at: string | null;
};

const normalizeString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const normalizeNullableString = (value: unknown) => {
  const normalized = normalizeString(value);
  return normalized || null;
};

const normalizeCreatePayload = (value: unknown): ContactInsert | null => {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const name = normalizeString(payload.name);
  const company = normalizeString(payload.company);

  if (!name && !company) {
    return null;
  }

  const status = normalizeString(payload.status) || "Da contattare";
  const lastActionAt =
    status === "Già contattato"
      ? normalizeString(payload.last_action_at) || null
      : null;

  return {
    name,
    email: normalizeNullableString(payload.email),
    company: company || null,
    role: normalizeNullableString(payload.role),
    status,
    last_action_at: lastActionAt,
  };
};

const getTimestamp = (value?: string | null) => {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const sortContactsByActivity = <TRow extends ContactRow>(
  contacts: TRow[],
  lastInboundAtByContactId: Map<string, string>
) =>
  [...contacts].sort((a, b) => {
    const aActivity = Math.max(
      getTimestamp(a.updated_at),
      getTimestamp(lastInboundAtByContactId.get(a.id)),
      getTimestamp(a.created_at)
    );
    const bActivity = Math.max(
      getTimestamp(b.updated_at),
      getTimestamp(lastInboundAtByContactId.get(b.id)),
      getTimestamp(b.created_at)
    );

    if (aActivity !== bActivity) {
      return bActivity - aActivity;
    }

    return getTimestamp(b.created_at) - getTimestamp(a.created_at);
  });

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

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("GET /api/contacts failed", error);
      return NextResponse.json(
        { error: getErrorMessage(error, "Impossibile caricare i contatti.") },
        { status: 500 }
      );
    }

    const { data: inboundEmails, error: inboundEmailsError } = await supabase
      .from("emails")
      .select("contact_id, received_at, created_at")
      .eq("direction", "inbound")
      .not("contact_id", "is", null);

    if (inboundEmailsError) {
      console.error("GET /api/contacts inbound email fetch failed", inboundEmailsError);
      return NextResponse.json(
        { error: getErrorMessage(inboundEmailsError, "Impossibile caricare i contatti.") },
        { status: 500 }
      );
    }

    const lastInboundAtByContactId = new Map<string, string>();
    (inboundEmails ?? []).forEach((row) => {
      if (!row.contact_id) return;
      const candidate = row.received_at ?? row.created_at ?? null;
      if (!candidate) return;
      const current = lastInboundAtByContactId.get(row.contact_id);
      if (getTimestamp(candidate) > getTimestamp(current)) {
        lastInboundAtByContactId.set(row.contact_id, candidate);
      }
    });

    const contacts = sortContactsByActivity(
      ((data ?? []) as unknown) as ContactRow[],
      lastInboundAtByContactId
    ).map((contact) => ({
      ...contact,
      last_inbound_email_at: lastInboundAtByContactId.get(contact.id) ?? null,
      activity_at: (() => {
        const candidates = [
          contact.updated_at,
          lastInboundAtByContactId.get(contact.id) ?? null,
          contact.created_at,
        ];
        let best: string | null = null;
        candidates.forEach((value) => {
          if (!value) return;
          if (getTimestamp(value) > getTimestamp(best)) {
            best = value;
          }
        });
        return best;
      })(),
    }));

    return NextResponse.json({ contacts });
  } catch (error) {
    console.error("GET /api/contacts unexpected error", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Impossibile caricare i contatti.") },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const payload = normalizeCreatePayload(body);

    if (!payload) {
      return NextResponse.json(
        { error: "Inserisci nome oppure produzione." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("contacts")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      console.error("POST /api/contacts failed", error);
      return NextResponse.json(
        { error: getErrorMessage(error, "Impossibile salvare il contatto.") },
        { status: 500 }
      );
    }

    return NextResponse.json({ contact: data }, { status: 201 });
  } catch (error) {
    console.error("POST /api/contacts unexpected error", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Impossibile salvare il contatto.") },
      { status: 500 }
    );
  }
}
