import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CATEGORY_THREAD_KEY = "__ai_category__";
const DEFAULT_LIMIT = 40;
const DEFAULT_RECENT_COUNT = 8;
const DEFAULT_GROQ_TIMEOUT_MS = 30000;
const DEFAULT_BATCH_SIZE = 15;
const MAX_BATCH_SIZE = 50;

const CLASSIFY_STATE_TABLE = "ai_classify_state";

type AiCategory = "chiuso" | "interessato" | "non_interessato";

type CategoryPayload = {
  category?: string;
  confidence?: number;
  reason?: string;
};

const getTimestamp = (value?: string | null) => {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

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

const parseBatchSize = () => {
  const raw = Number(process.env.AI_CLASSIFY_BATCH ?? DEFAULT_BATCH_SIZE);
  if (!Number.isFinite(raw)) return DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(raw)));
};

const sanitizeBody = (value?: string | null) => {
  if (!value) return "";
  const stripped = value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return stripped;
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

const normalizeCategory = (value?: string | null): AiCategory | null => {
  if (!value) return null;
  const cleaned = value
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z_]/g, "");
  if (cleaned === "chiuso" || cleaned === "chiusi") return "chiuso";
  if (cleaned === "interessato" || cleaned === "interessati")
    return "interessato";
  if (
    cleaned === "non_interessato" ||
    cleaned === "noninteressato" ||
    cleaned === "non_interessati"
  ) {
    return "non_interessato";
  }
  return null;
};

const normalizeConfidence = (value?: number | null) => {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const mapCategoryToStatus = (category: AiCategory) => {
  switch (category) {
    case "chiuso":
      return "Chiuso";
    case "interessato":
      return "Interessato";
    case "non_interessato":
      return "Non interessato";
    default:
      return "Interessato";
  }
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
    "Sei un assistente che classifica i contatti in base alle email piu recenti.",
    "Restituisci SOLO JSON valido con queste chiavi:",
    "category, confidence, reason.",
    "category deve essere solo una di: chiuso, interessato, non_interessato.",
    "Se non sei sicuro, usa interessato.",
    "confidence e un numero tra 0 e 1.",
    "reason e una frase breve (max 120 caratteri).",
    "Non basarti su parole chiave: valuta il contesto e il significato.",
    "Esempi:",
    "- interessato: chiede info, conferma disponibilita, prosegue il dialogo.",
    "- non_interessato: rifiuta, declina, dice che non serve/ non e il momento.",
    "- chiuso: collaborazione conclusa o progetto terminato.",
    "",
    `Contatto: ${contactName ?? "Sconosciuto"} (${contactEmail ?? "—"})`,
    "",
    "Email (piu recenti in alto):",
    messages,
  ].join("\n");
};

const parseCategory = (value: string) => {
  try {
    const parsed = JSON.parse(stripJsonWrapper(value)) as CategoryPayload;
    const category = normalizeCategory(parsed.category);
    if (!category) return null;
    return {
      category,
      confidence: normalizeConfidence(parsed.confidence ?? 0.5),
      reason:
        typeof parsed.reason === "string"
          ? parsed.reason.trim().slice(0, 160)
          : "",
    };
  } catch {
    return null;
  }
};

