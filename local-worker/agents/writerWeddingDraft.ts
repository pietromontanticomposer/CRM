import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupTempDirectory,
  createSchemaTempFile,
  runCommand,
} from "./shared";
import {
  lintAndFixMailBody,
  type WriterInput,
  type WriterDraftResult,
  type WriterDraftError,
} from "./writerDraft";

const AGENTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(AGENTS_DIR, "../prompts");

// Stesso budget temporale dello scrittore cinema: lo scrittore apre il sito/IG
// del planner e verifica il complimento, quindi serve tempo (web search).
const CODEX_TIMEOUT_MS = 420_000;

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

const toRiskScore = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.min(1, Math.max(0, parsed));
  }
  // Senza un punteggio chiaro: rischio medio-alto (la rivede Pietro).
  return 0.5;
};

type ComplimentClaim = { detail: string; source_quote: string };
const normalizeClaims = (value: unknown): ComplimentClaim[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((e) => {
      if (!e || typeof e !== "object") return null;
      const rec = e as Record<string, unknown>;
      const detail = typeof rec.detail === "string" ? rec.detail.trim() : "";
      const sq =
        typeof rec.source_quote === "string" ? rec.source_quote.trim() : "";
      return detail && sq ? { detail, source_quote: sq } : null;
    })
    .filter((x): x is ComplimentClaim => x !== null)
    .slice(0, 12);
};

const normalizeSources = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0)
    .slice(0, 20);
};

const buildWeddingPrompt = async (input: WriterInput) => {
  const template = await readFile(
    path.resolve(PROMPTS_DIR, "writer_wedding_email.md"),
    "utf8"
  );
  return `${template.trim()}\n\nDati wedding planner JSON:\n${JSON.stringify(
    input,
    null,
    2
  )}\n`;
};

// Il body wedding NON ha i campi-film (link visione, template, riferimenti
// musicali). Mappiamo l'output su WriterDraftResult con valori neutri, cosi'
// persistDraft e il packet dei validatori restano identici a quelli cinema.
const parseWeddingDraft = (
  rawOutput: string
): WriterDraftResult | WriterDraftError => {
  const candidate = extractJsonCandidate(rawOutput);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return { error: "Writer wedding non ha restituito JSON valido.", raw_output: rawOutput };
  }
  if (!isRecord(parsed)) {
    return { error: "Writer wedding JSON non è un oggetto.", raw_output: rawOutput };
  }
  const subject = typeof parsed.subject === "string" ? parsed.subject.trim() : "";
  const body = typeof parsed.body === "string" ? parsed.body : "";
  const cleanedBody = lintAndFixMailBody(body);
  if (!subject || !cleanedBody) {
    return {
      error: "Writer wedding: subject o body vuoti.",
      raw_output: rawOutput,
    };
  }
  return {
    subject,
    body: cleanedBody,
    link_visione: "non disponibile",
    sources: normalizeSources(parsed.sources),
    compliment_claims: normalizeClaims(parsed.compliment_claims),
    music_ref_ids: [],
    director_tier: "sconosciuto",
    director_tier_reason: "",
    director_photo_url: "",
    template_used: "B",
    risk_score: toRiskScore(parsed.risk_score),
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
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

// Scrittore = codex (come per il cinema: voce coerente, web search per
// verificare il complimento). Stesso vincolo HARD: solo CLI locali, niente API.
export const runWeddingWriterDraft = async (
  input: WriterInput,
  workingDirectory: string
): Promise<WriterDraftResult | WriterDraftError> => {
  if (process.env.WRITER_DISABLE_CODEX === "1") {
    return { error: "Codex disattivato via env.", raw_output: "" };
  }
  const prompt = await buildWeddingPrompt(input);
  let tempDirectory: string | null = null;
  return withTimeout(
    (async (): Promise<WriterDraftResult | WriterDraftError> => {
      try {
        const tempFiles = await createSchemaTempFile();
        tempDirectory = tempFiles.directory;
        const outputFile = path.join(tempFiles.directory, "last-message.json");
        const args = [
          "exec",
          "--skip-git-repo-check",
          "--sandbox",
          // win32: la sandbox workspace-write spesso blocca la rete -> danger-full-access.
          process.platform === "win32" ? "danger-full-access" : "workspace-write",
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
          cwd: workingDirectory,
          stdin: prompt,
        });
        const fileOutput = await readFile(outputFile, "utf8").catch(() => "");
        const rawOutput =
          fileOutput.trim() || result.stdout.trim() || result.stderr.trim();
        if (result.code !== 0) {
          return {
            error: `Codex CLI exited ${result.code ?? "unknown"}.`,
            raw_output: rawOutput,
          };
        }
        return parseWeddingDraft(rawOutput);
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Errore Codex wedding.",
          raw_output: "",
        };
      } finally {
        if (tempDirectory) await cleanupTempDirectory(tempDirectory);
      }
    })(),
    CODEX_TIMEOUT_MS,
    () => ({ error: `Timeout Codex wedding (${CODEX_TIMEOUT_MS}ms).`, raw_output: "" })
  );
};
