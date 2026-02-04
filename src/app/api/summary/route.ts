import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUMMARY_THREAD_KEY = "__contact__";
const DEFAULT_LIMIT = 40;

type SummaryPayload = {
  one_liner: string;
  highlights: string[];
  open_questions: string[];
  next_actions: string[];
  last_inbound: string;
  last_outbound: string;
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
    "Scrivi in italiano, breve e concreto.",
    "Restituisci SOLO JSON valido con queste chiavi:",
    `one_liner, highlights (array), open_questions (array), next_actions (array), last_inbound, last_outbound.`,
    "Linee guida:",
    "- one_liner: 1 frase che spiega di cosa parla la conversazione.",
    "- highlights: 3-5 punti chiave (decisioni, stati, contesto).",
    "- open_questions: domande rimaste aperte (massimo 3).",
    "- next_actions: prossimi passi (massimo 3).",
    "- last_inbound: riassunto in 1 frase dell'ultima email ricevuta.",
    "- last_outbound: riassunto in 1 frase dell'ultima email inviata.",
    "Usa il nome del contatto se presente.",
    "",
    `Contatto: ${contactName ?? "Sconosciuto"} (${contactEmail ?? "—"})`,
    "",
    "Email (piu recenti in alto):",
    messages,
  ].join("\n");
};

const parseSummary = (value: string) => {
  try {
    return JSON.parse(value) as SummaryPayload;
  } catch {
    return null;
  }
};

const callOllama = async (prompt: string) => {
  const baseUrl =
    getOptionalEnv("OLLAMA_BASE_URL") ?? "http://127.0.0.1:11434";
  const model = getOptionalEnv("OLLAMA_MODEL") ?? "llama3.1:8b";

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: "json",
      options: {
        temperature: 0.2,
        num_ctx: 4096,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Ollama error");
  }

  const payload = (await response.json()) as { response?: string };
  return {
    raw: payload.response ?? "",
    model,
  };
};

export async function POST(request: Request) {
  let payload: { contactId?: string; force?: boolean };
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

  const { data: emails, error: emailsError } = await supabase
    .from("emails")
    .select(
      "id, direction, from_email, to_email, subject, text_body, html_body, received_at"
    )
    .or(
      `contact_id.eq.${contact.id},from_email.ilike.%${contact.email}%,to_email.ilike.%${contact.email}%`
    )
    .order("received_at", { ascending: false })
    .limit(Number(process.env.SUMMARY_EMAIL_LIMIT ?? DEFAULT_LIMIT));

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

  const lastEmailAt = emails[0]?.received_at ?? null;

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

  const messages = emails
    .map((email, index) => {
      const direction = email.direction === "inbound" ? "Ricevuta" : "Inviata";
      const body = sanitizeBody(email.text_body || email.html_body || "");
      const clippedBody = body.length > 800 ? `${body.slice(0, 800)}…` : body;
      const subject = email.subject?.trim() || "Senza oggetto";
      const from = email.from_email ?? "—";
      const to = email.to_email ?? "—";
      const receivedAt = email.received_at ?? "—";
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
    generated = await callOllama(prompt);
  } catch (error) {
    console.error("Summary generation error", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          "AI locale non configurata. Avvia Ollama e imposta OLLAMA_BASE_URL/OLLAMA_MODEL.",
      },
      { status: 503 }
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
    if (errorCode === "42P01") {
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
      { ok: false, error: "Summary store failed" },
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
