import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { getAutomaticFollowUpStage } from "@/lib/followUp";

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
  contact_id: string | null;
  direction: "inbound" | "outbound" | null;
  received_at: string | null;
  created_at: string | null;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
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

const stripHtml = (value?: string | null) =>
  (value ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const countMatches = (text: string, regexes: RegExp[]) =>
  regexes.reduce((sum, regex) => sum + (text.match(regex)?.length ?? 0), 0);

const ITALIAN_WORDS = new Set([
  "ciao",
  "buongiorno",
  "buonasera",
  "grazie",
  "gentile",
  "cordiali",
  "saluti",
  "per",
  "favore",
  "sono",
  "non",
  "con",
  "come",
  "anche",
  "quando",
  "dove",
  "quindi",
  "se",
  "abbiamo",
  "avete",
  "puoi",
  "potrei",
  "sarebbe",
  "scrivo",
  "contatto",
  "collaborazione",
  "proposta",
  "preventivo",
  "disponibile",
]);

const ENGLISH_WORDS = new Set([
  "hello",
  "hi",
  "thanks",
  "thank",
  "please",
  "best",
  "regards",
  "kind",
  "with",
  "not",
  "i",
  "you",
  "we",
  "they",
  "your",
  "our",
  "can",
  "could",
  "would",
  "should",
  "about",
  "project",
  "collaboration",
  "proposal",
  "available",
  "contact",
  "meeting",
  "schedule",
]);

const ITALIAN_PHRASES = [
  /\bcordiali saluti\b/g,
  /\bgrazie mille\b/g,
  /\bbuona giornata\b/g,
  /\ba presto\b/g,
  /\ble scrivo\b/g,
  /\bti ringrazio\b/g,
];

const ENGLISH_PHRASES = [
  /\bbest regards\b/g,
  /\bkind regards\b/g,
  /\bthank you\b/g,
  /\bthanks a lot\b/g,
  /\bhave a great day\b/g,
  /\blooking forward\b/g,
  /\bplease let me know\b/g,
];

const REPLY_BREAK_PATTERNS = [
  /^on .+wrote:$/i,
  /^il .+ha scritto:$/i,
  /^from:\s/i,
  /^da:\s/i,
  /^sent:\s/i,
  /^inviato:\s/i,
  /^subject:\s/i,
  /^oggetto:\s/i,
  /^-{2,}\s*original message\s*-{2,}$/i,
  /^-{2,}\s*messaggio originale\s*-{2,}$/i,
];

const extractLatestReplyChunk = (value: string) => {
  const lines = value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const kept: string[] = [];
  for (const line of lines) {
    if (line.startsWith(">")) continue;
    if (REPLY_BREAK_PATTERNS.some((pattern) => pattern.test(line))) break;
    kept.push(line);
    if (kept.length >= 24) break;
  }

  return kept.join(" ");
};

const tokenizeLanguageText = (text: string) =>
  text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\S+@\S+/g, " ")
    .replace(/[^a-zàèéìòù'\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);

const countWordHits = (tokens: string[], lexicon: Set<string>) =>
  tokens.reduce((sum, token) => sum + (lexicon.has(token) ? 1 : 0), 0);

const detectLanguageFromEmail = (value?: string | null): "it" | "en" | null => {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  const cleanText = extractLatestReplyChunk(normalized);
  if (!cleanText) return null;

  const lowerText = cleanText.toLowerCase();
  const tokens = tokenizeLanguageText(lowerText);
  if (tokens.length < 4) {
    return null;
  }

  let italianScore = countWordHits(tokens, ITALIAN_WORDS);
  let englishScore = countWordHits(tokens, ENGLISH_WORDS);

  italianScore += countMatches(lowerText, ITALIAN_PHRASES) * 2;
  englishScore += countMatches(lowerText, ENGLISH_PHRASES) * 2;

  if (/[àèéìòù]/.test(lowerText)) {
    italianScore += 2;
  }

  const totalScore = italianScore + englishScore;
  if (totalScore < 3) {
    return null;
  }

  const diff = Math.abs(italianScore - englishScore);
  if (diff < 2) {
    return null;
  }

  const lowerScore = Math.min(italianScore, englishScore);
  const higherScore = Math.max(italianScore, englishScore);
  if (lowerScore > 0 && higherScore / lowerScore < 1.4) {
    return null;
  }

  return italianScore > englishScore ? "it" : "en";
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

    const { data: contactEmails, error: emailsError } = await supabase
      .from("emails")
      .select(
        "contact_id, direction, received_at, created_at, subject, text_body, html_body"
      )
      .not("contact_id", "is", null);

    if (emailsError) {
      console.error("GET /api/contacts emails fetch failed", emailsError);
      return NextResponse.json(
        { error: getErrorMessage(emailsError, "Impossibile caricare i contatti.") },
        { status: 500 }
      );
    }

    const lastInboundAtByContactId = new Map<string, string>();
    const lastOutboundAtByContactId = new Map<string, string>();
    const latestInboundTextByContactId = new Map<string, string>();

    (contactEmails ?? []).forEach((row) => {
      const email = row as unknown as ContactEmailRow;
      if (!email.contact_id) return;
      const candidate = email.received_at ?? email.created_at ?? null;
      if (!candidate) return;
      
      if (email.direction === "inbound") {
        const current = lastInboundAtByContactId.get(email.contact_id);
        if (getTimestamp(candidate) > getTimestamp(current)) {
          lastInboundAtByContactId.set(email.contact_id, candidate);
          latestInboundTextByContactId.set(
            email.contact_id,
            [email.text_body, stripHtml(email.html_body), email.subject]
              .filter(Boolean)
              .join(" ")
          );
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

      return {
        ...contact,
        status: effectiveStatus,
        last_inbound_email_at: lastInboundAtByContactId.get(contact.id) ?? null,
        last_outbound_email_at: lastOutboundAtByContactId.get(contact.id) ?? null,
        activity_at: best,
        language: detectLanguageFromEmail(
          latestInboundTextByContactId.get(contact.id) ?? null
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
