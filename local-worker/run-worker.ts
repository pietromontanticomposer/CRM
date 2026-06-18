import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { AiAgentName } from "../src/lib/aiOutreach";
import { aggregateResults } from "./aggregateResults";
import { runClaudeCheck } from "./agents/claudeCheck";
import { runCodexCheck } from "./agents/codexCheck";
import type { AgentRunResult, ValidationPacket } from "./agents/shared";
import { noteCliCongestion, getCliCap } from "./agents/shared";
import {
  runWriterDraft,
  sanitizeMailBody,
  findForbiddenInBody,
  type WriterDraftResult,
} from "./agents/writerDraft";
import { runContactTriage } from "./agents/triageContact";
import {
  findPublicEmail,
  fetchFilmContext,
  fetchFilmSynopsisViaClaude,
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
  ai_template_used: string | null;
  ai_link_visione: string | null;
  ai_risk_score_numeric: number | null;
  verified_facts_json: unknown;
  source_link: string | null;
  prompt_master_rules: string | null;
  email_source_url: string | null;
  email_source_type: string | null;
  email_confidence: number | null;
  email_enrichment_status: string | null;
  email_enrichment_reason: string | null;
  ai_attempts: number | null;
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

// Un timeout dello scrittore (Codex lento sotto carico) NON deve diventare un
// errore permanente: la bozza verrebbe abbandonata e mai ripresa. La rimettiamo
// in coda fino a MAX_WRITER_RETRIES volte; solo dopo diventa "error".
const MAX_WRITER_RETRIES = 2;
const WORKER_POLL_MS = Math.max(
  5000,
  Number.parseInt(process.env.OUTREACH_WORKER_POLL_MS ?? "15000", 10) || 15000
);
// Concorrenza calibrata sulla CPU REALE della macchina. Ogni contatto puo'
// scatenare fino a 9 CLI calls pesanti (3 enrichment + 1 writer + 3
// validatori, gia' seriali tra loro). Su questo Mac (Intel i7, 4 core
// fisici / 8 logici, 2014) tenere 10 contatti in volo = thrash di CPU e
// timeout a catena: ERA il vero motivo della lentezza. Regola: ~1 contatto
// ogni 3 core logici, clamp [2,4]. Override con OUTREACH_WORKER_CONCURRENCY.
const CPU_COUNT = os.cpus().length || 4;
void CPU_COUNT;
// FLESSIBILE AUTO-ADATTIVO (Pietro 2026-06-07): il collo di bottiglia e' la RETE.
// Mettiamo TANTI contatti in volo; a governare la rete ci pensa il semaforo CLI
// ADATTIVO di shared.ts (AIMD): alza le ricerche in parallelo quando la rete
// regge e le DIMEZZA appena qualcosa va in timeout / "fetch failed". Cosi' va
// veloce quando puo' e non intasa mai, su qualunque macchina. La concorrenza
// reale e' quella del semaforo, non questo numero: qui teniamo solo abbastanza
// contatti pronti da alimentare il pool. Override: OUTREACH_WORKER_CONCURRENCY.
const CLI_MAX = Math.max(2, Number(process.env.MAX_CONCURRENT_CLI) || 4);
const DEFAULT_CONCURRENCY = CLI_MAX;
const WORKER_CONCURRENCY = Math.max(
  1,
  Number.parseInt(
    process.env.OUTREACH_WORKER_CONCURRENCY ?? String(DEFAULT_CONCURRENCY),
    10
  ) || DEFAULT_CONCURRENCY
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

// Fetch con RITENTATIVI (Pietro 2026-06-05): sotto carico la rete ha dei
// singhiozzi ("fetch failed"). Senza ritentativi una chiamata al DB persa
// poteva far sbagliare o perdere un contatto. Qui ogni chiamata riprova fino a
// 3 volte con attesa crescente. Vale per TUTTE le chiamate Supabase del worker.
const retryingFetch = async (
  ...args: Parameters<typeof fetch>
): Promise<Response> => {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetch(...args);
    } catch (err) {
      lastErr = err;
      // "fetch failed"/ConnectTimeout = la rete e' satura: segnala intasamento
      // cosi' il semaforo CLI dimezza la concorrenza e si sgonfia da solo.
      noteCliCongestion();
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
};

const getSupabase = () =>
  createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: retryingFetch },
  });

