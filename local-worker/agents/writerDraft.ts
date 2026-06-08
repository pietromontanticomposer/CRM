import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupTempDirectory,
  createSchemaTempFile,
  runCommand,
} from "./shared";

const AGENTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(AGENTS_DIR, "../prompts");

export type WriterInput = {
  name: string;
  email: string | null;
  company?: string | null;
  source_link: string | null;
  notes: string | null;
  language: string | null;
  role?: string | null;
  section?: string | null;
  verified_facts_json?: unknown;
  normalized_contact_data?: Record<string, unknown> | null;
  email_source_url?: string | null;
  email_confidence?: number | null;
  email_enrichment_status?: string | null;
  // Istruzioni di personalizzazione di Pietro per questo import (es. frase Trento
  // Film Festival). Hanno priorita' sul template base.
  prompt_master_rules?: string | null;
};

export type WriterTemplate = "A" | "B" | "C" | "C_TEAM" | "NOT_READY";

export const DIRECTOR_TIERS = [
  "sconosciuto",
  "emergente",
  "affermato",
  "star",
] as const;
export type DirectorTier = (typeof DIRECTOR_TIERS)[number];

export type WriterDraftResult = {
  subject: string;
  body: string;
  link_visione: string;
  // Fonti pubbliche aperte per verificare lavoro/complimento. SOLO per la
  // revisione di Pietro: non entrano MAI nella mail inviata.
  sources: string[];
  // Profilo regista (stima dal materiale trovato): livello + motivo + foto.
  director_tier: DirectorTier;
  director_tier_reason: string;
  director_photo_url: string;
  template_used: WriterTemplate;
  risk_score: number;
  reason: string;
  raw_output: string;
};

export type WriterDraftError = {
  error: string;
  raw_output: string;
};

type AgentDraftAttempt = {
  agent: "claude" | "gemini" | "codex";
  outcome: WriterDraftResult | WriterDraftError;
};

// Codex (writer attivo) richiede piu' tempo: usa reasoning xhigh per default
// e fa web search per verificare claim. 240s e' la finestra realistica.
const CLAUDE_TIMEOUT_MS = 120_000;
const GEMINI_TIMEOUT_MS = 90_000;
// Pietro 2026-06-05: "preferisco piu' lento ma piu' preciso". Lo scrittore deve
// avere tempo di scavare per un dettaglio specifico DOCUMENTATO (sinossi, scheda
// festival, recensioni, interviste). 5 min: la precisione conta piu' della velocita'.
const CODEX_TIMEOUT_MS = 300_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stripCodeFences = (raw: string) =>
  raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

const extractJsonCandidate = (raw: string) => {
  const cleaned = stripCodeFences(raw);
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
};

const isTemplate = (value: unknown): value is WriterTemplate =>
  value === "A" ||
  value === "B" ||
  value === "C" ||
  value === "C_TEAM" ||
  value === "NOT_READY";

const toRiskScore = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.min(1, Math.max(0, parsed));
    }
  }
  return null;
};

const buildWriterPrompt = async (input: WriterInput) => {
  const template = await readFile(
    path.resolve(PROMPTS_DIR, "writer_cold_email.md"),
    "utf8"
  );
  return `${template.trim()}\n\nDati regista JSON:\n${JSON.stringify(
    input,
    null,
    2
  )}\n`;
};

const normalizeTier = (value: unknown): DirectorTier => {
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if ((DIRECTOR_TIERS as readonly string[]).includes(v)) {
      return v as DirectorTier;
    }
  }
  return "sconosciuto";
};

// Foto: accetta SOLO un URL http(s) plausibile. Mai costruirla qui; se lo
// scrittore non ha trovato nulla di affidabile resta "" (si usano le iniziali).
const normalizePhotoUrl = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const v = value.trim();
  if (!/^https?:\/\/\S+$/i.test(v)) return "";
  if (v.length > 600) return "";
  return v;
};

const normalizeSources = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0)
    .slice(0, 20);
};

