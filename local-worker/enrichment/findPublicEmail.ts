import { readFile } from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../agents/shared";
import {
  cleanupTempDirectory,
  createSchemaTempFile,
} from "../agents/shared";

export type EnrichmentInput = {
  name: string;
  company: string | null;
  source_link: string | null;
  notes: string | null;
  city: string | null;
  language: string | null;
  pdf_full_text?: string | null;
  source_file?: string | null;
};

export type EnrichmentStatus =
  | "not_needed"
  | "found_public"
  | "needs_review"
  | "not_found"
  | "error";

export type EnrichmentResult = {
  email: string | null;
  source_url: string | null;
  source_type: string | null;
  confidence: number;
  status: EnrichmentStatus;
  reason: string;
  found_at: string | null;
};

type AgentEmailProposal = {
  agent: "gemini" | "claude" | "codex";
  found: boolean;
  // true = l'AI NON ha potuto cercare (timeout/rete/CLI fallita); diverso da
  // "ha cercato e non ha trovato". Serve a non cancellare per un errore di rete.
  failed: boolean;
  email: string | null;
  source_url: string | null;
  source_type: string | null;
  reason: string;
  raw_output: string;
};

// Timeout generosi: il vero collo di bottiglia non e' la dimensione del
// prompt ma il numero/latenza di WebSearch + WebFetch che ogni AI fa per
// verificare l'email. 30/45/60s erano troppo poco — diagnosticato dai log
// (Pietro 2026-05-28): tutti e 3 in timeout su "diego carli monitus verona".
// RECALL > velocita' (Pietro 2026-06-05: "le mail disponibili online DEVONO
// essere trovate; se si pianta non importa"). Timeout alzati: Gemini veniva
// tagliato a 90s prima di finire la ricerca -> email esistenti perse.
const GEMINI_TIMEOUT_MS = 150_000;
const CLAUDE_TIMEOUT_MS = 180_000;
const CODEX_TIMEOUT_MS = 200_000;

const JUNK_EMAIL_SUFFIXES = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
];

const PUBLIC_EXAMPLE_DOMAINS = new Set([
  "example.com",
  "example.org",
  "domain.com",
  "yourdomain.com",
  "test.com",
  "email.com",
  "sentry.io",
  "wixpress.com",
  "wix.com",
]);

const looksLikeRealEmail = (raw: string): string | null => {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if (!lower) return null;
  if (JUNK_EMAIL_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return null;
  if (lower.includes("..")) return null;
  const [, domain] = lower.split("@");
  if (!domain) return null;
  if (PUBLIC_EXAMPLE_DOMAINS.has(domain)) return null;
  if (/sentry|wixpress|cdn|static|assets|noreply|no-reply|donotreply/.test(lower))
    return null;
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(lower)) return null;
  return lower;
};

const normalizeEmailKey = (email: string | null): string | null => {
  if (!email) return null;
  const clean = looksLikeRealEmail(email);
  return clean ? clean.toLowerCase() : null;
};

const stripCodeFences = (raw: string) =>
  raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

const extractJsonObject = (raw: string): Record<string, unknown> | null => {
  const cleaned = stripCodeFences(raw);
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
};

