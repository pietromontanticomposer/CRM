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
  agent: "gemini" | "claude" | "codex" | "web";
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

// ============================================================================
// CERCATORE DETERMINISTICO (Pietro 2026-06-11): "se l'email esiste deve trovarla".
// Non dipende dai capricci dell'AI: cerca lui su DuckDuckGo (gratis, no API),
// apre i primi risultati e legge le email DALLA pagina. Gira INSIEME a
// claude+codex come 3° cercatore -> becca le pagine che gli altri saltano.
// ============================================================================
const FAKE_EMAIL_TLD =
  /\.(jpg|jpeg|png|gif|webp|svg|css|js|bmp|ico|pdf|mp4|woff2?|ttf)$/i;
const GENERIC_EMAIL_PREFIX =
  /^(info|contatti?|contact|redazione|press|ufficio|amministrazione|segreteria|segretaria|booking|distribuzione|comunicazione|stampa|filmcommission|commission|noreply|no-reply|hello|posta|mail|newsletter|privacy|support|help)\b/i;
const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// Local-part di esempio/placeholder (NON sono email vere): vanno scartati.
const PLACEHOLDER_LOCAL =
  /^(jean\.?dupont|john\.?doe|jane\.?doe|mario\.?rossi|nome\.?cognome|name|firstname|lastname|your\.?name|your\.?email|email|e-?mail|user|username|test|demo|sample|example|esempio|foo|bar|abc|xyz|nomecognome)$/i;
const PLACEHOLDER_DOMAIN = /^(example|test|domain|yoursite|yourdomain|email)\./i;

const fetchPageText = async (url: string): Promise<string> => {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CRMbot/1.0)" },
      redirect: "follow",
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
};

const ddgResultUrls = async (query: string): Promise<string[]> => {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(
      "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query),
      {
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        redirect: "follow",
      }
    ).finally(() => clearTimeout(timer));
    if (!res.ok) return [];
    const html = await res.text();
    const out: string[] = [];
    const re = /uddg=([^"&]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      try {
        const u = decodeURIComponent(m[1]);
        if (/^https?:\/\//i.test(u) && !/duckduckgo\.com/i.test(u)) out.push(u);
      } catch {
        /* ignore */
      }
    }
    return [...new Set(out)];
  } catch {
    return [];
  }
};

