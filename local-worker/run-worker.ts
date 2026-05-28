import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { AiAgentName } from "../src/lib/aiOutreach";
import { aggregateResults } from "./aggregateResults";
import { runClaudeCheck } from "./agents/claudeCheck";
import { runCodexCheck } from "./agents/codexCheck";
import { runGeminiCheck } from "./agents/geminiCheck";
import type { AgentRunResult, ValidationPacket } from "./agents/shared";
import { runWriterDraft, type WriterDraftResult } from "./agents/writerDraft";
import {
  findPublicEmail,
  type EnrichmentResult,
} from "./enrichment/findPublicEmail";

const WORKER_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(WORKER_DIR, "..");

loadEnv({ path: path.join(PROJECT_ROOT, ".env.local"), override: false });
loadEnv({ path: path.join(PROJECT_ROOT, ".env"), override: false });

// Il worker lavora sulla tabella outreach_drafts. I contatti non entrano in
// `contacts` finche' Pietro non approva (POST /api/outreach/drafts/[id]/approve).
type DraftQueueRow = {
  id: string;
  owner_id: string | null;
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  notes: string | null;
  section: string | null;
  language: string | null;
  batch_id: string | null;
  batch_name: string | null;
  ai_status: string;
  ai_email_subject: string | null;
  ai_email_body: string | null;
  verified_facts_json: unknown;
  source_link: string | null;
  prompt_master_rules: string | null;
  email_source_url: string | null;
  email_source_type: string | null;
  email_confidence: number | null;
  email_enrichment_status: string | null;
  email_enrichment_reason: string | null;
};

