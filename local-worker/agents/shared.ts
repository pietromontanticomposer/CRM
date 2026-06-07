import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AiAgentCheck, AiAgentName } from "../../src/lib/aiOutreach";

export type ValidationPacket = {
  contact_data: Record<string, unknown>;
  normalized_contact_data: Record<string, unknown>;
  verified_facts_json: unknown;
  draft_subject: string;
  draft_body: string;
  draft_link_visione: string;
  draft_template_used: string;
  draft_risk_score: number | null;
  source_link: string | null;
  notes: string | null;
  prompt_master_rules: string | null;
  allowed_links: string[];
  forbidden_words: string[];
  template_rules: Record<string, string>;
  email_source_url: string | null;
  email_source_type: string | null;
  email_confidence: number | null;
  email_enrichment_status: string | null;
  email_enrichment_reason: string | null;
};

export type AgentRunResult = AiAgentCheck & {
  agent_name: AiAgentName;
  raw_output: string;
};

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "approved",
    "risk_level",
    "contact_ok",
    "email_ok",
    "draft_ok",
    "send_allowed",
    "issues",
    "suggested_status",
  ],
  properties: {
    approved: { type: "boolean" },
    risk_level: { type: "string" },
    contact_ok: { type: "boolean" },
    email_ok: { type: "boolean" },
    draft_ok: { type: "boolean" },
    send_allowed: { type: "boolean" },
    // NB: array di SOLE stringhe. Serve per essere strict-compatibile con
    // `codex --output-schema` (OpenAI structured output: niente
    // additionalProperties:true, niente anyOf con oggetti liberi). Il prompt
    // chiede comunque issue come stringhe brevi, e normalizeIssues le gestisce.
    issues: {
      type: "array",
      items: { type: "string" },
    },
    suggested_status: { type: "string" },
  },
} as const;

const AGENTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(AGENTS_DIR, "../prompts");

export const VALIDATOR_PROMPT_FILENAME = "validator_full_check.md";

// Tutti e 3 gli agenti devono fare ESATTAMENTE gli stessi controlli sullo
// stesso prompt unico. Nessuna specializzazione: massima ridondanza.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const buildValidationPrompt = async (
  promptFileName: string,
  packet: ValidationPacket
) => {
  const template = await readFile(
    path.resolve(PROMPTS_DIR, promptFileName),
    "utf8"
  );

  return `${template.trim()}\n\nValidation packet JSON:\n${JSON.stringify(
    packet,
    null,
    2
  )}\n`;
};

export const createSchemaTempFile = async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "ai-outreach-schema-")
  );
  const file = path.join(directory, "result-schema.json");
  await writeFile(file, JSON.stringify(RESULT_SCHEMA), "utf8");
  return { directory, file };
};

export const cleanupTempDirectory = async (directory: string) => {
  await rm(directory, { recursive: true, force: true });
};

export const getInlineSchema = () => JSON.stringify(RESULT_SCHEMA);

// LIMITE FLESSIBILE AUTO-ADATTIVO (Pietro 2026-06-07): la rete si regola DA SOLA
// (controllo AIMD, come il congestion control di TCP). Tutte le chiamate alle AI
// passano da qui. Parte da CLI_START chiamate in parallelo; dopo RAMP_OK successi
// consecutivi alza il tetto di 1 (la rete regge -> piu' veloce); a ogni segnale
// di intasamento (timeout o "fetch failed", via noteCliCongestion) DIMEZZA il
// tetto. Range [CLI_MIN, CLI_MAX]. Niente piu' numero fisso: su rete lenta scende,
// su rete buona sale, senza intasare mai. Override START/MAX via env.
const CLI_MIN = 1;
const CLI_MAX = Math.max(2, Number(process.env.MAX_CONCURRENT_CLI) || 6);
const CLI_START = Math.min(
  CLI_MAX,
  Math.max(CLI_MIN, Number(process.env.START_CONCURRENT_CLI) || 3)
);
const RAMP_OK = 4;
let cliCap = CLI_START;
let activeCli = 0;
let consecutiveOk = 0;
const cliWaiters: Array<() => void> = [];

const pumpCli = () => {
  while (activeCli < cliCap && cliWaiters.length > 0) {
    const next = cliWaiters.shift();
    if (!next) break;
    activeCli += 1;
    next();
  }
};
const acquireCli = (): Promise<void> =>
  new Promise((resolve) => {
    cliWaiters.push(resolve);
    pumpCli();
  });
