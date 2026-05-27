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
    issues: {
      type: "array",
      items: {
        anyOf: [
          { type: "string" },
          {
            type: "object",
            additionalProperties: true,
          },
        ],
      },
    },
    suggested_status: { type: "string" },
  },
} as const;

const AGENTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(AGENTS_DIR, "../prompts");

export const VALIDATOR_PROMPT_FILENAME = "validator_full_check.md";

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
}) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: process.env,
        stdio: "pipe",
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
        reject(error);
      });

      child.on("close", (code) => {
        resolve({ code, stdout, stderr });
      });

      if (stdin) {
        child.stdin.write(stdin);
      }
      child.stdin.end();
    }
  );

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