const buildSearchPrompt = (input: EnrichmentInput): string => {
  const { pdf_full_text, source_file, ...identityFields } = input;
  const lines = [
    "RUOLO: sei un investigatore. Devi trovare l'email PUBBLICA di contatto di un regista/filmmaker, verificandola di persona.",
    "",
    "HAI ACCESSO A INTERNET. DEVI USARLO. Non rispondere senza aver effettivamente caricato pagine web.",
    "",
    "═══════════════════════════════════════════",
    "METODO OBBLIGATORIO (esegui ESATTAMENTE in quest'ordine)",
    "═══════════════════════════════════════════",
    "",
    "STEP 1 — CONTESTO DAL PDF",
    "Cerca il NOME del regista nel testo del documento (PDF) qui sotto. Estrai:",
    "- titolo/i del/dei suoi film",
    "- sezione del festival, anno, paese di produzione",
    "- casa di produzione se citata",
    "Se il nome non è chiaramente identificabile nel PDF: torna {\"found\": false, \"reason\": \"Nome non trovato nel documento\"}.",
    "",
    "STEP 2 — RICERCA WEB MIRATA (USA IL WEB SEARCH TOOL ADESSO)",
    "Esegui ALMENO 3 ricerche distinte combinando nome + contesto dal PDF:",
    "  a) \"<nome regista>\" \"<titolo film più recente>\"",
    "  b) \"<nome regista>\" site:imdb.com",
    "  c) \"<nome regista>\" contact OR email OR contatti",
    "  d) opzionale: \"<nome regista>\" \"<casa produzione>\"",
    "",
    "STEP 3 — APRI LE PAGINE E LEGGI",
    "Per ogni risultato promettente (sito ufficiale, IMDb, FilmFreeway, Vimeo del regista, sito della produzione, sito del festival), USA IL WEB FETCH TOOL per caricare la pagina e LEGGERE il contenuto. NON inventare email basandoti solo sul nome del dominio.",
    "",
    "STEP 4 — VERIFICA",
    "Quando trovi un candidato email:",
    "  a) deve apparire LETTERALMENTE su una pagina pubblica che hai aperto (non solo dedotto)",
    "  b) la pagina deve essere chiaramente ATTRIBUITA a QUESTA persona, non a un'altra con nome simile",
    "  c) deve essere un'email di CONTATTO del regista (anche generica come info@suoSito.com va bene se il sito è il suo o della sua produzione)",
    "  d) NON va bene: email di agenti/manager di celebrità senza che il regista la pubblichi direttamente; email scraped da sentry/wix/cdn; placeholder come info@example.com",
    "",
    "STEP 5 — RESPONSO",
    "Se hai un'email VERIFICATA (vista con i tuoi occhi su una pagina aperta da te) → restituiscila con il source_url ESATTO della pagina dove l'hai vista.",
    "Se hai trovato candidati ma non riesci a verificarli (es. pagina inaccessibile, email troppo generica senza prova chiara) → found:false con reason che spiega cosa hai provato.",
    "Se non hai trovato nulla → found:false con reason che elenca le 3+ query tentate.",
    "",
    "═══════════════════════════════════════════",
    "REGOLE ANTI-ALLUCINAZIONE (niente ipotesi, solo conferme)",
    "═══════════════════════════════════════════",
    "- found:true SOLO se hai VISTO l'email LETTERALMENTE su una pagina pubblica che hai APERTO in questa sessione (metti quel source_url esatto). Se non l'hai vista aperta su una pagina: found:false. SEMPRE.",
    "- MAI costruire/indovinare/dedurre un'email dal nome (es. nome.cognome@gmail.com): un indirizzo a pattern NON visto su una pagina = found:false. È un'ipotesi, e le ipotesi sono VIETATE.",
    "- NON restituire l'email del festival (es. info@trentofestival.it) come email del regista.",
    "- NON restituire l'email di un OMONIMO (es. un regista famoso con stesso nome).",
    "- Per registi CELEBRI con solo agente/PR (Bong Joon-ho, Park Chan-wook, Robert Redford, ecc): preferisci found:false con reason \"raggiungibile solo via agente, non email diretta pubblica\".",
    "- Per registi MORTI (Kim Ki-duk dec.2022, Sydney Pollack dec.2008, Arnold Fanck dec.1974, Blake Edwards dec.2010): found:false con reason \"deceduto\".",
    "- In dubbio: found:false. È molto meglio non trovare che trovare l'email sbagliata.",
    "",
    "═══════════════════════════════════════════",
    "DATI DI INPUT",
    "═══════════════════════════════════════════",
    "",
    "Identità del contatto da cercare:",
    JSON.stringify(identityFields, null, 2),
  ];
  if (pdf_full_text && pdf_full_text.trim()) {
    lines.push(
      "",
      `Testo COMPLETO del documento di origine${source_file ? ` (${source_file})` : ""}:`,
      "<<<DOCUMENT_START>>>",
      pdf_full_text,
      "<<<DOCUMENT_END>>>"
    );
  }
  lines.push(
    "",
    "═══════════════════════════════════════════",
    "OUTPUT (SOLO JSON, NIENTE TESTO PRIMA O DOPO, NIENTE MARKDOWN)",
    "═══════════════════════════════════════════",
    "",
    "Caso successo:",
    '{"found": true, "email": "<email vista su pagina>", "source_url": "<URL ESATTO della pagina dove appare l\'email>", "source_type": "official_site|production|festival|imdb|vimeo|filmfreeway|other", "reason": "<frase: dove e come l\'hai verificata>"}',
    "",
    "Caso fallimento:",
    '{"found": false, "reason": "<spiegazione concreta: query provate, pagine aperte, perche\' non hai trovato/verificato>"}'
  );
  return lines.join("\n");
};

