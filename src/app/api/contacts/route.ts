import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { getAutomaticFollowUpStage } from "@/lib/followUp";
import { detectLanguageFromEmail, stripHtml } from "@/lib/languageDetection";
import { extractEmails, normalizeEmail } from "@/lib/server/emailMatching";
import { linkExistingEmailsToContact } from "@/lib/server/linkContactEmails";
import { getOwnerFilter, requireCurrentUser } from "@/lib/server/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ContactRow = {
  id: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
};

type ContactSection = "cinema" | "live_music";

const VALID_SECTIONS: readonly ContactSection[] = ["cinema", "live_music"];

const parseSection = (value: unknown): ContactSection => {
  if (typeof value === "string" && (VALID_SECTIONS as readonly string[]).includes(value)) {
    return value as ContactSection;
  }
  return "cinema";
};

const parseOptionalSection = (value: unknown): ContactSection | null => {
  if (typeof value === "string" && (VALID_SECTIONS as readonly string[]).includes(value)) {
    return value as ContactSection;
  }
  return null;
};

type ContactInsert = {
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  status: string;
  last_action_at: string | null;
  section: ContactSection;
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

type LanguageCandidateRow = {
  direction: "inbound" | "outbound" | null;
  from_email: string | null;
  to_email: string | null;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  received_at: string | null;
  created_at: string | null;
};

const CONTACT_SELECT_FIELDS =
  "id,name,email,company,role,status,last_action_at,last_action_note,next_action_at,next_action_note,notes,section,created_at,updated_at";

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
    section: parseSection(payload.section),
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

const escapeIlike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const detectLanguageForContactEmail = async (
  supabase: ReturnType<typeof getSupabaseAdmin>,
  email?: string | null,
  ownerId?: string | null,
  includeLegacy = false
) => {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const escaped = escapeIlike(normalized);
  const ownerModes =
    ownerId && includeLegacy ? ["owner", "legacy"] : ownerId ? ["owner"] : ["all"];
  const rows: LanguageCandidateRow[] = [];

  for (const ownerMode of ownerModes) {
    let query = supabase
      .from("emails")
      .select(
        "direction, from_email, to_email, subject, text_body, html_body, received_at, created_at"
      )
      .or(`from_email.ilike.%${escaped}%,to_email.ilike.%${escaped}%`)
      .limit(120);

    if (ownerMode === "owner" && ownerId) {
      query = query.eq("owner_id", ownerId);
    } else if (ownerMode === "legacy") {
      query = query.is("owner_id", null);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }
    rows.push(...(((data ?? []) as unknown) as LanguageCandidateRow[]));
  }

  let bestText: string | null = null;
  let bestTimestamp = 0;

  rows.forEach((row) => {
    const participants = new Set([
      ...extractEmails(row.from_email),
      ...extractEmails(row.to_email),
    ]);
    if (!participants.has(normalized)) return;

    const candidateTimestamp = Math.max(
      getTimestamp(row.received_at),
      getTimestamp(row.created_at)
    );
    if (candidateTimestamp <= bestTimestamp) return;

    bestTimestamp = candidateTimestamp;
    bestText = [row.text_body, stripHtml(row.html_body), row.subject]
      .filter(Boolean)
      .join(" ");
  });

  return detectLanguageFromEmail(bestText);
};

const detectLanguageFromEmailDomain = (email?: string | null) => {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const domain = normalized.split("@")[1]?.toLowerCase() ?? "";
  if (!domain) return null;
  if (domain.endsWith(".it")) return "it" as const;
  if (
    domain.endsWith(".com") ||
    domain.endsWith(".co.uk") ||
    domain.endsWith(".uk") ||
    domain.endsWith(".us") ||
    domain.endsWith(".ca") ||
    domain.endsWith(".au")
  ) {
    return "en" as const;
  }
  return null;
};

const detectLanguageForContactProfile = (contact: unknown) => {
  const source =
    contact && typeof contact === "object"
      ? (contact as Record<string, unknown>)
      : {};

  const profileText = [
    normalizeString(source.name),
    normalizeString(source.company),
    normalizeString(source.role),
  ]
    .filter(Boolean)
    .join(" ");

  const profileDetected = detectLanguageFromEmail(profileText);
  if (profileDetected) return profileDetected;

  const domainDetected = detectLanguageFromEmailDomain(
    normalizeNullableString(source.email)
  );
  if (domainDetected) return domainDetected;

  return "it" as const;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const section = parseOptionalSection(url.searchParams.get("section"));
    const supabase = getSupabaseAdmin();
    const user = await requireCurrentUser(supabase);
    const ownerFilter = getOwnerFilter(user);
    let contactsQuery = supabase
      .from("contacts")
      .select(CONTACT_SELECT_FIELDS)
      .or(ownerFilter)
      .order("updated_at", { ascending: false });
    if (section) {
      contactsQuery = contactsQuery.eq("section", section);
    }
    const [{ data, error }, { data: contactEmails, error: emailsError }] =
      await Promise.all([
        contactsQuery,
        supabase
          .from("emails")
          .select("id, contact_id, direction, received_at, created_at")
          .or(ownerFilter)
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
    const latestOutboundEmailIdByContactId = new Map<string, string>();

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
          latestOutboundEmailIdByContactId.set(email.contact_id, email.id);
        }
      }
    });

    const latestLanguageCandidateIds = Array.from(
      new Set([
        ...latestInboundEmailIdByContactId.values(),
        ...latestOutboundEmailIdByContactId.values(),
      ])
    );
    const latestInboundTextByEmailId = new Map<string, string>();

    if (latestLanguageCandidateIds.length > 0) {
      const idChunks = chunkArray(latestLanguageCandidateIds, 200);

      for (const chunk of idChunks) {
        const { data: inboundContentRows, error: inboundContentError } =
          await supabase
            .from("emails")
            .select("id, subject, text_body, html_body")
            .or(ownerFilter)
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

      const detectedFromLatestInbound = detectLanguageFromEmail(
        latestInboundTextByEmailId.get(
          latestInboundEmailIdByContactId.get(contact.id) ?? ""
        ) ?? null
      );
      const detectedFromLatestOutbound = detectLanguageFromEmail(
        latestInboundTextByEmailId.get(
          latestOutboundEmailIdByContactId.get(contact.id) ?? ""
        ) ?? null
      );
      const fallbackLanguage = detectLanguageForContactProfile(contact);

      return {
        ...contact,
        status: effectiveStatus,
        last_inbound_email_at: lastInboundAtByContactId.get(contact.id) ?? null,
        last_outbound_email_at: lastOutboundAtByContactId.get(contact.id) ?? null,
        activity_at: best,
        language:
          detectedFromLatestInbound ?? detectedFromLatestOutbound ?? fallbackLanguage,
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
    const user = await requireCurrentUser(supabase);
    const { data, error } = await supabase
      .from("contacts")
      .insert({ ...payload, owner_id: user.id })
      .select("*")
      .single();

    if (error) {
      console.error("POST /api/contacts failed", error);
      return NextResponse.json(
        { error: getErrorMessage(error, "Impossibile salvare il contatto.") },
        { status: 500 }
      );
    }

    try {
      await linkExistingEmailsToContact(
        supabase,
        data.id,
        data.email,
        user.id,
        user.canAccessLegacyData
      );
    } catch (linkError) {
      console.error("POST /api/contacts email link failed", linkError);
    }

    const language =
      (await detectLanguageForContactEmail(
        supabase,
        data.email,
        user.id,
        user.canAccessLegacyData
      )) ??
      detectLanguageForContactProfile(data);

    return NextResponse.json(
      {
        contact: {
          ...data,
          language,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/contacts unexpected error", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Impossibile salvare il contatto.") },
      { status: 500 }
    );
  }
}
