import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { getAutomaticFollowUpStage } from "@/lib/followUp";
import { detectLanguageFromEmail, stripHtml } from "@/lib/languageDetection";

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

type ContactEmailRow = {
  id: string;
  contact_id: string | null;
  direction: "inbound" | "outbound" | null;
  received_at: string | null;
  created_at: string | null;
};

type ContactEmailContentRow = {
  id: string;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
};

const CONTACT_SELECT_FIELDS =
  "id,name,email,company,role,status,last_action_at,last_action_note,next_action_at,next_action_note,notes,created_at,updated_at";

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

  const status = normalizeString(payload.status) || "Attiva auto follow-up";
  const lastActionAt = null;

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

const chunkArray = <T,>(items: T[], chunkSize: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const [{ data, error }, { data: contactEmails, error: emailsError }] =
      await Promise.all([
        supabase
          .from("contacts")
          .select(CONTACT_SELECT_FIELDS)
          .order("updated_at", { ascending: false }),
        supabase
          .from("emails")
          .select("id, contact_id, direction, received_at, created_at")
          .not("contact_id", "is", null),
      ]);

    if (error) {
      console.error("GET /api/contacts failed", error);
      return NextResponse.json(
        { error: getErrorMessage(error, "Impossibile caricare i contatti.") },
        { status: 500 }
      );
    }

    if (emailsError) {
      console.error("GET /api/contacts emails fetch failed", emailsError);
      return NextResponse.json(
        { error: getErrorMessage(emailsError, "Impossibile caricare i contatti.") },
        { status: 500 }
      );
    }

    const lastInboundAtByContactId = new Map<string, string>();
    const lastOutboundAtByContactId = new Map<string, string>();
    const latestInboundEmailIdByContactId = new Map<string, string>();

    (contactEmails ?? []).forEach((row) => {
      const email = row as unknown as ContactEmailRow;
      if (!email.contact_id) return;
      const candidate = email.received_at ?? email.created_at ?? null;
      if (!candidate) return;
      
      if (email.direction === "inbound") {
        const current = lastInboundAtByContactId.get(email.contact_id);
        if (getTimestamp(candidate) > getTimestamp(current)) {
          lastInboundAtByContactId.set(email.contact_id, candidate);
          latestInboundEmailIdByContactId.set(email.contact_id, email.id);
        }
      } else if (email.direction === "outbound") {
        const current = lastOutboundAtByContactId.get(email.contact_id);
        if (getTimestamp(candidate) > getTimestamp(current)) {
          lastOutboundAtByContactId.set(email.contact_id, candidate);
        }
      }
    });

    const latestInboundIds = Array.from(
      new Set(latestInboundEmailIdByContactId.values())
    );
    const latestInboundTextByEmailId = new Map<string, string>();

    if (latestInboundIds.length > 0) {
      const idChunks = chunkArray(latestInboundIds, 200);

      for (const chunk of idChunks) {
        const { data: inboundContentRows, error: inboundContentError } =
          await supabase
            .from("emails")
            .select("id, subject, text_body, html_body")
            .in("id", chunk);

        if (inboundContentError) {
          console.error(
            "GET /api/contacts latest inbound content fetch failed",
            inboundContentError
          );
          return NextResponse.json(
            {
              error: getErrorMessage(
                inboundContentError,
                "Impossibile caricare i contatti."
              ),
            },
            { status: 500 }
          );
        }

        (inboundContentRows ?? []).forEach((row) => {
          const inbound = row as unknown as ContactEmailContentRow;
          latestInboundTextByEmailId.set(
            inbound.id,
            [inbound.text_body, stripHtml(inbound.html_body), inbound.subject]
              .filter(Boolean)
              .join(" ")
          );
        });
      }
    }

    const contacts = sortContactsByActivity(
      ((data ?? []) as unknown) as ContactRow[],
      lastInboundAtByContactId
    ).map((contact) => {
      const lastInbound = getTimestamp(lastInboundAtByContactId.get(contact.id));
      const lastOutbound = getTimestamp(lastOutboundAtByContactId.get(contact.id));
      
      const stage = getAutomaticFollowUpStage(contact.next_action_note as string);
      let effectiveStatus = stage ? "Attiva auto follow-up" : contact.status;

      // Se non hanno mai risposto e abbiamo mandato almeno una mail,
      // e lo stato non è già uno di quelli terminali o l'auto follow-up
      if (!lastInbound && lastOutbound > 0 && effectiveStatus !== "Attiva auto follow-up" && !["Non interessato", "Call prenotata", "Mantenimento rapporto", "Collaborazione stabilita"].includes(contact.status as string)) {
        effectiveStatus = "In attesa";
      }

      const candidates = [
        contact.updated_at as string,
        lastInboundAtByContactId.get(contact.id) ?? null,
        lastOutboundAtByContactId.get(contact.id) ?? null,
        contact.created_at as string,
      ];
      let best: string | null = null;
      candidates.forEach((value) => {
        if (!value) return;
        if (getTimestamp(value) > getTimestamp(best)) {
          best = value;
        }
      });

      return {
        ...contact,
        status: effectiveStatus,
        last_inbound_email_at: lastInboundAtByContactId.get(contact.id) ?? null,
        last_outbound_email_at: lastOutboundAtByContactId.get(contact.id) ?? null,
        activity_at: best,
        language: detectLanguageFromEmail(
          latestInboundTextByEmailId.get(
            latestInboundEmailIdByContactId.get(contact.id) ?? ""
          ) ?? null
        ),
      };
    });

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