const tokensOfName = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[\s'’.-]+/)
    .filter((t) => t.length >= 3);

const searchByWeb = async (
  input: EnrichmentInput,
  _cwd: string
): Promise<AgentEmailProposal> => {
  const name = (input.name ?? "").trim();
  if (!name) return failedProposal("web", "Nome mancante.");
  const tokens = tokensOfName(name);
  try {
    // 1) Ricerca + raccolta URL (2 query per coprire meglio).
    const queries = [`"${name}" email contatti`, `${name} regista email`];
    const urlLists = await Promise.all(queries.map((q) => ddgResultUrls(q)));
    const urls = [...new Set(urlLists.flat())].slice(0, 7);
    if (urls.length === 0) {
      return {
        agent: "web",
        found: false,
        failed: false,
        email: null,
        source_url: null,
        source_type: null,
        reason: "Ricerca web: nessun risultato (motore non raggiungibile?).",
        raw_output: "",
      };
    }
    // 2) Apri le pagine, estrai le email, dai un punteggio.
    let best: { email: string; url: string; score: number } | null = null;
    for (const url of urls) {
      const text = await fetchPageText(url);
      if (!text) continue;
      const urlSlug = url.toLowerCase();
      const emails = [
        ...new Set((text.match(EMAIL_IN_TEXT) ?? []).map((e) => e.toLowerCase())),
      ];
      for (const email of emails) {
        if (FAKE_EMAIL_TLD.test(email)) continue; // filename immagini
        const [local, domain] = email.split("@");
        if (!domain) continue;
        if (PLACEHOLDER_LOCAL.test(local) || PLACEHOLDER_DOMAIN.test(domain)) continue;
        if (GENERIC_EMAIL_PREFIX.test(local)) continue; // info@, press@...
        // PRECISIONE (Pietro: meglio mancare che sbagliare): accetto SOLO se il
        // local-part contiene il NOME del regista (>=4 lettere). È il segnale
        // affidabile che l'email è SUA. Niente email a caso prese da una pagina
        // o dal dominio di un sito qualsiasi (placeholder, email del sito, ecc.).
        const localClean = local.replace(/[^a-z]/g, "");
        const nameInLocal = tokens.some(
          (t) => t.length >= 4 && localClean.includes(t)
        );
        if (!nameInLocal) continue;
        let score = 3;
        if (tokens.some((t) => t.length >= 4 && urlSlug.includes(t))) score += 1;
        if (!best || score > best.score) best = { email, url, score };
      }
    }
    if (!best) {
      return {
        agent: "web",
        found: false,
        failed: false,
        email: null,
        source_url: null,
        source_type: null,
        reason: `Ricerca web: aperte ${urls.length} pagine, nessuna email personale chiara.`,
        raw_output: "",
      };
    }
    return {
      agent: "web",
      found: true,
      failed: false,
      email: best.email,
      source_url: best.url,
      source_type: "web_scan",
      reason: `Ricerca web deterministica: email letta sulla pagina ${best.url} (punteggio ${best.score}).`,
      raw_output: "",
    };
  } catch (error) {
    return failedProposal(
      "web",
      error instanceof Error ? error.message : "Errore ricerca web."
    );
  }
};

// ============================================================================
// SINOSSI FILM DETERMINISTICA (Pietro 2026-06-11): lo scrittore inventava i
// dettagli del film -> bocciato dai validatori. Soluzione: PRIMA dello scrittore
// apriamo NOI la pagina del film (festival/sinossi) e prendiamo il testo REALE.
// Lo passiamo a scrittore E validatori: cosi' il complimento si basa su testo
// vero (con fonte), niente invenzioni, e i controllori lo verificano contro la
// stessa pagina -> passa. E' la chiave per avere un complimento specifico ma
// affidabile su "il film visto al festival".
// ============================================================================
const htmlToPlain = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

// ANTI-SPAZZATURA (Pietro 2026-06-11): le pagine dei festival sono spesso in
// JavaScript -> il fetch dell'HTML grezzo prende il MENU di navigazione (Menu,
// Programme, Tickets, Sponsors...) invece della trama del film. Quel "menu"
// contiene il titolo, quindi passava per sinossi valida. Risultato: o lo
// scrittore usava spazzatura, o (se scriveva cose vere prese da fuori) i
// validatori lo bocciavano perche' "non nella sinossi". Qui riconosciamo il
// chrome di navigazione e lo scartiamo: una VERA sinossi e' prosa con frasi,
// non un elenco di voci di menu in maiuscolo.
const NAV_CHROME_WORDS =
  /\b(menu|programme|program|tickets?|sponsors?|accreditation|homepage|archive|newsletter|podcast|guests|press|sections?|subtitles|screenings|montagnalibri|edizione|edition|partners?|patrons?|staff|conditions of admission|film guide|accessibility|cookie|privacy|login|logout|sign in|registrati|accedi|streaming|trailer|recensioni|playlist|profilo|messaggi|community|articoli|al cinema|stasera in tv|in tv|cataloghi|espandi|vedi cast|cast completo|serie tv)\b/gi;
export const looksLikeNavChrome = (text: string): boolean => {
  const t = (text || "").trim();
  if (t.length < 60) return true;
  const navHits = (t.match(NAV_CHROME_WORDS) || []).length;
  const words = t.split(/\s+/).filter(Boolean).length;
  const navRatio = navHits / Math.max(1, words);
  // Una VERA trama ha pochissime "parole-menu" (forse 0-2). Il menu di un sito
  // ne ha a decine. Segnale primario = DENSITA' di parole-menu, robusto e
  // indipendente dal conteggio frasi (inaffidabile sui frammenti tipo date).
  if (navHits >= 6) return true; // es. il menu festival JS: navHits ~38
  if (navRatio > 0.05) return true; // >5% di parole-menu = chrome di navigazione
  return false;
};

const filmUrlScore = (url: string, film: string) => {
  const u = url.toLowerCase();
  let s = 0;
  if (
    /festival|programma|program|cinema|trentofestival|mymovies|cinematografo|comingsoon|imdb|cineuropa|filmtv|sentieriselvaggi/.test(
      u
    )
  )
    s += 2;
  const slug = film.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 18);
  if (slug.length >= 6 && u.includes(slug)) s += 3;
  if (/facebook|instagram|twitter|x\.com|pinterest|tiktok/.test(u)) s -= 3;
  return s;
};