const callGroq = async (prompt: string) => {
  const apiKey = getEnv("GROQ_API_KEY");
  const baseUrl =
    getOptionalEnv("GROQ_BASE_URL") ?? "https://api.groq.com/openai/v1";
  const model = getOptionalEnv("GROQ_MODEL") ?? "llama-3.3-70b-versatile";
  const timeoutMs = Number(
    getOptionalEnv("GROQ_TIMEOUT_MS") ?? DEFAULT_GROQ_TIMEOUT_MS
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;

  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
    });
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") {
      throw new Error("Groq timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorText = await response.text();
    const snippet = errorText?.slice(0, 400) || "Groq error";
    throw new Error(`Groq ${response.status}: ${snippet}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    model?: string;
  };
  const content = payload.choices?.[0]?.message?.content ?? "";
  return {
    raw: content,
    model: payload.model ?? model,
  };
};

const buildEmailFilters = (contactId: string, emailText?: string | null) => {
  const filters = [`contact_id.eq.${contactId}`];
  if (!emailText) return filters;
  const matches = emailText.match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
  );
  if (matches) {
    matches.forEach((address: string) => {
      const safeEmail = address.replace(/[\\%_]/g, "\\$&");
      filters.push(`from_email.ilike.%${safeEmail}%`);
      filters.push(`to_email.ilike.%${safeEmail}%`);
    });
  }
  return filters;
};

const classifyContact = async (contact: {
  id: string;
  name: string | null;
  email: string | null;
  status: string | null;
}) => {
  const supabase = getSupabase();
  const emailFilters = buildEmailFilters(contact.id, contact.email);
  const emailLimit = Number(process.env.SUMMARY_EMAIL_LIMIT ?? DEFAULT_LIMIT);
  const recentCountRaw = Number(
    process.env.SUMMARY_RECENT_COUNT ?? DEFAULT_RECENT_COUNT
  );
  const recentCount = Math.max(
    1,
    Math.min(
      Number.isFinite(recentCountRaw) ? recentCountRaw : DEFAULT_RECENT_COUNT,
      emailLimit
    )
  );

  const { data: emails, error: emailsError } = await supabase
    .from("emails")
    .select(
      "direction, from_email, to_email, subject, text_body, html_body, received_at, created_at"
    )
    .or(emailFilters.join(","))
    .order("received_at", { ascending: false })
    .limit(Math.max(emailLimit, recentCount));

  if (emailsError) {
    return { ok: false, error: "Email fetch failed" };
  }
  if (!emails || emails.length === 0) {
    return { ok: true, skipped: "no_emails" };
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
    .eq("thread_key", CATEGORY_THREAD_KEY)
    .maybeSingle();

  if (
    existing?.summary &&
    existing.last_email_at &&
    lastEmailAt &&
    new Date(existing.last_email_at).getTime() >=
      new Date(lastEmailAt).getTime()
  ) {
    const parsedExisting = parseCategory(existing.summary);
    if (parsedExisting) {
      const mappedStatus = mapCategoryToStatus(parsedExisting.category);
      if (contact.status !== mappedStatus) {
        const updatePayload: Record<string, string | null> = {
          status: mappedStatus,
        };
        if (mappedStatus === "Chiuso" || mappedStatus === "Non interessato") {
          updatePayload.next_action_at = null;
          updatePayload.next_action_note = null;
        }
        await supabase
          .from("contacts")
          .update(updatePayload)
          .eq("id", contact.id);
      }
      return { ok: true, cached: true };
    }
  }

  const recentEmails = sortedEmails.slice(0, recentCount);
  const messages = recentEmails
    .map((email, index) => {
      const direction = email.direction === "inbound" ? "Ricevuta" : "Inviata";
      const body = sanitizeBody(email.text_body || email.html_body || "");
      const clippedBody = body.length > 600 ? `${body.slice(0, 600)}…` : body;
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
  try {
    generated = await callGroq(prompt);
  } catch (error) {
    console.error("Category generation error", error);
    const message = (error as Error)?.message || "Unknown error";
    const safeMessage = message.slice(0, 200);
    return { ok: false, error: `AI non configurata. ${safeMessage}` };
  }

  const parsed = parseCategory(generated.raw);
  if (!parsed) {
    return { ok: false, error: "AI response invalid" };
  }

  const summaryText = JSON.stringify(parsed);
  const mappedStatus = mapCategoryToStatus(parsed.category);

  if (contact.status !== mappedStatus) {
    const updatePayload: Record<string, string | null> = {
      status: mappedStatus,
    };
    if (mappedStatus === "Chiuso" || mappedStatus === "Non interessato") {
      updatePayload.next_action_at = null;
      updatePayload.next_action_note = null;
    }
    await supabase.from("contacts").update(updatePayload).eq("id", contact.id);
  }

  const { error: storeError } = await supabase
    .from("conversation_summaries")
    .upsert(
      {
        contact_id: contact.id,
        thread_key: CATEGORY_THREAD_KEY,
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
      return { ok: true, stored: false };
    }
    return { ok: false, error: "Category store failed" };
  }

  return { ok: true, stored: true };
};

const getCursor = async (supabase: ReturnType<typeof getSupabase>) => {
  const { data, error } = await supabase
    .from(CLASSIFY_STATE_TABLE)
    .select("cursor_offset")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "PGRST205") {
      return { offset: 0, missingTable: true };
    }
    throw error;
  }

  if (!data) {
    await supabase
      .from(CLASSIFY_STATE_TABLE)
      .insert({ id: 1, cursor_offset: 0 })
      .throwOnError();
    return { offset: 0, missingTable: false };
  }

  const offset = Number(data.cursor_offset ?? 0);
  return {
    offset: Number.isFinite(offset) && offset >= 0 ? offset : 0,
    missingTable: false,
  };
};

const setCursor = async (
  supabase: ReturnType<typeof getSupabase>,
  offset: number
) => {
  await supabase
    .from(CLASSIFY_STATE_TABLE)
    .upsert(
      { id: 1, cursor_offset: offset, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
};

export async function POST(request: Request) {
  const cronSecret = request.headers.get("x-cron-secret");
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const supabase = getSupabase();
  const batchSize = parseBatchSize();
  let offset = 0;
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let cached = 0;
  let errors = 0;
  let missingTable = false;

  try {
    const cursor = await getCursor(supabase);
    offset = cursor.offset;
    missingTable = cursor.missingTable;
  } catch (error) {
    console.error("Cursor read error", error);
  }

  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("id, name, email, status, created_at")
    .order("created_at", { ascending: true })
    .range(offset, offset + batchSize - 1);

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Contact fetch failed" },
      { status: 500 }
    );
  }

  if (!contacts || contacts.length === 0) {
    if (!missingTable) {
      await setCursor(supabase, 0);
    }
    return NextResponse.json({
      ok: true,
      processed: 0,
      updated: 0,
      cached: 0,
      skipped: 0,
      errors: 0,
    });
  }

  for (const contact of contacts) {
    processed += 1;
    const result = await classifyContact(contact);
    if (!result.ok) {
      errors += 1;
      continue;
    }
    if (result.cached) cached += 1;
    if (result.skipped === "no_emails") skipped += 1;
    if (result.stored) updated += 1;
  }

  const nextOffset =
    contacts.length < batchSize ? 0 : offset + contacts.length;
  if (!missingTable) {
    await setCursor(supabase, nextOffset);
  }

  return NextResponse.json({
    ok: true,
    processed,
    updated,
    cached,
    skipped,
    errors,
    batch_size: batchSize,
    next_offset: missingTable ? null : nextOffset,
  });
}