const parseProposal = (
  agent: AgentEmailProposal["agent"],
  rawOutput: string
): AgentEmailProposal => {
  const parsed = extractJsonObject(rawOutput);
  if (!parsed) {
    return {
      agent,
      found: false,
      failed: true,
      email: null,
      source_url: null,
      source_type: null,
      reason: `Output JSON non valido (${agent}).`,
      raw_output: rawOutput,
    };
  }
  const found = parsed.found === true;
  const emailRaw =
    typeof parsed.email === "string" && parsed.email.trim()
      ? parsed.email.trim()
      : null;
  const email = found ? looksLikeRealEmail(emailRaw ?? "") : null;
  return {
    agent,
    found: Boolean(email),
    failed: false,
    email,
    source_url:
      typeof parsed.source_url === "string" && parsed.source_url.trim()
        ? parsed.source_url.trim()
        : null,
    source_type:
      typeof parsed.source_type === "string" && parsed.source_type.trim()
        ? parsed.source_type.trim()
        : null,
    reason:
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim()
        : "",
    raw_output: rawOutput,
  };
};

const withTimeout = async <T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => T
): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const failedProposal = (
  agent: AgentEmailProposal["agent"],
  reason: string,
  rawOutput = ""
): AgentEmailProposal => ({
  agent,
  found: false,
  failed: true,
  email: null,
  source_url: null,
  source_type: null,
  reason,
  raw_output: rawOutput,
});

const searchByGemini = async (
  input: EnrichmentInput,
  cwd: string
): Promise<AgentEmailProposal> => {
  if (process.env.ENRICHMENT_DISABLE_GEMINI === "1") {
    return failedProposal("gemini", "Gemini disattivato via env.");
  }
  const prompt = buildSearchPrompt(input);
  const args = ["-p", prompt, "-o", "text"];
  if (process.env.GEMINI_MODEL?.trim()) {
    args.push("-m", process.env.GEMINI_MODEL.trim());
  }
  return withTimeout(
    (async () => {
      try {
        const result = await runCommand({ command: "gemini", args, cwd });
        const raw = result.stdout.trim() || result.stderr.trim();
        if (result.code !== 0) {
          return failedProposal(
            "gemini",
            `Gemini CLI exited ${result.code ?? "unknown"}.`,
            raw
          );
        }
        return parseProposal("gemini", raw);
      } catch (error) {
        return failedProposal(
          "gemini",
          error instanceof Error ? error.message : "Errore Gemini."
        );
      }
    })(),
    GEMINI_TIMEOUT_MS,
    () => failedProposal("gemini", `Timeout Gemini (${GEMINI_TIMEOUT_MS}ms).`)
  );
};

