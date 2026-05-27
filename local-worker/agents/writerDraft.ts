import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./shared";

const AGENTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(AGENTS_DIR, "../prompts");

export type WriterInput = {
  name: string;
  email: string | null;
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
};

export type WriterTemplate = "A" | "B" | "C" | "C_TEAM" | "NOT_READY";

export type WriterDraftResult = {
  subject: string;
  body: string;
  link_visione: string;
  template_used: WriterTemplate;
  risk_score: number;
  reason: string;
  raw_output: string;
};

export type WriterDraftError = {
  error: string;
  raw_output: string;
};

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

export const runWriterDraft = async (
  input: WriterInput,
  workingDirectory: string
): Promise<WriterDraftResult | WriterDraftError> => {
  let rawOutput = "";
  try {
    const prompt = await buildWriterPrompt(input);
    const args = [
      "-p",
      prompt,
      "--tools",
      "",
      "--permission-mode",
      "plan",
      "--output-format",
      "text",
      "--no-session-persistence",
    ];

    if (process.env.CLAUDE_MODEL?.trim()) {
      args.push("--model", process.env.CLAUDE_MODEL.trim());
    }

    const result = await runCommand({
      command: "claude",
      args,
      cwd: workingDirectory,
    });
    rawOutput = result.stdout.trim() || result.stderr.trim();

    if (result.code !== 0) {
      return {
        error: `Claude CLI exited with code ${result.code ?? "unknown"}.`,
        raw_output: rawOutput,
      };
    }

    const candidate = extractJsonCandidate(rawOutput);
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      return {
        error: "Writer non ha restituito JSON valido.",
        raw_output: rawOutput,
      };
    }

    if (!isRecord(parsed)) {
      return {
        error: "Writer JSON non è un oggetto.",
        raw_output: rawOutput,
      };
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
      return {
        error: "Writer JSON con shape non valida.",
        raw_output: rawOutput,
      };
    }

    if (!subject.trim() || !body.trim()) {
      return {
        error: "Writer ha dichiarato dati insufficienti per generare la bozza.",
        raw_output: rawOutput,
      };
    }

    return {
      subject: subject.trim(),
      body: body.trim(),
      link_visione: link_visione.trim() || "non disponibile",
      template_used,
      risk_score: riskNumeric,
      reason: typeof reason === "string" ? reason : "",
      raw_output: rawOutput,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Errore inatteso nel Writer.",
      raw_output: rawOutput,
    };
  }
};