export const fetchFilmContext = async (
  film: string | null,
  festival: string | null,
  name: string | null
): Promise<{ text: string; url: string } | null> => {
  const f = (film ?? "").trim();
  if (!f || f.length < 3) return null;
  try {
    const queries = [
      `"${f}" ${(festival ?? "").trim()}`.trim(),
      `"${f}" sinossi`,
      `"${f}" ${(name ?? "").trim()} regista`.trim(),
    ];
    const lists = await Promise.all(queries.map((q) => ddgResultUrls(q)));
    let urls = [...new Set(lists.flat())];
    urls.sort((a, b) => filmUrlScore(b, f) - filmUrlScore(a, f));
    urls = urls.slice(0, 5);
    let best: { text: string; url: string; score: number } | null = null;
    for (const url of urls) {
      const html = await fetchPageText(url);
      if (!html) continue;
      const text = htmlToPlain(html);
      const idx = text.toLowerCase().indexOf(f.toLowerCase());
      if (idx < 0) continue;
      const chunk = text.slice(Math.max(0, idx - 150), idx + 1100).trim();
      if (chunk.length < 180) continue;
      // scarta il menu/chrome di navigazione (pagine JS): non e' una trama
      if (looksLikeNavChrome(chunk)) continue;
      const score = filmUrlScore(url, f);
      if (!best || score > best.score) best = { text: chunk, url, score };
      if (score >= 4) break;
    }
    return best ? { text: best.text, url: best.url } : null;
  } catch {
    return null;
  }
};

// ============================================================================
// FALLBACK SINOSSI via CLI `claude` (Pietro 2026-06-11)
// ----------------------------------------------------------------------------
// fetchFilmContext usa lo scraping di DuckDuckGo, che sotto carico viene
// bloccato (HTTP 202, 0 risultati) -> "sinossi NON trovata" -> scrittore e
// validatore cercano ognuno per conto suo, non condividono la fonte, e codex
// scarta complimenti VERI perche' non li ri-trova. Questo fallback usa il web
// VERO del CLI claude (lo stesso meccanismo dell'enrichment email): cerca la
// sinossi del film, la legge da una pagina reale e ne restituisce testo + URL.
// Modello economico (sonnet) per non consumare Opus. Grounding leggero: se la
// pagina e' fetchabile e NON contiene NESSUNA parola della sinossi -> scartata
// (probabile allucinazione). Se la pagina e' JS e non leggibile, si fida della
// lettura fatta da claude (ha aperto lui la pagina). Tutto opzionale e graceful:
// se fallisce, lo scrittore ripiega sul tema del titolo. Nessuna invenzione.
// ============================================================================
export const fetchFilmSynopsisViaClaude = async (
  film: string | null,
  festival: string | null,
  name: string | null,
  cwd: string
): Promise<{ text: string; url: string } | null> => {
  const f = (film ?? "").trim();
  if (!f || f.length < 3) return null;
  const fest = (festival ?? "").trim();
  const dir = (name ?? "").trim();
  const prompt = `Sei un ricercatore. Devi trovare la SINOSSI REALE di un film usando il web (USA gli strumenti WebSearch e WebFetch: apri DAVVERO le pagine, non andare a memoria).

FILM: "${f}"${fest ? `\nFESTIVAL: ${fest}` : ""}${dir ? `\nREGISTA: ${dir}` : ""}

Cerca la scheda ufficiale del festival, la pagina del film, una recensione o un articolo che descriva di cosa parla QUESTO film (lo stesso regista, lo stesso festival se indicato). APRI la pagina e LEGGI la descrizione/sinossi.

Restituisci SOLO questo JSON (niente altro testo, niente markdown):
{
  "found": <true solo se hai APERTO una pagina reale che descrive QUESTO film>,
  "synopsis": "<la descrizione REALE di cosa parla il film, 2-5 frasi, copiata/riassunta da quello che hai letto sulla pagina. NON inventare nulla. Se non sei sicuro che sia lo stesso film, found=false>",
  "url": "<l'URL ESATTO della pagina da cui hai preso la sinossi>"
}

REGOLE FERREE: niente invenzioni. Se non trovi una pagina reale su QUESTO film, o non sei sicuro che sia lo stesso (omonimi), metti found=false e synopsis vuota. Meglio "found=false" che una sinossi sbagliata.`;

  const model =
    process.env.CLAUDE_SYNOPSIS_MODEL?.trim() || "claude-sonnet-4-6";
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
    "--model",
    model,
  ];

  const TIMEOUT_MS = 120_000;
  try {
    const run = runCommand({ command: "claude", args, cwd, stdin: prompt });
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), TIMEOUT_MS)
    );
    const result = await Promise.race([run, timeout]);
    if (!result || result.code !== 0) return null;
    const parsed = extractJsonObject(result.stdout || result.stderr || "");
    if (!parsed || parsed.found !== true) return null;
    const synopsis =
      typeof parsed.synopsis === "string" ? parsed.synopsis.trim() : "";
    const url = typeof parsed.url === "string" ? parsed.url.trim() : "";
    if (synopsis.length < 80 || !/^https?:\/\//i.test(url)) return null;
    // anche claude a volte restituisce il chrome del sito: scartalo
    if (looksLikeNavChrome(synopsis)) return null;

    // Grounding leggero anti-allucinazione: se riusciamo a leggere la pagina e
    // NON contiene nessuna parola lunga della sinossi -> scartiamo (probabile
    // invenzione o pagina sbagliata). Se la pagina non e' leggibile (JS), ci
    // fidiamo della lettura di claude (ha aperto lui la pagina).
    const pageHtml = await fetchPageText(url).catch(() => null);
    if (pageHtml && pageHtml.length > 200) {
      const pageText = htmlToPlain(pageHtml).toLowerCase();
      const words = [
        ...new Set(
          synopsis
            .toLowerCase()
            .replace(/[^a-zàèéìòù\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length >= 6)
        ),
      ];
      const overlap = words.filter((w) => pageText.includes(w)).length;
      // pagina leggibile ma zero parole in comune = quasi certo sbagliata
      if (words.length >= 4 && overlap === 0) return null;
    }

    return { text: synopsis.slice(0, 1100), url };
  } catch {
    return null;
  }
};

