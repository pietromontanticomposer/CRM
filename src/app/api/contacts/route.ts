import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { getAutomaticFollowUpStage } from "@/lib/followUp";
import { detectLanguageFromEmail, stripHtml } from "@/lib/languageDetection";
import { extractEmails, normalizeEmail } from "@/lib/server/emailMatching";
import { linkExistingEmailsToContact } from "@/lib/server/linkContactEmails";
import { getOwnerFilter, isUnauthorizedError, requireCurrentUser } from "@/lib/server/currentUser";
import { isLegacySchemaError } from "@/lib/server/supabaseSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Import registi: se cade nel fallback sequenziale (raro) do' piu' tempo alla
// funzione per non tagliare l'import a meta' (default Vercel troppo corto).
export const maxDuration = 60;

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
  email_source_url?: string | null;
  email_source_type?: string | null;
  email_confidence?: number | null;
  email_enrichment_status?: string | null;
  email_found_at?: string | null;
};

type ContactEmailRow = {
  id: string;
  contact_id: string | null;
  direction: "inbound" | "outbound" | null;
  received_at: string | null;
  created_at: string | null;
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

type OutreachImportRow = {
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  status: string;
  notes: string | null;
  section: ContactSection;
  draft_subject: string | null;
  draft_body: string | null;
  source_link: string | null;
  verified_facts_json: unknown;
  prompt_master_rules: string | null;
  email_source_url: string | null;
  email_source_type: string | null;
  email_confidence: number | null;
  email_enrichment_status: string | null;
};

type OutreachImportPayload = {
  batchName: string;
  section: ContactSection;
  contacts: OutreachImportRow[];
};

const CONTACT_SELECT_FIELDS =
  "id,name,email,company,role,status,last_action_at,last_action_note,next_action_at,next_action_note,notes,section,language,ai_batch_id,ai_batch_name,ai_status,ai_email_subject,ai_email_body,verified_facts_json,source_link,prompt_master_rules,ai_agent_checks_json,ai_validation_summary,ai_validation_status,ai_send_allowed,ai_template_used,ai_risk_score,ai_link_visione,email_source_url,email_source_type,email_confidence,email_found_at,email_enrichment_status,email_enrichment_reason,created_at,updated_at";
const LEGACY_CONTACT_SELECT_FIELDS =
  "id,name,email,company,role,status,last_action_at,last_action_note,next_action_at,next_action_note,notes,created_at,updated_at";

const normalizeString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const normalizeNullableString = (value: unknown) => {
  const normalized = normalizeString(value);
  return normalized || null;
};

const normalizeJsonValue = (value: unknown, fallback: unknown) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return value;
  return fallback;
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
    notes: normalizeNullableString(payload.notes),
  };
};

// Difensiva server-side: anche se il client manda l'intero testo digitato
// dall'utente come name (es. cache browser vecchia con extractName non
// aggiornata), il server riduce a "prime 2 parole / prima virgola" come fa
// il client. Cosi' "diego carli monitus verona regista" -> "diego carli".
const normalizeContactName = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const beforeBreak = trimmed.split(/[,\n(]/)[0]?.trim();
  if (
    beforeBreak &&
    beforeBreak.length <= 80 &&
    beforeBreak.length < trimmed.length
  ) {
    return beforeBreak;
  }
  // Se 5+ parole senza virgola, tronca a 2 (probabile input non normalizzato)
  const words = trimmed.split(/\s+/);
  if (words.length >= 5) {
    return words.slice(0, 2).join(" ").slice(0, 80);
  }
  return trimmed.slice(0, 80);
};