// Rete di sicurezza: anche se lo scrittore disobbedisce e mette una riga
// "Link visione: ..." nel corpo, la togliamo qui. Il corpo che parte deve
// essere SOLO la mail (Pietro 2026-06-05).
const stripInternalLinesFromBody = (raw: string): string =>
  raw
    .split(/\r?\n/)
    .filter((line) => !/^\s*link\s*visione\s*:/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const parseDraftOutput = (
  rawOutput: string
): WriterDraftResult | WriterDraftError => {
  const candidate = extractJsonCandidate(rawOutput);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return { error: "Writer non ha restituito JSON valido.", raw_output: rawOutput };
  }
  if (!isRecord(parsed)) {
    return { error: "Writer JSON non è un oggetto.", raw_output: rawOutput };
  }
  const { subject, body, link_visione, template_used, risk_score, reason } =
    parsed;
  const riskNumeric = toRiskScore(risk_score);
  if (
    typeof subject !== "string" ||
    typeof body !== "string" ||
    typeof link_visione !== "string" ||
    !isTemplate(template_used) ||
    riskNumeric === null
  ) {
    return { error: "Writer JSON con shape non valida.", raw_output: rawOutput };
  }
  const cleanedBody = stripInternalLinesFromBody(body);
  if (!subject.trim() || !cleanedBody) {
    return {
      error: "Writer ha dichiarato dati insufficienti per generare la bozza.",
      raw_output: rawOutput,
    };
  }
  return {
    subject: subject.trim(),
    body: cleanedBody,
    link_visione: link_visione.trim() || "non disponibile",
    sources: normalizeSources(parsed.sources),
    director_tier: normalizeTier(parsed.director_tier),
    director_tier_reason:
      typeof parsed.director_tier_reason === "string"
        ? parsed.director_tier_reason.trim()
        : "",
    director_photo_url: normalizePhotoUrl(parsed.director_photo_url),
    template_used,
    risk_score: riskNumeric,
    reason: typeof reason === "string" ? reason : "",
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

const runViaClaude = async (
  input: WriterInput,
  cwd: string
): Promise<AgentDraftAttempt> => {
  if (process.env.WRITER_DISABLE_CLAUDE === "1") {
    return {
      agent: "claude",
      outcome: { error: "Claude disattivato via env.", raw_output: "" },
    };
  }
  const prompt = await buildWriterPrompt(input);
  // Web tools attivi: il Writer puo' verificare online i lavori del regista
  // prima di citarli, riducendo il rischio di claim inventati.
  const args = [
    "-p",
    prompt,
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
    (async (): Promise<AgentDraftAttempt> => {
      try {
        const result = await runCommand({ command: "claude", args, cwd });
        const rawOutput = result.stdout.trim() || result.stderr.trim();
        if (result.code !== 0) {
          return {
            agent: "claude",
            outcome: {
              error: `Claude CLI exited ${result.code ?? "unknown"}.`,
              raw_output: rawOutput,
            },
          };
        }
        return { agent: "claude", outcome: parseDraftOutput(rawOutput) };
      } catch (error) {
        return {
          agent: "claude",
          outcome: {
            error: error instanceof Error ? error.message : "Errore Claude.",
            raw_output: "",
          },
        };
      }
    })(),
    CLAUDE_TIMEOUT_MS,
    () => ({
      agent: "claude",
      outcome: {
        error: `Timeout Claude (${CLAUDE_TIMEOUT_MS}ms).`,
        raw_output: "",
      },
    })
  );
};

const runViaGemini = async (
  input: WriterInput,
  cwd: string
): Promise<AgentDraftAttempt> => {
  if (process.env.WRITER_DISABLE_GEMINI === "1") {
    return {
      agent: "gemini",
      outcome: { error: "Gemini disattivato via env.", raw_output: "" },
    };
  }
  const prompt = await buildWriterPrompt(input);
  const args = ["-p", prompt, "-o", "text"];
  if (process.env.GEMINI_MODEL?.trim()) {
    args.push("-m", process.env.GEMINI_MODEL.trim());
  }
  return withTimeout(
    (async (): Promise<AgentDraftAttempt> => {
      try {
        const result = await runCommand({ command: "gemini", args, cwd });
        const rawOutput = result.stdout.trim() || result.stderr.trim();
        if (result.code !== 0) {
          return {
            agent: "gemini",
            outcome: {
              error: `Gemini CLI exited ${result.code ?? "unknown"}.`,
              raw_output: rawOutput,
            },
          };
        }
        return { agent: "gemini", outcome: parseDraftOutput(rawOutput) };
      } catch (error) {
        return {
          agent: "gemini",
          outcome: {
            error: error instanceof Error ? error.message : "Errore Gemini.",
            raw_output: "",
          },
        };
      }
    })(),
    GEMINI_TIMEOUT_MS,
    () => ({
      agent: "gemini",
      outcome: {
        error: `Timeout Gemini (${GEMINI_TIMEOUT_MS}ms).`,
        raw_output: "",
      },
    })
  );
};

const runViaCodex = async (
  input: WriterInput,
  cwd: string
): Promise<AgentDraftAttempt> => {
  if (process.env.WRITER_DISABLE_CODEX === "1") {
    return {
      agent: "codex",
      outcome: { error: "Codex disattivato via env.", raw_output: "" },
    };
  }
  const prompt = await buildWriterPrompt(input);
  let tempDirectory: string | null = null;
  return withTimeout(
    (async (): Promise<AgentDraftAttempt> => {
      try {
        const tempFiles = await createSchemaTempFile();
        tempDirectory = tempFiles.directory;
        const outputFile = path.join(tempFiles.directory, "last-message.json");
        // reasoning_effort=medium e' un ottimo compromesso: xhigh (default su
        // gpt-5) e' molto piu' lento e raramente porta gain misurabile per
        // questa task. -c override del config.toml.
        // tools.web_search=true: ABILITA la ricerca web (di default `codex exec`
        // gira SENZA web search). Serve per scavare info specifiche e verificate
        // sui registi non famosi prima di scrivere un complimento concreto.
        const args = [
          "exec",
          "--skip-git-repo-check",
          "--sandbox",
          "workspace-write",
          "-c",
          "model_reasoning_effort=medium",
          "-c",
          "tools.web_search=true",
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
        const rawOutput =
          fileOutput.trim() || result.stdout.trim() || result.stderr.trim();
        if (result.code !== 0) {
          return {
            agent: "codex",
            outcome: {
              error: `Codex CLI exited ${result.code ?? "unknown"}.`,
              raw_output: rawOutput,
            },
          };
        }
        return { agent: "codex", outcome: parseDraftOutput(rawOutput) };
      } catch (error) {
        return {
          agent: "codex",
          outcome: {
            error: error instanceof Error ? error.message : "Errore Codex.",
            raw_output: "",
          },
        };
      } finally {
        if (tempDirectory) await cleanupTempDirectory(tempDirectory);
      }
    })(),
    CODEX_TIMEOUT_MS,
    () => ({
      agent: "codex",
      outcome: {
        error: `Timeout Codex (${CODEX_TIMEOUT_MS}ms).`,
        raw_output: "",
      },
    })
  );
};

const TEMPLATE_CONSERVATIVENESS: Record<WriterTemplate, number> = {
  NOT_READY: 5,
  C_TEAM: 4,
  C: 3,
  B: 2,
  A: 1,
};

const isSuccess = (
  outcome: WriterDraftResult | WriterDraftError
): outcome is WriterDraftResult => !("error" in outcome);

const pickConsensusDraft = (
  attempts: AgentDraftAttempt[]
): WriterDraftResult | WriterDraftError => {
  const successes = attempts.filter((attempt) => isSuccess(attempt.outcome));
  if (successes.length === 0) {
    const reasons = attempts
      .map((attempt) =>
        isSuccess(attempt.outcome)
          ? ""
          : `${attempt.agent}: ${attempt.outcome.error}`
      )
      .filter(Boolean)
      .join(" | ");
    return {
      error: `Tutte e 3 le AI hanno fallito. ${reasons}`,
      raw_output: attempts.map((a) => a.outcome.raw_output).join("\n---\n"),
    };
  }

  // Conservativeness ranking: prefer the draft that picked the most cautious
  // template (NOT_READY > C_TEAM > C > B > A). On ties, prefer the lowest
  // risk_score (less aggressive), then shortest body (less hallucination).
  const ranked = [...successes].sort((a, b) => {
    const sa = a.outcome as WriterDraftResult;
    const sb = b.outcome as WriterDraftResult;
    const ta = TEMPLATE_CONSERVATIVENESS[sa.template_used];
    const tb = TEMPLATE_CONSERVATIVENESS[sb.template_used];
    if (ta !== tb) return tb - ta;
    if (sa.risk_score !== sb.risk_score) return sa.risk_score - sb.risk_score;
    return sa.body.length - sb.body.length;
  });

  const winner = ranked[0].outcome as WriterDraftResult;
  const winnerAgent = ranked[0].agent;
  const summary = successes
    .map((a) => {
      const o = a.outcome as WriterDraftResult;
      return `${a.agent}=${o.template_used}/risk=${o.risk_score.toFixed(2)}`;
    })
    .join(" · ");

  return {
    ...winner,
    reason: `${winner.reason} [consensus winner: ${winnerAgent} · ${summary}]`.trim(),
  };
};

export const runWriterDraft = async (
  input: WriterInput,
  workingDirectory: string
): Promise<WriterDraftResult | WriterDraftError> => {
  // Decisione architetturale (Pietro 2026-05-28): la mail la scrive ChatGPT
  // via Codex CLI. I validatori (Claude + Gemini + Codex) si occupano poi di
  // controllare che ogni claim sul regista sia documentato. Voce coerente +
  // verifica indipendente.
  return runViaCodex(input, workingDirectory).then((attempt) => attempt.outcome);
};