const releaseCli = () => {
  activeCli = Math.max(0, activeCli - 1);
  pumpCli();
};

// La rete ha retto: dopo un po' di successi alza il tetto di 1 (fino a CLI_MAX).
export const noteCliSuccess = () => {
  consecutiveOk += 1;
  if (consecutiveOk >= RAMP_OK && cliCap < CLI_MAX) {
    cliCap += 1;
    consecutiveOk = 0;
  }
};
// La rete si sta intasando (timeout / fetch failed): dimezza il tetto e riparte.
export const noteCliCongestion = () => {
  consecutiveOk = 0;
  const next = Math.max(CLI_MIN, Math.floor(cliCap / 2));
  if (next < cliCap) cliCap = next;
};
export const getCliCap = () => cliCap;

export const runCommand = async ({
  command,
  args,
  cwd,
  stdin,
}: {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
}): Promise<{ code: number | null; stdout: string; stderr: string }> => {
  await acquireCli();
  try {
    return await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: process.env,
        stdio: "pipe",
        // Su Windows i CLI (claude/gemini/codex) sono file .cmd: senza shell
        // spawn non li avvia (ENOENT) e ogni ricerca email fallisce. La shell
        // serve SOLO su Windows; su Mac/Linux il comportamento resta identico.
        shell: process.platform === "win32",
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        noteCliCongestion(); // spawn fallito (es. risorse esaurite): frena
        reject(error);
      });

      child.on("close", (code) => {
        if (code === 0) noteCliSuccess(); // andata bene: la rete puo' salire
        resolve({ code, stdout, stderr });
      });

      if (stdin) {
        child.stdin.write(stdin);
      }
      child.stdin.end();
    });
  } finally {
    releaseCli();
  }
};

const normalizeIssues = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value.map((issue) => {
    if (typeof issue === "string") {
      return { message: issue };
    }
    if (isRecord(issue)) {
      return issue;
    }
    return { message: JSON.stringify(issue) };
  });
};

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

export const buildFailedResult = (
  agentName: AiAgentName,
  message: string,
  rawOutput = ""
): AgentRunResult => ({
  agent_name: agentName,
  approved: false,
  risk_level: "high",
  contact_ok: false,
  email_ok: false,
  draft_ok: false,
  send_allowed: false,
  failed: true,
  issues: [{ message }],
  suggested_status: "failed",
  raw_output: rawOutput,
});

export const parseAgentOutput = (
  agentName: AiAgentName,
  rawOutput: string
): AgentRunResult => {
  const candidate = extractJsonCandidate(rawOutput);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return buildFailedResult(
      agentName,
      "Output non JSON valido restituito dalla CLI.",
      rawOutput
    );
  }

  const requiredBools = [
    "approved",
    "contact_ok",
    "email_ok",
    "draft_ok",
    "send_allowed",
  ] as const;

  for (const key of requiredBools) {
    if (typeof parsed[key] !== "boolean") {
      return buildFailedResult(
        agentName,
        `Campo bool obbligatorio mancante o non valido: ${key}.`,
        rawOutput
      );
    }
  }

  if (
    typeof parsed.risk_level !== "string" ||
    typeof parsed.suggested_status !== "string"
  ) {
    return buildFailedResult(
      agentName,
      "Output JSON con risk_level o suggested_status non valido.",
      rawOutput
    );
  }

  const contactOk = parsed.contact_ok as boolean;
  const emailOk = parsed.email_ok as boolean;
  const draftOk = parsed.draft_ok as boolean;
  // send_allowed: l'agente lo dichiara, ma forziamo a false se email_ok=false.
  const sendAllowedRaw = parsed.send_allowed as boolean;
  const sendAllowed = sendAllowedRaw && emailOk;
  const declaredApproved = parsed.approved as boolean;
  // approved: vale solo se TUTTI e 4 i flag sono true e l'agente stesso ha dichiarato approved.
  const approved =
    declaredApproved && contactOk && emailOk && draftOk && sendAllowed;

  return {
    agent_name: agentName,
    approved,
    risk_level: parsed.risk_level,
    contact_ok: contactOk,
    email_ok: emailOk,
    draft_ok: draftOk,
    send_allowed: sendAllowed,
    failed: false,
    issues: normalizeIssues(parsed.issues),
    suggested_status: parsed.suggested_status,
    raw_output: rawOutput,
  };
};