const searchByClaude = async (
  input: EnrichmentInput,
  cwd: string
): Promise<AgentEmailProposal> => {
  if (process.env.ENRICHMENT_DISABLE_CLAUDE === "1") {
    return failedProposal("claude", "Claude disattivato via env.");
  }
  const prompt = buildSearchPrompt(input);
  // Web access: senza WebSearch + WebFetch Claude non puo' verificare i claim
  // online. acceptEdits e' la permission-mode minima per eseguire i tool.
  // Prompt via STDIN (non come argomento): su Windows la shell spezza un
  // argomento lungo/multi-riga e Claude riceve spazzatura. stdin sicuro ovunque.
  const args = [
    "-p",
    "--allowedTools",
    "WebSearch",
    "WebFetch",
    "--permission-mode",
    "acceptEdits",
    "--output-format",
    "text",
    "--no-session-persistence",
  ];
  if (process.env.CLAUDE_MODEL?.trim()) {
    args.push("--model", process.env.CLAUDE_MODEL.trim());
  }
  return withTimeout(
    (async () => {
      try {
        const result = await runCommand({ command: "claude", args, cwd, stdin: prompt });
        const raw = result.stdout.trim() || result.stderr.trim();
        if (result.code !== 0) {
          return failedProposal(
            "claude",
            `Claude CLI exited ${result.code ?? "unknown"}.`,
            raw
          );
        }
        return parseProposal("claude", raw);
      } catch (error) {
        return failedProposal(
          "claude",
          error instanceof Error ? error.message : "Errore Claude."
        );
      }
    })(),
    CLAUDE_TIMEOUT_MS,
    () => failedProposal("claude", `Timeout Claude (${CLAUDE_TIMEOUT_MS}ms).`)
  );
};

const searchByCodex = async (
  input: EnrichmentInput,
  cwd: string
): Promise<AgentEmailProposal> => {
  if (process.env.ENRICHMENT_DISABLE_CODEX === "1") {
    return failedProposal("codex", "Codex disattivato via env.");
  }
  const prompt = buildSearchPrompt(input);
  let tempDirectory: string | null = null;
  return withTimeout(
    (async () => {
      try {
        const tempFiles = await createSchemaTempFile();
        tempDirectory = tempFiles.directory;
        const outputFile = path.join(tempFiles.directory, "last-message.json");
        // Sandbox read-only blocca anche la rete: passa a workspace-write
        // per permettere a Codex di fare richieste HTTP durante la ricerca.
        const args = [
          "exec",
          "--skip-git-repo-check",
          "--sandbox",
          // Windows: la sandbox OS-level di Codex (workspace-write) spesso non e'
          // supportata -> errore. Li' usiamo danger-full-access. Mac/Linux uguali.
          process.platform === "win32" ? "danger-full-access" : "workspace-write",
          "--output-last-message",
          outputFile,
          "-",
        ];
        if (process.env.CODEX_MODEL?.trim()) {
          args.splice(1, 0, "--model", process.env.CODEX_MODEL.trim());
        }
        const result = await runCommand({
          command: "codex",
          args,
          cwd,
          stdin: prompt,
        });
        const fileOutput = await readFile(outputFile, "utf8").catch(() => "");
        const raw =
          fileOutput.trim() || result.stdout.trim() || result.stderr.trim();
        if (result.code !== 0) {
          return failedProposal(
            "codex",
            `Codex CLI exited ${result.code ?? "unknown"}.`,
            raw
          );
        }
        return parseProposal("codex", raw);
      } catch (error) {
        return failedProposal(
          "codex",
          error instanceof Error ? error.message : "Errore Codex."
        );
      } finally {
        if (tempDirectory) await cleanupTempDirectory(tempDirectory);
      }
    })(),
    CODEX_TIMEOUT_MS,
    () => failedProposal("codex", `Timeout Codex (${CODEX_TIMEOUT_MS}ms).`)
  );
};