const normalizeOutreachImportRow = (
  value: unknown,
  fallbackSection: ContactSection,
  fallbackPromptMasterRules: string | null
): OutreachImportRow | null => {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const rawName = normalizeString(payload.name);
  const name = normalizeContactName(rawName);
  const company = normalizeString(payload.company);

  if (!name && !company) {
    return null;
  }

  return {
    name,
    email: normalizeNullableString(payload.email),
    company: company || null,
    role: normalizeNullableString(payload.role),
    status: normalizeString(payload.status) || "Attiva auto follow-up",
    notes: normalizeNullableString(payload.notes),
    section: parseOptionalSection(payload.section) ?? fallbackSection,
    draft_subject:
      normalizeNullableString(payload.draftSubject) ??
      normalizeNullableString(payload.draft_subject),
    draft_body:
      normalizeNullableString(payload.draftBody) ??
      normalizeNullableString(payload.draft_body),
    source_link:
      normalizeNullableString(payload.sourceLink) ??
      normalizeNullableString(payload.source_link),
    verified_facts_json: normalizeJsonValue(
      (payload.verifiedFactsJson ?? payload.verified_facts_json) as unknown,
      {}
    ),
    prompt_master_rules:
      normalizeNullableString(payload.promptMasterRules) ??
      normalizeNullableString(payload.prompt_master_rules) ??
      fallbackPromptMasterRules,
    email_source_url:
      normalizeNullableString(payload.email_source_url) ??
      normalizeNullableString(payload.emailSourceUrl),
    email_source_type:
      normalizeNullableString(payload.email_source_type) ??
      normalizeNullableString(payload.emailSourceType),
    email_confidence: (() => {
      const value =
        (payload.email_confidence as unknown) ??
        (payload.emailConfidence as unknown);
      if (typeof value === "number" && Number.isFinite(value)) {
        return Math.max(0, Math.min(1, value));
      }
      return null;
    })(),
    email_enrichment_status:
      normalizeNullableString(payload.email_enrichment_status) ??
      normalizeNullableString(payload.email_status) ??
      normalizeNullableString(payload.emailStatus),
  };
};