// Pietro 2026-06-01: i contatti che NON approva personalmente NON devono
// restare nel database. Cancello la riga via REST col service key (il client
// supabase-js a volte non cancella per una policy RLS; la REST col service role
// funziona sempre, come la route /approve).
const deleteDraftRow = async (id: string) => {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return;
  await retryingFetch(`${url}/rest/v1/outreach_drafts?id=eq.${id}`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  }).catch((e) => {
    console.warn(`[worker] delete draft ${id.slice(0, 8)} fallito:`, e);
  });
};

// outreach_drafts e' uno SPAZIO DI LAVORO. Quando Pietro APPROVA una bozza, viene
// SPOSTATA in `contacts` (permanente, via /api/outreach/drafts/[id]/approve) e
// cancellata da qui. Le bozze NON approvate RESTANO finche' Pietro non le approva,
// le scarta a mano, o invecchiano oltre il TTL (vedi wipeStaleDrafts). NIENTE
// svuotamento alla chiusura del worker (vedi gracefulShutdown): chiudere la
// finestra NON deve mai distruggere un batch. [Wipe-on-close rimosso 2026-06-11
// dopo che un SIGHUP cancello' un intero batch di 123 registi.]

// Backstop all'avvio: ripulisce SOLO i draft "vecchi" — leftover di una sessione
// morta male (crash o kill -9, senza shutdown pulito) — senza toccare gli import
// FRESCHI che l'utente ha appena caricato e sta per far lavorare.
const wipeStaleDrafts = async (
  hours: number,
  reason: string
): Promise<number> => {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return 0;
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
  try {
    const res = await retryingFetch(
      `${url}/rest/v1/outreach_drafts?created_at=lt.${cutoff}`,
      {
        method: "DELETE",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Prefer: "return=representation",
        },
      }
    );
    if (!res.ok) {
      console.warn(
        `[worker] PULIZIA avvio (${reason}) FALLITA: HTTP ${res.status}.`
      );
      return 0;
    }
    const body = (await res.json().catch(() => [])) as unknown[];
    const n = Array.isArray(body) ? body.length : 0;
    if (n > 0) {
      console.warn(
        `[worker] PULIZIA avvio (${reason}): rimossi ${n} draft vecchi (> ${hours}h).`
      );
    }
    return n;
  } catch (error) {
    console.warn(`[worker] PULIZIA stale (${reason}) fallita:`, error);
    return 0;
  }
};

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
    draft_link_visione: contact.ai_link_visione?.trim() ?? "",
    draft_template_used: contact.ai_template_used?.trim() ?? "",
    draft_risk_score: contact.ai_risk_score_numeric ?? null,
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
      "id, owner_id, name, email, company, role, notes, section, language, batch_id, batch_name, ai_status, ai_email_subject, ai_email_body, ai_template_used, ai_link_visione, ai_risk_score_numeric, verified_facts_json, source_link, prompt_master_rules, email_source_url, email_source_type, email_confidence, email_enrichment_status, email_enrichment_reason, ai_attempts"
    )
    .in("ai_status", ["imported", "draft_ready", "processing"])
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

// Scartato dal triage: non e' una persona reale (titolo di film, nazione,
// intestazione, spazzatura). Riusiamo lo stato "blocked" cosi' non serve una
// nuova migration; il summary spiega che e' stato scartato in automatico.
// Pietro NON deve toccarlo a mano: resta visibile come "bloccato" e basta.
const markDiscarded = async (
  _supabase: ReturnType<typeof getSupabase>,
  contact: DraftQueueRow,
  _reason: string
) => {
  // Non e' un regista reale -> non approvabile -> CANCELLO la riga (il motivo
  // e' gia' loggato dal chiamante). Niente "blocked" che resta nel DB.
  await deleteDraftRow(contact.id);
};