const summarizeProposals = (proposals: AgentEmailProposal[]) => {
  const parts = proposals.map((p) => {
    if (!p.found || !p.email) return `${p.agent}: nessuna (${p.reason})`;
    return `${p.agent}: ${p.email}`;
  });
  return parts.join(" · ");
};

const consensusFromProposals = (
  proposals: AgentEmailProposal[]
): EnrichmentResult => {
  const votes = new Map<string, AgentEmailProposal[]>();
  proposals.forEach((p) => {
    const key = normalizeEmailKey(p.email);
    if (!key) return;
    const bucket = votes.get(key) ?? [];
    bucket.push(p);
    votes.set(key, bucket);
  });

  const now = new Date().toISOString();
  const debug = summarizeProposals(proposals);

  // Se TUTTI gli agenti hanno FALLITO (timeout/rete/output illeggibile) non
  // possiamo concludere "nessuna email": e' un ERRORE, non un not_found. Cosi'
  // il worker NON cancella il contatto e riprova al giro dopo.
  const tuttiFalliti =
    proposals.length > 0 && proposals.every((proposal) => proposal.failed);

  if (votes.size === 0) {
    if (tuttiFalliti) {
      return {
        email: null,
        source_url: null,
        source_type: null,
        confidence: 0,
        status: "error",
        reason: `Tutti gli agenti hanno fallito la ricerca (rete/timeout): nessuno ha potuto cercare davvero. ${debug}`,
        found_at: null,
      };
    }
    return {
      email: null,
      source_url: null,
      source_type: null,
      confidence: 0,
      status: "not_found",
      reason: `Nessuna email pubblica trovata dai 3 agenti. ${debug}`,
      found_at: null,
    };
  }

  const ranked = Array.from(votes.entries())
    .map(([key, bucket]) => ({ key, bucket, count: bucket.length }))
    .sort((a, b) => b.count - a.count);

  const top = ranked[0];
  const sample = top.bucket[0];

  if (top.count >= 2) {
    const confidence = top.count === 3 ? 0.95 : 0.78;
    return {
      email: sample.email,
      source_url: sample.source_url,
      source_type: sample.source_type ?? "consensus",
      confidence,
      status: "found_public",
      reason: `Consenso ${top.count}/3 (${top.bucket
        .map((p) => p.agent)
        .join("+")}). ${debug}`,
      found_at: now,
    };
  }

  // Disagreement: each agent proposes a different email. Mark needs_review and
  // keep the first one as a starting point for manual review.
  return {
    email: sample.email,
    source_url: sample.source_url,
    source_type: sample.source_type ?? "single_agent",
    confidence: 0.4,
    status: "needs_review",
    reason: `Disaccordo tra agenti, nessuna email ha 2+ voti. ${debug}`,
    found_at: now,
  };
};

export const findPublicEmail = async (
  input: EnrichmentInput,
  workingDirectory: string
): Promise<EnrichmentResult> => {
  const trimmedName = input.name?.trim();
  if (!trimmedName) {
    return {
      email: null,
      source_url: null,
      source_type: null,
      confidence: 0,
      status: "not_found",
      reason: "Nome destinatario mancante, enrichment impossibile.",
      found_at: null,
    };
  }

  try {
    // RICERCA a DUE (Pietro 2026-06-05): Claude + Codex, i due affidabili.
    // Tolto Gemini (free tier strozzato -> timeout, instabile, faceva perdere
    // tempo). Le email che esistono online vanno trovate: 2 cercatori solidi
    // sono meglio di 3 con uno che si pianta. Se concordano, confidence 0.78.
    const proposals = await Promise.all([
      searchByClaude(input, workingDirectory),
      searchByCodex(input, workingDirectory),
    ]);
    return consensusFromProposals(proposals);
  } catch (error) {
    return {
      email: null,
      source_url: null,
      source_type: null,
      confidence: 0,
      status: "error",
      reason: error instanceof Error ? error.message : "Errore enrichment.",
      found_at: null,
    };
  }
};
