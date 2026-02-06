import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUMMARY_THREAD_KEY = "__contact__";
const DEFAULT_LIMIT = 40;
const DEFAULT_RECENT_COUNT = 8;
const DEFAULT_GROQ_TIMEOUT_MS = 30000;

type SummaryPayload = {
  one_liner: string;
  highlights: string[];
  open_questions: string[];
  next_actions: string[];
  last_inbound: string;
  last_outbound: string;
};

const normalizeString = (value: unknown, maxLen = 0) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!maxLen || trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen).trimEnd()}…`;
};

const normalizeSummary = (value: unknown): SummaryPayload | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<SummaryPayload>;
  const normalized = {
    one_liner: normalizeString(source.one_liner, 380),
    highlights: [],
    open_questions: [],
    next_actions: [],
    last_inbound: normalizeString(source.last_inbound, 160),
    last_outbound: normalizeString(source.last_outbound, 160),
  };
  const hasContent = Boolean(
    normalized.one_liner ||
      normalized.last_inbound ||
      normalized.last_outbound
  );
  return hasContent ? normalized : null;
};

const getTimestamp = (value?: string | null) => {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const extractEmails = (value?: string | null) => {
  if (!value) return [];
  const matches = value.match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
  );
  if (!matches) return [];
  const unique = new Set(matches.map((item) => item.toLowerCase()));
  return Array.from(unique);
};

const escapeIlike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const getEnv = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var ${key}`);
  return value;
};

const getOptionalEnv = (key: string) => {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value : null;
};

const getSupabase = () =>
  createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

const sanitizeBody = (value?: string | null) => {
  if (!value) return "";
  const stripped = value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return stripped;
};

const buildPrompt = ({
  contactName,
  contactEmail,
  messages,
}: {
  contactName: string | null;
  contactEmail: string | null;
  messages: string;
}) => {
  return [
    "Sei un assistente che riassume conversazioni email.",
    "Scrivi in italiano, molto conciso e discorsivo (tono naturale).",
    "Restituisci SOLO JSON valido con queste chiavi:",
    `one_liner, highlights (array), open_questions (array), next_actions (array), last_inbound, last_outbound.`,
    "Linee guida:",
    "- one_liner: breve riassunto discorsivo in 2-3 frasi (max 380 caratteri).",
    "- highlights: lascia sempre un array vuoto [].",
    "- open_questions: lascia sempre un array vuoto [].",
    "- next_actions: lascia sempre un array vuoto [].",
    "- last_inbound: 1 frase breve sull'ultima email ricevuta.",
    "- last_outbound: 1 frase breve sull'ultima email inviata.",
    "Usa il nome del contatto se presente.",
    "Usa SOLO le email fornite (ultimi messaggi).",
    "Evita ripetizioni e dettagli non essenziali. Non dare consigli o suggerimenti.",
    "",
    `Contatto: ${contactName ?? "Sconosciuto"} (${contactEmail ?? "—"})`,
    "",
    "Email (piu recenti in alto):",
    messages,
  ].join("\n");
};

const stripJsonWrapper = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith("```")) {
    const firstBreak = trimmed.indexOf("\n");
    const lastFence = trimmed.lastIndexOf("```");
    if (firstBreak !== -1 && lastFence > firstBreak) {
      return trimmed.slice(firstBreak + 1, lastFence).trim();
    }
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }
  return trimmed;
};

const parseSummary = (value: string) => {
  try {
    return normalizeSummary(JSON.parse(stripJsonWrapper(value)));
  } catch {
    return null;
  }
};