// MAIL MANCANTE (Pietro 2026-06-10): il regista è valido (triage ok) ma l'email
// NON è stata trovata/confermata. Non scrivo la mail (inutile senza indirizzo) e
// NON cancello: lo metto in "mail_mancante" — info buone, manca solo il contatto.
// Pietro decide se cercare l'email a mano o lasciarlo. Niente "da rivedere".
const markMailMancante = async (
  supabase: ReturnType<typeof getSupabase>,
  contact: DraftQueueRow
) => {
  await supabase
    .from("outreach_drafts")
    .update({
      ai_status: "mail_mancante",
      ai_validation_status: "not_checked",
      ai_send_allowed: false,
      ai_validation_summary:
        "Regista valido ma email non trovata/non certa: serve l'indirizzo.",
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

// Controllo a DUE (Pietro 2026-06-05): tolto Gemini, era solo un peso (free
// tier strozzato -> timeout costanti, ~5 min sprecati a contatto, contributo
// nullo). Claude + Codex sono affidabili e bastano: l'aggregatore blocca se la
// MAGGIORANZA respinge il contenuto, quindi con 2 servono entrambi i no per
// bloccare (sicurezza solida, vista su Hans Zimmer). In serie per non far
// competere i CLI sulla rete.
const runAllAgents = async (
  packet: ValidationPacket
): Promise<AgentRunResult[]> => {
  const claude = await runClaudeCheck(packet, PROJECT_ROOT);
  const codex = await runCodexCheck(packet, PROJECT_ROOT);
  return [claude, codex];
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
      ai_email_body: sanitizeMailBody(draft.body),
      ai_template_used: draft.template_used,
      ai_risk_score: numericToRiskLabel(draft.risk_score),
      ai_risk_score_numeric: draft.risk_score,
      ai_link_visione: draft.link_visione,
      ai_sources: draft.sources,
      ai_director_tier: draft.director_tier,
      ai_director_tier_reason: draft.director_tier_reason,
      ai_director_photo_url: draft.director_photo_url,
      ai_writer_reason: draft.reason,
      ai_generated_at: generatedAt,
    })
    .eq("id", contact.id);

  if (error) {
    throw error;
  }

  contact.ai_email_subject = draft.subject;
  contact.ai_email_body = sanitizeMailBody(draft.body);
  contact.ai_template_used = draft.template_used;
  contact.ai_link_visione = draft.link_visione;
  contact.ai_risk_score_numeric = draft.risk_score;
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

  // Segna SUBITO lo stato "processing" cosi' la pagina mostra il regista
  // "in lavorazione" in tempo reale (prima restava "in coda" per 3-4 min,
  // mentre cercava email + scriveva). wasImported: il triage gira solo sui
  // contatti freschi, e ora lo stato cambia, quindi me lo ricordo qui.
  const wasImported = contact.ai_status === "imported";
  if (contact.ai_status === "imported" || contact.ai_status === "draft_ready") {
    const previousStatus = contact.ai_status;
    contact.ai_status = "processing";
    const { error: procErr } = await supabase
      .from("outreach_drafts")
      .update({ ai_status: "processing" })
      .eq("id", contact.id);
    if (procErr) {
      contact.ai_status = previousStatus;
      console.warn(`${logPrefix(contact)} set processing fallito: ${procErr.message}`);
    }
  }

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

  // TRIAGE (solo al primo passaggio, stato "imported"): un giudice AI locale
  // (claude -p) verifica che il contatto sia davvero una persona reale e non
  // spazzatura estratta per errore dai PDF (titoli di film, nazioni,
  // intestazioni, testo "titolo+nome" attaccato). Se non lo e', lo scartiamo
  // PRIMA di sprecare enrichment + writer + 3 validatori. Se il nome e'
  // sporco, lo ripuliamo. Cosi' Pietro non deve pulire niente a mano.
  if (wasImported) {
    const triage = await runContactTriage(
      {
        name: contact.name,
        company: contact.company,
        section: contact.section,
        notes: contact.notes,
        source_file: sourceFile,
        pdf_context: extractContextChunk(pdfFullText, contact.name, 1500),
      },
      PROJECT_ROOT
    );
    if (!("error" in triage)) {
      if (!triage.is_real_person) {
        await markDiscarded(supabase, contact, triage.reason);
        console.log(
          `${logPrefix(contact)} SCARTATO in triage -> ${triage.reason}`
        );
        return;
      }
      const cleaned = triage.cleaned_name.trim();
      if (cleaned.length >= 2 && cleaned !== contact.name) {
        const { error: renameError } = await supabase
          .from("outreach_drafts")
          .update({ name: cleaned })
          .eq("id", contact.id);
        if (!renameError) {
          console.log(
            `${logPrefix(contact)} nome ripulito "${contact.name}" -> "${cleaned}"`
          );
          contact.name = cleaned;
        }
      }
    } else {
      // Fail-open: se il triage fallisce non perdiamo il contatto, lo lasciamo
      // proseguire — i 3 validatori controllano comunque contact_ok.
      console.warn(
        `${logPrefix(contact)} triage non disponibile (proseguo): ${triage.error}`
      );
    }
  }

  if (
    !isNonEmptyString(contact.email) &&
    // "error" (rete/timeout) NON e' escluso: la ricerca si RIPROVA. Solo
    // "not_found" (ricerca riuscita, nessuna email pubblica) ferma i tentativi.
    contact.email_enrichment_status !== "not_found"
  ) {
    console.log(`${logPrefix(contact)} email mancante, avvio enrichment`);
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
    // Diagnostica: se la ricerca non ha prodotto un'email, mostro il dettaglio
    // per-agente (es. "claude: ... · codex: Codex CLI exited 1") cosi' si vede
    // SUBITO perche' una CLI fallisce (utile per diagnosticare Windows).
    if (enrichment.status === "error" || enrichment.status === "not_found") {
      console.log(`${logPrefix(contact)} enrichment dettaglio: ${enrichment.reason}`);
    }
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

  // MOSSA INTELLIGENTE: cancello sull'email. Se dopo la ricerca esaustiva NON
  // c'e' un'email, saltiamo SUBITO (niente writer, niente 3 validatori). Cosi'
  // il lavoro pesante lo facciamo SOLO sui registi contattabili. Non si perde
  // niente: senza email non li mandavi comunque. Eccezione: se la bozza
  // esisteva gia' (rilancio di un draft gia' scritto), lasciamo proseguire.
  const draftAlreadyExists =
    isNonEmptyString(contact.ai_email_subject) &&
    isNonEmptyString(contact.ai_email_body);
  // FIX 2026-06-04: salta SOLO se non e' stata trovata NESSUNA email.
  // BUG precedente: saltava anche le email con confidence < 0.5. Ma con
  // l'enrichment a 2 AI un'email trovata da UN SOLO agente vale 0.4
  // (needs_review) -> sono PROPRIO i lead che Pietro vuole rivedere a mano,
  // e la soglia 0.5 li cancellava TUTTI. L'email "debole" la ricontrollano
  // comunque i 3 validatori + l'approvazione manuale: e' il senso del sistema.
  // MAI cancellare se la ricerca email e' ANDATA IN ERRORE (rete/timeout): non
  // sappiamo se l'email esiste. Lascio il contatto e si riprova al prossimo giro.
  if (contact.email_enrichment_status === "error" && !draftAlreadyExists) {
    console.log(
      `${logPrefix(contact)} ricerca email fallita per rete -> NON cancello, riprovo al prossimo giro`
    );
    return;
  }
  // REGOLA PIETRO (2026-06-10): 10 perfetti > 30 di merda. Scrivo SOLO se l'email
  // è CERTA (zero margine di dubbio): presente + confidence >= 0.7 (le email
  // indovinate "nome.cognome@gmail" valgono 0.4 → NON certe). Tutto il resto va
  // in "mail_mancante", non viene scritto. Niente più bozze su email indovinate.
  const emailCertain =
    isNonEmptyString(contact.email) && (contact.email_confidence ?? 0) >= 0.7;
  if (!emailCertain && !draftAlreadyExists) {
    await markMailMancante(supabase, contact);
    console.log(
      `${logPrefix(contact)} MAIL MANCANTE -> email non certa (conf ${contact.email_confidence ?? 0})`
    );
    return;
  }

  if (
    !isNonEmptyString(contact.ai_email_subject) ||
    !isNonEmptyString(contact.ai_email_body)
  ) {
    console.log(`${logPrefix(contact)} draft mancante, invoco Writer`);
    // SINOSSI REALE per il complimento (Pietro 2026-06-11): prendiamo NOI il
    // testo del film dalla pagina del festival/sinossi e lo passiamo allo
    // scrittore + validatori. Cosi' il complimento e' su materiale VERO (con
    // fonte), non inventato. Se non si trova (rete/motore giu'), lo scrittore
    // ripiega sul tema del titolo (niente specifici inventati). Graceful.
    {
      const facts: Record<string, unknown> =
        contact.verified_facts_json &&
        typeof contact.verified_facts_json === "object" &&
        !Array.isArray(contact.verified_facts_json)
          ? { ...(contact.verified_facts_json as Record<string, unknown>) }
          : {};
      const filmTitle = typeof facts.film === "string" ? facts.film : null;
      if (filmTitle && !facts.film_synopsis) {
        const festivalHint =
          (typeof facts.festival === "string" ? facts.festival : "") ||
          contact.prompt_master_rules ||
          "";
        // 1) Prima il metodo gratuito (scraping DuckDuckGo). 2) Se fallisce
        // (motore bloccato), fallback col web VERO del CLI claude: cosi' la
        // sinossi si trova in modo affidabile e scrittore+validatori partono
        // dalla STESSA fonte (codex smette di scartare complimenti veri).
        let ctx = await fetchFilmContext(
          filmTitle,
          festivalHint,
          contact.name
        ).catch(() => null);
        if (!ctx) {
          ctx = await fetchFilmSynopsisViaClaude(
            filmTitle,
            festivalHint,
            contact.name,
            PROJECT_ROOT
          ).catch(() => null);
          if (ctx) {
            console.log(
              `${logPrefix(contact)} sinossi via claude (fallback web)`
            );
          }
        }
        if (ctx) {
          facts.film_synopsis = ctx.text;
          facts.film_synopsis_url = ctx.url;
          contact.verified_facts_json = facts;
          await supabase
            .from("outreach_drafts")
            .update({ verified_facts_json: facts })
            .eq("id", contact.id);
          console.log(`${logPrefix(contact)} sinossi film trovata -> ${ctx.url}`);
        } else {
          console.log(
            `${logPrefix(contact)} sinossi film NON trovata (scrittore usa solo il titolo)`
          );
        }
      }
    }
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
        prompt_master_rules: contact.prompt_master_rules,
      },
      PROJECT_ROOT
    );

    if ("error" in writerOutcome) {
      // Timeout = singhiozzo sotto carico, non un difetto della bozza: la
      // rimettiamo in coda (max MAX_WRITER_RETRIES) invece di abbandonarla.
      const isTimeout = /timeout/i.test(writerOutcome.error);
      const attempts = Number(contact.ai_attempts ?? 0);
      if (isTimeout && attempts < MAX_WRITER_RETRIES) {
        // "draft_ready" (non "imported"): al re-fetch salta triage+enrichment
        // (l'email c'e' gia') e torna dritto allo scrittore. Niente lavoro doppio.
        await supabase
          .from("outreach_drafts")
          .update({ ai_status: "draft_ready", ai_attempts: attempts + 1 })
          .eq("id", contact.id);
        console.warn(
          `${logPrefix(contact)} writer timeout - rimesso in coda (tentativo ${attempts + 1}/${MAX_WRITER_RETRIES + 1})`
        );
        return;
      }
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

    // PAROLE VIETATE (controllo meccanico DETERMINISTICO, non affidato all'AI):
    // se il writer ha usato una parola/frase della blacklist di Pietro, rigenero
    // (fino a MAX_WRITER_RETRIES). Match a confini di parola: "proposta" italiana
    // NON scatta su "proposal" inglese. Dopo i tentativi, si tiene comunque la
    // bozza (caso raro: la rivede Pietro). Cosi' niente piu' falsi blocchi AI.
    {
      const forbiddenHits = findForbiddenInBody(
        writerOutcome.body,
        FORBIDDEN_WORDS
      );
      const fbAttempts = Number(contact.ai_attempts ?? 0);
      if (forbiddenHits.length > 0 && fbAttempts < MAX_WRITER_RETRIES) {
        await supabase
          .from("outreach_drafts")
          .update({ ai_status: "draft_ready", ai_attempts: fbAttempts + 1 })
          .eq("id", contact.id);
        console.warn(
          `${logPrefix(contact)} writer ha usato parole vietate [${forbiddenHits.join(
            ", "
          )}] - rigenero (tentativo ${fbAttempts + 1}/${MAX_WRITER_RETRIES + 1})`
        );
        return;
      }
    }

    await persistDraft(supabase, contact, writerOutcome);
    console.log(
      `${logPrefix(contact)} writer ok template=${writerOutcome.template_used} risk=${writerOutcome.risk_score}`
    );
  }

  if (
    contact.ai_status === "imported" ||
    contact.ai_status === "processing"
  ) {
    contact.ai_status = "draft_ready";
    await supabase
      .from("outreach_drafts")
      .update({ ai_status: "draft_ready" })
      .eq("id", contact.id);
  }

  const packet = buildPacket(contact);
  // Hydrate the draft slice of the packet with the just-persisted Writer output so the validators see everything.
  // FIX 2026-05-31: prima si idratavano SOLO subject/body, lasciando i
  // validatori a controllare con template/link/risk vuoti (PARTE 3 m,n alla
  // cieca). Ora passiamo l'intera bozza: template, link visione e risk inclusi.
  if (isNonEmptyString(contact.ai_email_subject)) {
    packet.draft_subject = contact.ai_email_subject.trim();
  }
  if (isNonEmptyString(contact.ai_email_body)) {
    packet.draft_body = contact.ai_email_body.trim();
  }
  if (isNonEmptyString(contact.ai_template_used)) {
    packet.draft_template_used = contact.ai_template_used.trim();
  }
  if (isNonEmptyString(contact.ai_link_visione)) {
    packet.draft_link_visione = contact.ai_link_visione.trim();
  }
  if (typeof contact.ai_risk_score_numeric === "number") {
    packet.draft_risk_score = contact.ai_risk_score_numeric;
  }
  const results = await runAllAgents(packet);
  const aggregated = aggregateResults(results);

  // Log conciso dei verdetti dei validatori (utile per capire perche' un
  // contatto e' stato bloccato/tenuto: i bloccati vengono cancellati senza audit).
  console.log(
    `${logPrefix(contact)} verdetti: ${results
      .map(
        (result) =>
          `${result.agent_name}=${
            result.failed ? "fallito" : result.approved ? "ok" : "respinto"
          }`
      )
      .join(" ")}`
  );

  // Pietro 2026-06-10: i BLOCCATI (Scartata) NON si cancellano più. Restano
  // visibili nella colonna "Scartate" con la mail scritta e il motivo del
  // rifiuto, così vedi cosa è stato scartato e perché. (I validatori giù /
  // transitori NON arrivano qui: l'aggregator li manda a "draft_ready" per
  // riprovare, non a "blocked".)
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
    `[worker] fetched ${queue.length} contact(s), contatti=${WORKER_CONCURRENCY} · rete(CLI)=${getCliCap()} [auto]`
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

// File "handover": quando un NUOVO worker fa takeover di uno vecchio (relaunch),
// lo scrive PRIMA di mandare SIGTERM. Il worker che muore, vedendolo, NON svuota
// i draft (li passa al successore). Cosi' un relaunch dopo un import NON cancella
// per sbaglio i contatti appena importati. Solo una chiusura VERA (Ctrl-C,
// finestra chiusa, kill) — senza successore — svuota i draft.
const HANDOVER_FILE = path.join(PROJECT_ROOT, ".local-worker.handover");
// Default 30 GIORNI (Pietro 2026-06-11 + codex): l'utente può metterci giorni a
// revisionare un batch. Un TTL di poche ore cancellava il batch al riavvio. La
// pulizia automatica tocca SOLO i veri abbandonati vecchi di un mese.
const STALE_DRAFT_HOURS = Math.max(
  0.25,
  Number(process.env.OUTREACH_DRAFT_STALE_HOURS) || 24 * 30
);
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

// Takeover all'avvio: se restano worker vecchi (es. orfani re-parented a
// launchd dopo la chiusura della finestra del Terminale, che NON ricevono
// SIGHUP), il lancio piu' recente VINCE. Li chiudiamo prima di prendere il
// lock, cosi' non si accumulano mai piu' istanze che competono per la CPU
// (causa concreta della lentezza diagnosticata 2026-05-28).
const terminateOtherWorkers = (): boolean => {
  // Cross-platform (Mac e Windows): il PID del worker precedente e' salvato nel
  // lock file da acquireLock(). Niente "pgrep"/"sleep" (non esistono su
  // Windows): il lancio piu' recente VINCE e chiude il predecessore.
  // Ritorna true se ha davvero rilevato e chiuso un worker preesistente
  // (takeover): in quel caso i draft NON vanno svuotati, sono un handover.
  let previousPid: number | null = null;
  try {
    if (existsSync(LOCK_FILE)) {
      const parsed = Number.parseInt(readFileSync(LOCK_FILE, "utf8").trim(), 10);
      if (Number.isFinite(parsed)) previousPid = parsed;
    }
  } catch {
    return false;
  }
  if (
    previousPid === null ||
    previousPid === process.pid ||
    previousPid === process.ppid
  ) {
    return false;
  }
  try {
    process.kill(previousPid, 0); // 0 = solo signal-check, no kill
  } catch {
    return false; // gia' morto: niente da fare
  }
  // HANDOVER: avviso il predecessore che e' un takeover, cosi' NON svuota i
  // draft morendo (li eredito io). Scritto PRIMA del SIGTERM.
  try {
    writeFileSync(HANDOVER_FILE, String(process.pid), "utf8");
  } catch {
    /* noop */
  }
  try {
    process.kill(previousPid, "SIGTERM");
    console.warn(`[worker] takeover: chiudo worker preesistente PID ${previousPid}`);
  } catch {
    return false;
  }
  // Attesa sincrona ~2s (cross-platform, senza comandi esterni) per lasciare
  // tempo allo shutdown pulito (releaseLock), poi SIGKILL se ancora vivo.
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  } catch {
    /* noop */
  }
  try {
    process.kill(previousPid, 0);
    process.kill(previousPid, "SIGKILL");
  } catch {
    /* gia' morto: ok */
  }
  return true;
};

const tookOver = terminateOtherWorkers();
if (!acquireLock()) {
  process.exit(1);
}
// Lock acquisito: l'eventuale handover e' stato consumato (il predecessore e'
// gia' uscito). Lo rimuovo cosi' una chiusura FUTURA di questo worker svuota
// davvero i draft.
try {
  if (existsSync(HANDOVER_FILE)) unlinkSync(HANDOVER_FILE);
} catch {
  /* noop */
}

const ONCE = process.argv.includes("--once");

// Chiusura del worker: svuota i draft NON approvati. Async perche' fa una
// DELETE prima di uscire. Salta lo svuotamento solo se e' un takeover
// (handover) o in modalita' --once (usata dai test). Guard anti doppio-exit.
let shuttingDown = false;
const gracefulShutdown = async (signal: string, exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    // CHIUSURA NON DISTRUTTIVA (Pietro 2026-06-11 + codex): chiudere il worker —
    // anche solo SIGHUP (finestra del Terminale chiusa), o un deploy, o lo sleep
    // del Mac — NON deve MAI cancellare il batch. Le bozze NON approvate RESTANO
    // in DB: al riavvio il worker le riprende. La pulizia avviene solo (a) allo
    // start per i veri abbandonati >30gg, (b) su azione esplicita dell'utente.
    // [INCIDENTE 2026-06-11: un SIGHUP cancellò un intero batch di 123 registi.]
    console.warn(
      `[worker] ${signal}: chiusura. Le bozze NON approvate RESTANO in DB (nessun wipe).`
    );
  } finally {
    releaseLock();
    process.exit(exitCode);
  }
};
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
// SIGHUP = la finestra del Terminale e' stata chiusa. Senza questo handler il
// worker veniva orfanato e restava a girare (PPID 1), accumulandosi.
process.on("SIGHUP", () => void gracefulShutdown("SIGHUP"));
process.on("exit", releaseLock);

const bootstrap = async () => {
  // Backstop avvio: ripulisce SOLO i leftover VECCHI (>30gg). I draft rimasti
  // "processing" da un worker morto a meta' NON serve resettarli: la coda di
  // lavoro (fetch) include gia' lo stato "processing", quindi vengono RIPRESI e
  // rilavorati da soli. Non in --once (test), non su takeover (i draft del
  // predecessore sono validi e li sto ereditando).
  if (!ONCE && !tookOver) {
    await wipeStaleDrafts(
      STALE_DRAFT_HOURS,
      "leftover di sessione precedente (>30gg)"
    );
  }
  await main();
};

bootstrap().catch((error) => {
  console.error("[worker] fatal error", error);
  // Un CRASH non e' una chiusura VOLUTA: NON cancelliamo i draft. Cosi' un crash
  // a meta' batch non distrugge ore di lavoro gia' fatto. I draft restano in DB;
  // al riavvio il backstop (STALE_DRAFT_HOURS) toglie solo i veri abbandonati, e
  // una chiusura voluta (SIGINT/SIGTERM/SIGHUP) li svuota come da regola Pietro.
  shuttingDown = true; // blocca un eventuale wipe da signal handler concorrente
  releaseLock();
  process.exit(1);
});
