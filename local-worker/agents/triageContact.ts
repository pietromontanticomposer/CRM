import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./shared";

const AGENTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(AGENTS_DIR, "../prompts");

export type TriageInput = {
  name: string;
  company?: string | null;
  section?: string | null;
  notes?: string | null;
  source_file?: string | null;
  pdf_context?: string | null;
};

export type TriageResult = {
  is_real_person: boolean;
  cleaned_name: string;
  confidence: number;
  reason: string;
  raw_output: string;
};

export type TriageError = {
  error: string;
  raw_output: string;
};

// Il triage e' un cancello veloce: gira PRIMA di enrichment + writer + 3
// validatori (9 CLI calls). Deve restare leggero, quindi niente web tools e
// timeout breve. In caso di errore/timeout il chiamante fa fail-open (lascia
// proseguire il contatto): meglio sprecare qualche CLI call che perdere un
// regista reale per un singhiozzo della CLI.
// 120s assorbe il cold-start della CLI claude alla prima invocazione del ciclo
// (misurato >60s a freddo, ~5-15s a caldo), restando comunque sotto ai 300s
// dei validatori.
const TRIAGE_TIMEOUT_MS = 120_000;

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

export const parseTriageOutput = (
  rawOutput: string
): TriageResult | TriageError => {
  const candidate = extractJsonCandidate(rawOutput);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return { error: "Triage non ha restituito JSON valido.", raw_output: rawOutput };
  }
  if (!isRecord(parsed)) {
    return { error: "Triage JSON non è un oggetto.", raw_output: rawOutput };
  }
  if (typeof parsed.is_real_person !== "boolean") {
    return {
      error: "Triage JSON senza campo booleano is_real_person.",
      raw_output: rawOutput,
    };
  }
  const cleanedName =
    typeof parsed.cleaned_name === "string" ? parsed.cleaned_name.trim() : "";
  const confidence =
    typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5;
  const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
  return {
    is_real_person: parsed.is_real_person,
    cleaned_name: cleanedName,
    confidence,
    reason,
    raw_output: rawOutput,
  };
};

const buildTriagePrompt = async (input: TriageInput) => {
  const template = await readFile(
    path.resolve(PROMPTS_DIR, "triage_extract_contact.md"),
    "utf8"
  );
  return `${template.trim()}\n\nCandidato da valutare JSON:\n${JSON.stringify(
    input,
    null,
    2
  )}\n`;
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

// Triage via Claude CLI locale (claude -p). Nessuna API a consumo, nessun web
// tool: pura classificazione sui dati gia' forniti. Disattivabile con
// TRIAGE_DISABLE=1 (in quel caso tutti i contatti passano senza filtro).
export const runContactTriage = async (
  input: TriageInput,
  cwd: string
): Promise<TriageResult | TriageError> => {
  if (process.env.TRIAGE_DISABLE === "1") {
    return {
      is_real_person: true,
      cleaned_name: input.name.trim(),
      confidence: 0,
      reason: "Triage disattivato via env (TRIAGE_DISABLE=1).",
      raw_output: "",
    };
  }

  const prompt = await buildTriagePrompt(input);
  const args = ["-p", prompt, "--output-format", "text", "--no-session-persistence"];
  const model =
    process.env.TRIAGE_MODEL?.trim() || process.env.CLAUDE_MODEL?.trim();
  if (model) {
    args.push("--model", model);
  }

  return withTimeout(
    (async (): Promise<TriageResult | TriageError> => {
      try {
        const result = await runCommand({ command: "claude", args, cwd });
        const rawOutput = result.stdout.trim() || result.stderr.trim();
        if (result.code !== 0) {
          return {
            error: `Claude CLI (triage) exited ${result.code ?? "unknown"}.`,
            raw_output: rawOutput,
          };
        }
        return parseTriageOutput(rawOutput);
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Errore Claude triage.",
          raw_output: "",
        };
      }
    })(),
    TRIAGE_TIMEOUT_MS,
    () => ({
      error: `Timeout Claude triage (${TRIAGE_TIMEOUT_MS}ms).`,
      raw_output: "",
    })
  );
};