const callGroq = async (prompt: string) => {
  const apiKey = getEnv("GROQ_API_KEY");
  const baseUrl = getOptionalEnv("GROQ_BASE_URL") ?? "https://api.groq.com/openai/v1";
  const model = getOptionalEnv("GROQ_MODEL") ?? "llama-3.3-70b-versatile";
  const timeoutMs = Number(
    getOptionalEnv("GROQ_TIMEOUT_MS") ?? DEFAULT_GROQ_TIMEOUT_MS
  );

  const isGoogle = baseUrl.includes("generativelanguage.googleapis.com");

  const requestOnce = async (
    modelName: string,
    headerMode: "bearer" | "google"
  ) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (headerMode === "google") {
        headers["x-goog-api-key"] = apiKey;
      } else {
        headers.Authorization = `Bearer ${apiKey}`;
      }
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
        }),
      });
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        throw new Error("AI timeout");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
    const text = await response.text();
    return { response, text };
  };

  let activeModel = model;
  let attempt = await requestOnce(activeModel, "bearer");

  if (!attempt.response.ok && isGoogle) {
    const message = attempt.text.toLowerCase();
    const canTryPrefix =
      !activeModel.startsWith("models/") &&
      (attempt.response.status === 404 ||
        (message.includes("model") &&
          (message.includes("not found") ||
            message.includes("does not exist") ||
            message.includes("unknown"))));
    if (canTryPrefix) {
      activeModel = `models/${activeModel}`;
      attempt = await requestOnce(activeModel, "bearer");
    }
    if (
      !attempt.response.ok &&
      (attempt.response.status === 401 || attempt.response.status === 403)
    ) {
      attempt = await requestOnce(activeModel, "google");
    }
  }

  if (!attempt.response.ok) {
    let message = attempt.text?.slice(0, 400) || "AI error";
    try {
      const parsed = JSON.parse(attempt.text) as { error?: { message?: string } };
      if (parsed?.error?.message) {
        message = parsed.error.message.slice(0, 400);
      }
    } catch {
      // ignore JSON parse
    }
    const err = new Error(`AI ${attempt.response.status}: ${message}`);
    (err as { status?: number }).status = attempt.response.status;
    throw err;
  }

  const payload = JSON.parse(attempt.text) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    model?: string;
  };
  const content = payload.choices?.[0]?.message?.content ?? "";
  return { raw: content, model: payload.model ?? activeModel };
};