const getRequiredEnv = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing env var ${key}`);
  }
  return value;
};

const WORKER_LIMIT = Math.max(
  1,
  Number.parseInt(process.env.OUTREACH_WORKER_BATCH_SIZE ?? "30", 10) || 30
);
const WORKER_POLL_MS = Math.max(
  5000,
  Number.parseInt(process.env.OUTREACH_WORKER_POLL_MS ?? "15000", 10) || 15000
);
// Concorrenza piu' aggressiva (10 contatti contemporaneamente). Su Mac
// M-series con 9 CLI calls per contatto (3 enrichment + 1 writer + 3
// validatori, parzialmente seriali) restiamo sotto ai limiti pratici.
const WORKER_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.OUTREACH_WORKER_CONCURRENCY ?? "10", 10) || 10
);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

// Estrae dal pdf_full_text una finestra di ±radius caratteri attorno al nome
// del destinatario. Usata SOLO per l'enrichment (ricerca email): mandare il
// PDF intero a 3 AI per ogni contatto e' rumore e tempo sprecato. Writer e
// validatori continuano a ricevere il pdf_full_text completo perche' devono
// poter verificare i claim contro l'intero documento.
const extractContextChunk = (
  fullText: string | null | undefined,
  name: string,
  radius = 5000
): string | null => {
  if (!fullText || !fullText.trim() || !name?.trim()) return fullText ?? null;
  // Match case-insensitive del nome (o di una sua variante separata da spazi)
  const safe = name
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  const regex = new RegExp(safe, "i");
  const match = regex.exec(fullText);
  if (!match || match.index === undefined) {
    // Nome non trovato: meglio mandare i primi 10k caratteri che niente
    return fullText.slice(0, Math.min(fullText.length, radius * 2));
  }
  const start = Math.max(0, match.index - radius);
  const end = Math.min(fullText.length, match.index + name.length + radius);
  let chunk = fullText.slice(start, end);
  if (start > 0) chunk = "[…contesto precedente troncato…]\n" + chunk;
  if (end < fullText.length) chunk += "\n[…contesto seguente troncato…]";
  return chunk;
};

const getSupabase = () =>
  createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

// NOTA: alcune frasi che potrebbero sembrare "AI-cringe" sono in realta'
// nel BLOCCO FISSO autorizzato di Pietro (es. "match creativo", "raccontare
// la loro storia", "continuero' a seguire"). NON aggiungerle qui o i
// validatori bloccheranno bozze formalmente perfette.
// IMPORTANTE: la stringa "Link visione" e' OBBLIGATORIA nel template, quindi
// NON inserire mai "visione" da sola in blacklist.
const FORBIDDEN_WORDS = [
  // anti-cringe inglese
  "I hope this email finds you well",
  "Spero che questa email ti trovi bene",
  "leverage",
  "sinergia",
  "value proposition",
  "outside the box",
  "win-win",
  "touch base",
  "reaching out",
  "trust this email finds you",
  // anti-bullshit IA italiano
  "Ho avuto modo di visionare",
  "rimasto colpito dalla profondità",
  "cura estetica",
  "risonanza emotiva",
  "amplificare l'emotività",
  "amplificano la risonanza",
  "due chiacchiere",
  "demo gratuita",
  "playlist personalizzata",
  "bellezza visiva",
  "potenza espressiva",
  "intimismo poetico",
  "atmosfera evocativa",
  "sensibilità autentica",
  "voce unica",
  // blacklist esplicita di Pietro (prompt writer 2026-05-28)
  "proposta",
  "collaborazione",
  "valore",
  "allineare",
  "rafforzare",
  "coinvolgente",
  "rigore narrativo",
  "linguaggio visivo",
  "visione artistica",
  "la sua visione",
  "vostra visione",
];

const TEMPLATE_RULES: Record<string, string> = {
  A: "Template A: contatto con materiale verificato. Subject specifico, body con riferimento a un'opera concreta del regista, link visione preso da allowed_links.",
  B: "Template B: contatto con materiale parziale. Body piu' generico ma comunque personalizzato, link visione preso da allowed_links se presente.",
  C: "Template C: contatto senza materiale verificabile. Body senza claim su opere specifiche. Obbligatorio: 'Link visione: non disponibile' oppure omissione esplicita del link visione.",
};

const extractAllowedLinks = (contact: DraftQueueRow): string[] => {
  const links = new Set<string>();
  if (isNonEmptyString(contact.source_link)) {
    links.add(contact.source_link.trim());
  }
  const facts = contact.verified_facts_json;
  if (facts && typeof facts === "object" && !Array.isArray(facts)) {
    const candidate = (facts as Record<string, unknown>).allowed_links;
    if (Array.isArray(candidate)) {
      candidate.forEach((entry) => {
        if (isNonEmptyString(entry)) links.add(entry.trim());
      });
    }
  }
  return [...links];
};

const buildPacket = (contact: DraftQueueRow): ValidationPacket => {
  const contact_data = {
    id: contact.id,
    owner_id: contact.owner_id,
    name: contact.name,
    email: contact.email,
    company: contact.company,
    role: contact.role,
    notes: contact.notes,
    section: contact.section,
    language: contact.language,
    batch_id: contact.batch_id,
    batch_name: contact.batch_name,
  };
  const normalized_contact_data = {
    name: contact.name?.trim() ?? "",
    email: contact.email?.trim().toLowerCase() ?? "",
    company: contact.company?.trim() ?? "",
    role: contact.role?.trim() ?? "",
    section: contact.section?.trim() ?? "",
    language: contact.language?.trim().toLowerCase() ?? "",
  };
  return {
    contact_data,
    normalized_contact_data,
    verified_facts_json: contact.verified_facts_json ?? {},
    draft_subject: contact.ai_email_subject?.trim() ?? "",
    draft_body: contact.ai_email_body?.trim() ?? "",
    draft_link_visione: "",
    draft_template_used: "",
    draft_risk_score: null,
    source_link: contact.source_link,
    notes: contact.notes,
    prompt_master_rules: contact.prompt_master_rules,
    allowed_links: extractAllowedLinks(contact),
    forbidden_words: FORBIDDEN_WORDS,
    template_rules: TEMPLATE_RULES,
    email_source_url: contact.email_source_url,
    email_source_type: contact.email_source_type,
    email_confidence: contact.email_confidence,
    email_enrichment_status: contact.email_enrichment_status,
    email_enrichment_reason: contact.email_enrichment_reason,
  };
};

const fetchQueue = async (supabase: ReturnType<typeof getSupabase>) => {
  const { data, error } = await supabase
    .from("outreach_drafts")
    .select(
      "id, owner_id, name, email, company, role, notes, section, language, batch_id, batch_name, ai_status, ai_email_subject, ai_email_body, verified_facts_json, source_link, prompt_master_rules, email_source_url, email_source_type, email_confidence, email_enrichment_status, email_enrichment_reason"
    )
    .in("ai_status", ["imported", "draft_ready"])
    .order("updated_at", { ascending: true })
    .limit(WORKER_LIMIT);

  if (error) {
    throw error;
  }

  return (data ?? []) as DraftQueueRow[];
};

const logPrefix = (contact: DraftQueueRow) =>
  `[worker][contact:${contact.id.slice(0, 8)}][batch:${contact.batch_id?.slice(0, 8) ?? "none"}]`;

const setContactError = async (
  supabase: ReturnType<typeof getSupabase>,
  contact: DraftQueueRow,
  summary: string
) => {
  await supabase
    .from("outreach_drafts")
    .update({
      ai_status: "error",
      ai_validation_status: "error",
      ai_send_allowed: false,
      ai_validation_summary: summary,
      ai_agent_checks_json: {},
    })
    .eq("id", contact.id);
};

const persistAgentAudit = async (
  supabase: ReturnType<typeof getSupabase>,
  contact: DraftQueueRow,
  results: AgentRunResult[]
) => {
  const rows = results.map((result) => ({
    contact_id: null,
    draft_id: contact.id,
    batch_id: contact.batch_id,
    agent_name: result.agent_name,
    approved: result.approved,
    risk_level: result.risk_level,
    contact_ok: result.contact_ok,
    email_ok: result.email_ok,
    draft_ok: result.draft_ok,
    send_allowed: result.send_allowed,
    failed: result.failed,
    suggested_status: result.suggested_status,
    issues_json: result.issues,
    raw_output: result.raw_output,
  }));

  const { error } = await supabase
    .from("ai_outreach_agent_checks")
    .insert(rows);

  if (error) {
    throw error;
  }
};

// Diagnosi 2026-05-28 (Pietro): in parallelo i 3 CLI competono per CPU e
// vanno tutti in timeout. Misura isolata: Gemini 81s, Claude 114s, Codex 216s.
// In serie: ~411s totali, no contention, ognuno entro il suo timeout.
const runAllAgents = async (
  packet: ValidationPacket
): Promise<AgentRunResult[]> => {
  const gemini = await runGeminiCheck(packet, PROJECT_ROOT);
  const claude = await runClaudeCheck(packet, PROJECT_ROOT);
  const codex = await runCodexCheck(packet, PROJECT_ROOT);
  return [gemini, claude, codex];
};

const describeAgentIssues = (agent: AiAgentName, result: AgentRunResult) => {
  const firstIssue = result.issues[0];
  const issueText =
    firstIssue && typeof firstIssue.message === "string"
      ? ` - ${firstIssue.message}`
      : "";
  return `${agent}: ${result.approved ? "approved" : "rejected"}${issueText}`;
};

const numericToRiskLabel = (value: number) => {
  if (value >= 0.7) return "high";
  if (value >= 0.35) return "medium";
  return "low";
};

const persistDraft = async (
  supabase: ReturnType<typeof getSupabase>,
  contact: DraftQueueRow,
  draft: WriterDraftResult
) => {
  const generatedAt = new Date().toISOString();
  const { error } = await supabase
    .from("outreach_drafts")
    .update({
      ai_email_subject: draft.subject,
      ai_email_body: draft.body,
      ai_template_used: draft.template_used,
      ai_risk_score: numericToRiskLabel(draft.risk_score),
      ai_risk_score_numeric: draft.risk_score,
      ai_link_visione: draft.link_visione,
      ai_writer_reason: draft.reason,
      ai_generated_at: generatedAt,
    })
    .eq("id", contact.id);

  if (error) {
    throw error;
  }

  contact.ai_email_subject = draft.subject;
  contact.ai_email_body = draft.body;
};

const persistEnrichment = async (
  supabase: ReturnType<typeof getSupabase>,
  contact: DraftQueueRow,
  enrichment: EnrichmentResult
) => {
  const updates: Record<string, unknown> = {
    email_source_url: enrichment.source_url,
    email_source_type: enrichment.source_type,
    email_confidence: enrichment.confidence,
    email_found_at: enrichment.found_at,
    email_enrichment_status: enrichment.status,
    email_enrichment_reason: enrichment.reason,
  };
  if (enrichment.email && !contact.email) {
    updates.email = enrichment.email;
  }
  const { error } = await supabase
    .from("outreach_drafts")
    .update(updates)
    .eq("id", contact.id);
  if (error) throw error;
  contact.email_source_url = enrichment.source_url;
  contact.email_source_type = enrichment.source_type;
  contact.email_confidence = enrichment.confidence;
  contact.email_enrichment_status = enrichment.status;
  contact.email_enrichment_reason = enrichment.reason;
  if (enrichment.email && !contact.email) {
    contact.email = enrichment.email;
  }
};

const processContact = async (
  supabase: ReturnType<typeof getSupabase>,
  contact: DraftQueueRow
) => {
  console.log(`${logPrefix(contact)} processing`);

  if (
    !isNonEmptyString(contact.email) &&
    contact.email_enrichment_status !== "not_found" &&
    contact.email_enrichment_status !== "error"
  ) {
    console.log(`${logPrefix(contact)} email mancante, avvio enrichment`);
    const facts =
      contact.verified_facts_json &&
      typeof contact.verified_facts_json === "object" &&
      !Array.isArray(contact.verified_facts_json)
        ? (contact.verified_facts_json as Record<string, unknown>)
        : {};
    const pdfFullText =
      typeof facts.pdf_full_text === "string" ? facts.pdf_full_text : null;
    const sourceFile =
      typeof facts.source_file === "string" ? facts.source_file : null;
    // Per la ricerca email mando solo il pezzo di PDF attorno al nome (1/20
    // del payload medio) — il contesto stretto basta per disambiguare.
    const pdfChunkForEnrichment = extractContextChunk(
      pdfFullText,
      contact.name,
      2500
    );
    const enrichment = await findPublicEmail(
      {
        name: contact.name,
        company: contact.company,
        source_link: contact.source_link,
        notes: contact.notes,
        city: null,
        language: contact.language,
        pdf_full_text: pdfChunkForEnrichment,
        source_file: sourceFile,
      },
      PROJECT_ROOT
    );
    await persistEnrichment(supabase, contact, enrichment);
    console.log(
      `${logPrefix(contact)} enrichment -> ${enrichment.status} confidence=${enrichment.confidence}`
    );
  } else if (isNonEmptyString(contact.email) && !contact.email_enrichment_status) {
    await persistEnrichment(supabase, contact, {
      email: contact.email,
      source_url: null,
      source_type: "file_import",
      confidence: 1,
      status: "found_public",
      reason: "Email presente nel file di import originale.",
      found_at: new Date().toISOString(),
    });
  }

  if (
    !isNonEmptyString(contact.ai_email_subject) ||
    !isNonEmptyString(contact.ai_email_body)
  ) {
    console.log(`${logPrefix(contact)} draft mancante, invoco Writer`);
    // BUGFIX 2026-05-28: il writer riceveva solo 5 campi e NON il PDF full
    // text. Senza pdf_full_text il writer non aveva contesto per cercare i
    // lavori del regista -> finiva sempre in NOT_READY anche se l'enrichment
    // aveva trovato l'email. Passo tutto il contesto.
    const writerOutcome = await runWriterDraft(
      {
        name: contact.name,
        email: contact.email,
        company: contact.company,
        source_link: contact.source_link,
        notes: contact.notes,
        language: contact.language,
        role: contact.role,
        section: contact.section,
        verified_facts_json: contact.verified_facts_json,
        email_source_url: contact.email_source_url,
        email_confidence: contact.email_confidence,
        email_enrichment_status: contact.email_enrichment_status,
      },
      PROJECT_ROOT
    );

    if ("error" in writerOutcome) {
      await setContactError(
        supabase,
        contact,
        `Writer fallito: ${writerOutcome.error}`
      );
      console.error(
        `${logPrefix(contact)} writer fallito - ${writerOutcome.error}`
      );
      return;
    }

    await persistDraft(supabase, contact, writerOutcome);
    console.log(
      `${logPrefix(contact)} writer ok template=${writerOutcome.template_used} risk=${writerOutcome.risk_score}`
    );
  }

  if (contact.ai_status === "imported") {
    await supabase
      .from("outreach_drafts")
      .update({ ai_status: "draft_ready" })
      .eq("id", contact.id);
  }

  const packet = buildPacket(contact);
  // Hydrate the draft slice of the packet with the just-persisted Writer output so the validators see everything.
  if (isNonEmptyString(contact.ai_email_subject)) {
    packet.draft_subject = contact.ai_email_subject.trim();
  }
  if (isNonEmptyString(contact.ai_email_body)) {
    packet.draft_body = contact.ai_email_body.trim();
  }
  const results = await runAllAgents(packet);
  const aggregated = aggregateResults(results);

  await persistAgentAudit(supabase, contact, results);

  const issueSummary = results.map((result) =>
    describeAgentIssues(result.agent_name, result)
  );

  const { error } = await supabase
    .from("outreach_drafts")
    .update({
      ai_status: aggregated.ai_status,
      ai_validation_status: aggregated.ai_validation_status,
      ai_send_allowed: aggregated.ai_send_allowed,
      ai_validation_summary: `${aggregated.summary} ${issueSummary.join(" | ")}`.trim(),
      ai_agent_checks_json: aggregated.checks_json,
    })
    .eq("id", contact.id);

  if (error) {
    throw error;
  }

  console.log(
    `${logPrefix(contact)} completed -> ${aggregated.ai_status}/${aggregated.ai_validation_status} send_allowed=${aggregated.ai_send_allowed}`
  );
};

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const runCycle = async () => {
  const supabase = getSupabase();
  const queue = await fetchQueue(supabase);

  if (!queue.length) {
    console.log("[worker] queue empty");
    return 0;
  }

  console.log(
    `[worker] fetched ${queue.length} contact(s), concurrency=${WORKER_CONCURRENCY}`
  );

  const runOne = async (contact: DraftQueueRow) => {
    try {
      await processContact(supabase, contact);
    } catch (error) {
      const summary =
        error instanceof Error
          ? error.message
          : "Errore inatteso durante la validazione.";
      await setContactError(supabase, contact, summary);
      console.error(`${logPrefix(contact)} failed`, error);
    }
  };

  let cursor = 0;
  const next = async (): Promise<void> => {
    while (cursor < queue.length) {
      const index = cursor;
      cursor += 1;
      await runOne(queue[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(WORKER_CONCURRENCY, queue.length) }, next)
  );

  return queue.length;
};

const main = async () => {
  const once = process.argv.includes("--once");

  if (once) {
    await runCycle();
    return;
  }

  console.log(`[worker] polling every ${WORKER_POLL_MS}ms`);
  while (true) {
    await runCycle().catch((error) => {
      console.error("[worker] cycle failed", error);
    });
    await sleep(WORKER_POLL_MS);
  }
};

// Single-instance lock: previene che 2 worker girino in parallelo e processino
// lo stesso draft 2 volte (bug diagnosticato 2026-05-28, double validator runs).
const LOCK_FILE = path.join(PROJECT_ROOT, ".local-worker.lock");

const acquireLock = (): boolean => {
  if (existsSync(LOCK_FILE)) {
    try {
      const existingPid = Number.parseInt(readFileSync(LOCK_FILE, "utf8").trim(), 10);
      if (!Number.isNaN(existingPid)) {
        try {
          process.kill(existingPid, 0); // 0 = solo signal-check, no kill
          console.error(
            `[worker] LOCK: un altro worker e' gia' attivo (PID ${existingPid}). Uscita.`
          );
          return false;
        } catch {
          // PID non esistente: lock stale, rimuovo
          console.warn(
            `[worker] LOCK stale (PID ${existingPid} non esiste piu'), riprendo`
          );
          unlinkSync(LOCK_FILE);
        }
      } else {
        unlinkSync(LOCK_FILE);
      }
    } catch (error) {
      console.warn("[worker] LOCK file illeggibile, lo rimuovo", error);
      try { unlinkSync(LOCK_FILE); } catch { /* noop */ }
    }
  }
  writeFileSync(LOCK_FILE, String(process.pid), "utf8");
  return true;
};

const releaseLock = () => {
  try {
    if (existsSync(LOCK_FILE)) {
      const pid = Number.parseInt(readFileSync(LOCK_FILE, "utf8").trim(), 10);
      if (pid === process.pid) unlinkSync(LOCK_FILE);
    }
  } catch {
    // noop
  }
};

if (!acquireLock()) {
  process.exit(1);
}
process.on("SIGINT", () => { releaseLock(); process.exit(0); });
process.on("SIGTERM", () => { releaseLock(); process.exit(0); });
process.on("exit", releaseLock);

main().catch((error) => {
  console.error("[worker] fatal error", error);
  process.exitCode = 1;
});