// Verifica anti-allucinazione: apre la pagina-fonte e controlla che l'email ci
// sia DAVVERO. Cosi' un'email trovata da UN SOLO agente ma PUBBLICATA su una
// pagina pubblica vera vale come certa (non ci si fida della parola dell'AI:
// si guarda la pagina). Niente fetch JS: legge l'HTML grezzo, conservativo.
const verifyEmailOnPage = async (
  email: string | null,
  url: string | null
): Promise<boolean> => {
  if (!email || !url || !/^https?:\/\//i.test(url)) return false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CRMbot/1.0)" },
      redirect: "follow",
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return false;
    const text = (await res.text()).toLowerCase();
    return text.includes(email.toLowerCase());
  } catch {
    return false;
  }
};

const consensusFromProposals = async (
  proposals: AgentEmailProposal[]
): Promise<EnrichmentResult> => {
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

  // Un solo agente ha trovato un'email (o gli agenti sono in disaccordo). PRIMA
  // di declassarla: se ha una FONTE (URL), apriamo la pagina e verifichiamo che
  // l'email ci sia DAVVERO. Se c'è → è CERTA (pubblicata su pagina pubblica),
  // anche con un solo agente: cosi' non si perdono email vere viste da un agente
  // solo (es. sul sito di una film commission). Se non si verifica → needs_review.
  const verified = await verifyEmailOnPage(sample.email, sample.source_url);
  if (verified) {
    return {
      email: sample.email,
      source_url: sample.source_url,
      source_type: sample.source_type ?? "single_agent_verified",
      confidence: 0.85,
      status: "found_public",
      reason: `Trovata da 1 agente MA verificata aprendo la pagina (${sample.source_url}). ${debug}`,
      found_at: now,
    };
  }
  return {
    email: sample.email,
    source_url: sample.source_url,
    source_type: sample.source_type ?? "single_agent",
    confidence: 0.4,
    status: "needs_review",
    reason: `1 agente, nessun consenso e NON verificata sulla pagina. ${debug}`,
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
      searchByWeb(input, workingDirectory),
    ]);
    return await consensusFromProposals(proposals);
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