export async function POST(request: Request) {
  let payload: { contactId?: string; force?: boolean; debug?: boolean };
  try {
    payload = (await request.json()) as { contactId?: string; force?: boolean };
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!payload?.contactId) {
    return NextResponse.json(
      { ok: false, error: "Missing contactId" },
      { status: 400 }
    );
  }

  const supabase = getSupabase();
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, name, email")
    .eq("id", payload.contactId)
    .maybeSingle();

  if (!contact) {
    return NextResponse.json(
      { ok: false, error: "Contact not found" },
      { status: 404 }
    );
  }

  const emailFilters = [`contact_id.eq.${contact.id}`];
  const emailList = extractEmails(contact.email?.trim() || null);
  emailList.forEach((address) => {
    const safeEmail = escapeIlike(address);
    emailFilters.push(`from_email.ilike.%${safeEmail}%`);
    emailFilters.push(`to_email.ilike.%${safeEmail}%`);
  });

  const emailLimit = Number(process.env.SUMMARY_EMAIL_LIMIT ?? DEFAULT_LIMIT);
  const recentCountRaw = Number(
    process.env.SUMMARY_RECENT_COUNT ?? DEFAULT_RECENT_COUNT
  );
  const recentCount = Math.max(
    1,
    Math.min(Number.isFinite(recentCountRaw) ? recentCountRaw : DEFAULT_RECENT_COUNT, emailLimit)
  );

  const { data: emails, error: emailsError } = await supabase
    .from("emails")
    .select(
      "id, direction, from_email, to_email, subject, text_body, html_body, received_at, created_at"
    )
    .or(emailFilters.join(","))
    .order("received_at", { ascending: false })
    .limit(Math.max(emailLimit, recentCount));

  if (emailsError) {
    return NextResponse.json(
      { ok: false, error: "Email fetch failed" },
      { status: 500 }
    );
  }

  if (!emails || emails.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No emails to summarize" },
      { status: 404 }
    );
  }

  const sortedEmails = [...emails].sort((a, b) => {
    const aTime = getTimestamp(a.received_at ?? a.created_at ?? null);
    const bTime = getTimestamp(b.received_at ?? b.created_at ?? null);
    return bTime - aTime;
  });
  const lastEmailAt =
    sortedEmails[0]?.received_at ?? sortedEmails[0]?.created_at ?? null;

  const { data: existing } = await supabase
    .from("conversation_summaries")
    .select("summary, updated_at, last_email_at, model")
    .eq("contact_id", contact.id)
    .eq("thread_key", SUMMARY_THREAD_KEY)
    .maybeSingle();

  if (
    existing?.summary &&
    !payload.force &&
    existing.last_email_at &&
    lastEmailAt &&
    new Date(existing.last_email_at).getTime() >=
      new Date(lastEmailAt).getTime()
  ) {
    return NextResponse.json({
      ok: true,
      summary: existing.summary,
      updated_at: existing.updated_at,
      last_email_at: existing.last_email_at,
      model: existing.model,
      cached: true,
    });
  }

  const recentEmails = sortedEmails.slice(0, recentCount);

  const messages = recentEmails
    .map((email, index) => {
      const direction = email.direction === "inbound" ? "Ricevuta" : "Inviata";
      const body = sanitizeBody(email.text_body || email.html_body || "");
      const clippedBody = body.length > 800 ? `${body.slice(0, 800)}…` : body;
      const subject = email.subject?.trim() || "Senza oggetto";
      const from = email.from_email ?? "—";
      const to = email.to_email ?? "—";
      const receivedAt = email.received_at ?? email.created_at ?? "—";
      return [
        `#${index + 1} ${direction} | ${receivedAt}`,
        `Da: ${from}`,
        `A: ${to}`,
        `Oggetto: ${subject}`,
        clippedBody ? `Testo: ${clippedBody}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const prompt = buildPrompt({
    contactName: contact.name,
    contactEmail: contact.email,
    messages,
  });

  let generated;
  const debug =
    payload?.debug === true || process.env.SUMMARY_DEBUG === "1";
  try {
    generated = await callGroq(prompt);
  } catch (error) {
    console.error("Summary generation error", error);
    const status = (error as { status?: number }).status;
    const message = (error as Error)?.message || "Unknown error";
    const safeMessage = message.slice(0, 200);

    if (status === 429 && existing?.summary) {
      return NextResponse.json({
        ok: true,
        summary: existing.summary,
        updated_at: existing.updated_at,
        last_email_at: existing.last_email_at,
        model: existing.model,
        cached: true,
        rate_limited: true,
      });
    }

    const human =
      status === 429
        ? "Quota AI esaurita. Riprova piu tardi."
        : status === 401 || status === 403
          ? "Chiave API non valida o non autorizzata."
          : status === 400 || status === 404
            ? "Configurazione AI errata (modello/base URL)."
            : "AI non disponibile.";

    return NextResponse.json(
      {
        ok: false,
        error: debug ? `${human} ${safeMessage}` : human,
      },
      { status: status === 429 ? 429 : 503 }
    );
  }

  const parsed = parseSummary(generated.raw);
  const summaryText = parsed ? JSON.stringify(parsed) : generated.raw;

  const { data: stored, error: storeError } = await supabase
    .from("conversation_summaries")
    .upsert(
      {
        contact_id: contact.id,
        thread_key: SUMMARY_THREAD_KEY,
        summary: summaryText,
        last_email_at: lastEmailAt,
        model: generated.model,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "contact_id,thread_key" }
    )
    .select("summary, updated_at, last_email_at, model")
    .single();

  if (storeError) {
    const errorCode = (storeError as { code?: string }).code;
    if (errorCode === "42P01" || errorCode === "PGRST205") {
      return NextResponse.json({
        ok: true,
        summary: summaryText,
        updated_at: new Date().toISOString(),
        last_email_at: lastEmailAt,
        model: generated.model,
        cached: false,
        stored: false,
      });
    }
    return NextResponse.json(
      {
        ok: false,
        error: debug
          ? `Summary store failed: ${storeError.message} (${errorCode ?? "n/a"})`
          : "Summary store failed",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    summary: stored.summary,
    updated_at: stored.updated_at,
    last_email_at: stored.last_email_at,
    model: stored.model,
    cached: false,
    stored: true,
  });
}