const normalizeOutreachImportPayload = (
  value: unknown
): OutreachImportPayload | null => {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (payload.mode !== "outreach_import") return null;

  const section = parseSection(payload.section);
  const promptMasterRules =
    normalizeNullableString(payload.promptMasterRules) ??
    normalizeNullableString(payload.prompt_master_rules);
  const contacts = Array.isArray(payload.contacts)
    ? payload.contacts
        .map((item) =>
          normalizeOutreachImportRow(item, section, promptMasterRules)
        )
        .filter(Boolean)
    : [];

  if (!contacts.length) {
    return null;
  }

  return {
    batchName:
      normalizeString(payload.batchName) ||
      normalizeString(payload.batch_name) ||
      `AI Outreach ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    section,
    contacts: contacts as OutreachImportRow[],
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

const escapeIlike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const mapLegacyContact = (contact: ContactRow) => {
  const stage = getAutomaticFollowUpStage(contact.next_action_note as string);
  return {
    ...contact,
    status: stage ? "Attiva auto follow-up" : contact.status,
    section: "cinema" as const,
    last_inbound_email_at: null,
    last_outbound_email_at: null,
    activity_at: (contact.updated_at as string) || (contact.created_at as string),
    language: detectLanguageForContactProfile(contact),
    ai_batch_id: null,
    ai_batch_name: null,
    ai_status: "not_checked",
    ai_email_subject: null,
    ai_email_body: null,
    verified_facts_json: {},
    source_link: null,
    prompt_master_rules: null,
    ai_agent_checks_json: {},
    ai_validation_summary: null,
    ai_validation_status: "not_checked",
  };
};

const withAiDefaults = (contact: ContactRow) => ({
  ...contact,
  ai_batch_id:
    typeof contact.ai_batch_id === "string" ? contact.ai_batch_id : null,
  ai_batch_name:
    typeof contact.ai_batch_name === "string" ? contact.ai_batch_name : null,
  ai_status: typeof contact.ai_status === "string" ? contact.ai_status : "not_checked",
  ai_email_subject:
    typeof contact.ai_email_subject === "string" ? contact.ai_email_subject : null,
  ai_email_body:
    typeof contact.ai_email_body === "string" ? contact.ai_email_body : null,
  verified_facts_json: normalizeJsonValue(contact.verified_facts_json, {}),
  source_link: typeof contact.source_link === "string" ? contact.source_link : null,
  prompt_master_rules:
    typeof contact.prompt_master_rules === "string"
      ? contact.prompt_master_rules
      : null,
  ai_agent_checks_json: normalizeJsonValue(contact.ai_agent_checks_json, {}),
  ai_validation_summary:
    typeof contact.ai_validation_summary === "string"
      ? contact.ai_validation_summary
      : null,
  ai_validation_status:
    typeof contact.ai_validation_status === "string"
      ? contact.ai_validation_status
      : "not_checked",
});

const findExistingOutreachContact = async (
  supabase: ReturnType<typeof getSupabaseAdmin>,
  ownerFilter: string,
  row: OutreachImportRow
) => {
  if (row.email) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id")
      .or(ownerFilter)
      .ilike("email", row.email)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data?.id) {
      return data;
    }
  }

  let query = supabase
    .from("contacts")
    .select("id")
    .or(ownerFilter)
    .ilike("name", row.name);

  if (row.company) {
    query = query.ilike("company", row.company);
  }

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) {
    throw error;
  }
  return data;
};

const loadLegacyContacts = async (
  supabase: ReturnType<typeof getSupabaseAdmin>,
  section: ContactSection | null
) => {
  if (section === "live_music") {
    return [] as ReturnType<typeof mapLegacyContact>[];
  }

  const { data, error } = await supabase
    .from("contacts")
    .select(LEGACY_CONTACT_SELECT_FIELDS)
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  return sortContactsByActivity(
    ((data ?? []) as unknown) as ContactRow[],
    new Map<string, string>()
  ).map(mapLegacyContact);
};

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
  // Italian ccTLD → strong signal for IT.
  if (domain.endsWith(".it")) return "it" as const;
  // Country-specific anglophone ccTLDs → strong signal for EN. We
  // intentionally do NOT treat .com/.org/.net as english — those are
  // generic and used heavily by Italian companies (and by gmail.com).
  if (
    domain.endsWith(".co.uk") ||
    domain.endsWith(".uk") ||
    domain.endsWith(".us") ||
    domain.endsWith(".ca") ||
    domain.endsWith(".au") ||
    domain.endsWith(".ie") ||
    domain.endsWith(".nz")
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
    if (user.usesLegacySchema) {
      return NextResponse.json({
        contacts: await loadLegacyContacts(supabase, section),
      });
    }
    const ownerFilter = getOwnerFilter(user);
    let contactsQuery = supabase
      .from("contacts")
      .select(CONTACT_SELECT_FIELDS)
      .or(ownerFilter)
      .order("updated_at", { ascending: false });
    if (section) {
      contactsQuery = contactsQuery.eq("section", section);
    }
    const { data, error } = await contactsQuery;

    if (error) {
      if (
        isLegacySchemaError(error, [
          "owner_id",
          "section",
          "language",
          "ai_status",
          "ai_validation_status",
          "ai_agent_checks_json",
          "ai_batch_id",
          "ai_batch_name",
          "ai_email_subject",
          "ai_email_body",
          "ai_validation_summary",
          "ai_send_allowed",
          "verified_facts_json",
          "source_link",
          "prompt_master_rules",
        ])
      ) {
        return NextResponse.json({
          contacts: await loadLegacyContacts(supabase, section),
        });
      }
      console.error("GET /api/contacts failed", error);
      return NextResponse.json(
        { error: getErrorMessage(error, "Impossibile caricare i contatti.") },
        { status: 500 }
      );
    }

    const { data: contactEmails, error: emailsError } = await supabase
      .from("emails")
      .select("id, contact_id, direction, received_at, created_at")
      .or(ownerFilter)
      .not("contact_id", "is", null);

    if (emailsError) {
      if (!isLegacySchemaError(emailsError, ["owner_id", "contact_id"])) {
        console.error("GET /api/contacts emails fetch failed", emailsError);
        return NextResponse.json(
          { error: getErrorMessage(emailsError, "Impossibile caricare i contatti.") },
          { status: 500 }
        );
      }
    }

    const lastInboundAtByContactId = new Map<string, string>();
    const lastOutboundAtByContactId = new Map<string, string>();

    ((contactEmails ?? []) as unknown[]).forEach((row) => {
      const email = row as unknown as ContactEmailRow;
      if (!email.contact_id) return;
      const candidate = email.received_at ?? email.created_at ?? null;
      if (!candidate) return;

      if (email.direction === "inbound") {
        const current = lastInboundAtByContactId.get(email.contact_id);
        if (getTimestamp(candidate) > getTimestamp(current)) {
          lastInboundAtByContactId.set(email.contact_id, candidate);
        }
      } else if (email.direction === "outbound") {
        const current = lastOutboundAtByContactId.get(email.contact_id);
        if (getTimestamp(candidate) > getTimestamp(current)) {
          lastOutboundAtByContactId.set(email.contact_id, candidate);
        }
      }
    });

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

      const cachedLanguage =
        contact.language === "it" || contact.language === "en"
          ? (contact.language as "it" | "en")
          : null;

      return {
        ...withAiDefaults(contact),
        status: effectiveStatus,
        last_inbound_email_at: lastInboundAtByContactId.get(contact.id) ?? null,
        last_outbound_email_at: lastOutboundAtByContactId.get(contact.id) ?? null,
        activity_at: best,
        language: cachedLanguage ?? detectLanguageForContactProfile(contact),
      };
    });

    return NextResponse.json({ contacts });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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
    const importPayload = normalizeOutreachImportPayload(body);
    const supabase = getSupabaseAdmin();
    const user = await requireCurrentUser(supabase);

    if (importPayload) {
      if (user.usesLegacySchema) {
        return NextResponse.json(
          {
            error:
              "Schema legacy non compatibile con AI Director Outreach. Applica le migration Supabase aggiornate.",
          },
          { status: 400 }
        );
      }

      // ARCHITETTURA (Pietro 2026-05-27): i contatti outreach NON entrano nella
      // tabella `contacts`. Vengono parcheggiati in `outreach_drafts` finche'
      // Pietro non li approva manualmente nella pagina batch. L'approvazione
      // promuove la draft in contacts e cancella la draft.
      const batchId = randomUUID();
      const drafts: Record<string, unknown>[] = [];
      const supabaseUrl = process.env.SUPABASE_URL?.trim();
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
      if (!supabaseUrl || !supabaseKey) {
        return NextResponse.json(
          {
            error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env.",
          },
          { status: 500 }
        );
      }

      // ANTI-DOPPIONI (Pietro 2026-06-01): re-importare lo stesso PDF NON deve
      // creare copie. Salto i registi gia' presenti in outreach_drafts (stesso
      // owner, per nome) e i doppioni dentro lo stesso import.
      const existingNames = new Set<string>();
      // name(normalizzato) -> batch in cui quel registo e' GIA' presente. Serve a
      // dare all'utente un link cliccabile quando reimporta solo doppioni.
      const existingByName = new Map<
        string,
        { id: string; name: string | null }
      >();
      try {
        const existingRes = await fetch(
          `${supabaseUrl}/rest/v1/outreach_drafts?owner_id=eq.${user.id}&select=name,batch_id,batch_name&limit=100000`,
          {
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
            },
          }
        );
        if (existingRes.ok) {
          const existing = (await existingRes.json()) as {
            name?: string;
            batch_id?: string;
            batch_name?: string | null;
          }[];
          for (const e of existing) {
            if (typeof e.name === "string" && e.name.trim()) {
              const key = e.name.trim().toLowerCase();
              existingNames.add(key);
              if (!existingByName.has(key) && typeof e.batch_id === "string") {
                existingByName.set(key, {
                  id: e.batch_id,
                  name: typeof e.batch_name === "string" ? e.batch_name : null,
                });
              }
            }
          }
        }
      } catch {
        // se il check fallisce proseguo senza dedup: meglio importare che bloccare
      }
      let skippedDuplicates = 0;
      // Se l'import e' tutto doppioni, il primo batch trovato dove stanno gia' i
      // registi: lo restituiamo cosi' il client puo' linkarlo.
      let existingBatch: { id: string; name: string | null } | null = null;

      // Costruisco TUTTE le payload in memoria e poi le inserisco in UN UNICO
      // batch (una sola richiesta a Supabase). Prima era una fetch per regista
      // (loop sequenziale): con 100+ registi la funzione Vercel sforava il timeout
      // a intermittenza -> "Avvia ricerca email" andava una volta ogni tre.
      const draftPayloads: Record<string, unknown>[] = [];
      for (const row of importPayload.contacts) {
        const dupKey = row.name.trim().toLowerCase();
        if (dupKey && existingNames.has(dupKey)) {
          skippedDuplicates += 1;
          if (!existingBatch) existingBatch = existingByName.get(dupKey) ?? null;
          continue;
        }
        if (dupKey) existingNames.add(dupKey);
        draftPayloads.push({
          owner_id: user.id,
          batch_id: batchId,
          batch_name: importPayload.batchName,
          section: row.section,
          name: row.name,
          email: row.email,
          company: row.company,
          role: row.role || "Regista",
          notes: row.notes,
          language: null,
          source_link: row.source_link,
          verified_facts_json: row.verified_facts_json,
          prompt_master_rules: row.prompt_master_rules,
          ai_status: "imported",
          ai_validation_status: "not_checked",
          ai_email_subject: row.draft_subject,
          ai_email_body: row.draft_body,
          ai_agent_checks_json: {},
          ai_validation_summary: null,
          ai_send_allowed: false,
          email_source_url: row.email_source_url,
          email_source_type: row.email_source_type,
          email_confidence: row.email_confidence,
          email_enrichment_status:
            row.email_enrichment_status ?? (row.email ? "present" : null),
          email_found_at: row.email ? new Date().toISOString() : null,
        });
      }

      const insertDraftsUrl = `${supabaseUrl}/rest/v1/outreach_drafts`;
      const insertHeaders = {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      };

      if (draftPayloads.length > 0) {
        // 1) VELOCE: un solo insert in blocco con tutti i registi (una richiesta).
        const batchRes = await fetch(insertDraftsUrl, {
          method: "POST",
          headers: insertHeaders,
          body: JSON.stringify(draftPayloads),
        }).catch(() => null);

        if (batchRes && batchRes.ok) {
          const batchData = (await batchRes
            .json()
            .catch(() => [])) as Record<string, unknown>[];
          drafts.push(...batchData);
        } else {
          // 2) FALLBACK ROBUSTO (raro): se il batch fallisce - es. un doppione
          // sfuggito per una gara con un import concorrente (409/23505) - inserisco
          // uno alla volta saltando i doppioni, senza interrompere tutto l'import.
          for (const draftPayload of draftPayloads) {
            const response = await fetch(insertDraftsUrl, {
              method: "POST",
              headers: insertHeaders,
              body: JSON.stringify(draftPayload),
            });
            if (!response.ok) {
              const errPayload = await response
                .json()
                .catch(() => ({ message: response.statusText }));
              // BLINDATURA ANTI-DOPPIONI: la regola UNIQUE del DB (owner_id + nome
              // normalizzato) rifiuta i doppioni con 409 / codice 23505. NON e' un
              // errore: e' la rete di sicurezza. Salto la riga e proseguo.
              const errCode = (errPayload as { code?: string })?.code;
              if (response.status === 409 || errCode === "23505") {
                skippedDuplicates += 1;
                continue;
              }
              console.error(
                "POST /api/contacts outreach draft insert failed",
                errPayload
              );
              return NextResponse.json(
                {
                  error: getErrorMessage(
                    errPayload,
                    "Impossibile creare le draft outreach."
                  ),
                },
                { status: 500 }
              );
            }
            const data = (await response.json()) as Record<string, unknown>[];
            if (data[0]) drafts.push(data[0]);
          }
        }
      }

      return NextResponse.json(
        {
          batch: {
            id: batchId,
            name: importPayload.batchName,
            total_contacts: drafts.length,
            skipped_duplicates: skippedDuplicates,
            existing_batch: existingBatch,
          },
          drafts,
        },
        { status: 201 }
      );
    }

    const payload = normalizeCreatePayload(body);

    if (!payload) {
      return NextResponse.json(
        { error: "Inserisci nome oppure produzione." },
        { status: 400 }
      );
    }
    const modernInsertPayload = user.usesLegacySchema
      ? payload
      : { ...payload, owner_id: user.id };

    const insertedContact = await supabase
      .from("contacts")
      .insert(modernInsertPayload)
      .select(CONTACT_SELECT_FIELDS)
      .single();
    let data = (insertedContact.data as ContactRow | null) ?? null;
    let error: unknown = insertedContact.error;

    if (error && isLegacySchemaError(error, ["owner_id", "section"])) {
      const legacyInsert = await supabase
        .from("contacts")
        .insert({
          name: payload.name,
          email: payload.email,
          company: payload.company,
          role: payload.role,
          status: payload.status,
          last_action_at: payload.last_action_at,
        })
        .select(LEGACY_CONTACT_SELECT_FIELDS)
        .single();
      data = (legacyInsert.data as ContactRow | null) ?? null;
      error = legacyInsert.error;
    }

    if (error) {
      console.error("POST /api/contacts failed", error);
      return NextResponse.json(
        { error: getErrorMessage(error, "Impossibile salvare il contatto.") },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Impossibile salvare il contatto." },
        { status: 500 }
      );
    }

    const savedEmail = typeof data.email === "string" ? data.email : null;

    try {
      await linkExistingEmailsToContact(
        supabase,
        data.id,
        savedEmail,
        user.id,
        user.canAccessLegacyData
      );
    } catch (linkError) {
      console.error("POST /api/contacts email link failed", linkError);
    }

    const language =
      (await detectLanguageForContactEmail(
        supabase,
        savedEmail,
        user.id,
        user.canAccessLegacyData
      )) ??
      detectLanguageForContactProfile(data);

    return NextResponse.json(
      {
        contact: {
          ...withAiDefaults(data as ContactRow),
          section:
            typeof (data as Record<string, unknown>)?.section === "string"
              ? (data as Record<string, unknown>).section
              : "cinema",
          language,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/contacts unexpected error", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Impossibile salvare il contatto.") },
      { status: 500 }
    );
  }
}
