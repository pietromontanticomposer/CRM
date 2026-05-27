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
  email: string | null;
  source_url: string | null;
  source_type: string | null;
  reason: string;
  raw_output: string;
};

const GEMINI_TIMEOUT_MS = 60_000;
const CLAUDE_TIMEOUT_MS = 90_000;
const CODEX_TIMEOUT_MS = 120_000;

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
    "Devi trovare UNA singola email pubblica del regista o filmmaker indicato.",
    "Hai a disposizione il testo COMPLETO del documento da cui è stato estratto il nome (catalogo festival, lista registi, programma).",
    "Usalo per disambiguare: titoli di film, anno, festival, sezione, paese, produzione, biografia.",
    "Cerca SOLO fonti pubbliche e verificabili (sito ufficiale, IMDB, Vimeo, FilmFreeway, sito della produzione, sito del festival).",
    "Non inventare email. Se non sei sicuro, found:false.",
    "Restituisci SOLO JSON valido, senza markdown.",
    "",
    "Dati identificativi del contatto:",
    JSON.stringify(identityFields, null, 2),
  ];
  if (pdf_full_text && pdf_full_text.trim()) {
    lines.push(
      "",
      `Testo completo del documento di origine${source_file ? ` (${source_file})` : ""}:`,
      "<<<DOCUMENT_START>>>",
      pdf_full_text,
      "<<<DOCUMENT_END>>>",
      "",
      "Cerca nel documento il contesto specifico che riguarda questo regista (titoli dei suoi film, anno, sezione del festival, paese, produzione) e usa quel contesto per la ricerca web mirata."
    );
  }
  lines.push(
    "",
    "Schema di output obbligatorio:",
    '{"found": true, "email": "...", "source_url": "...", "source_type": "official_site|production|festival|imdb|vimeo|filmfreeway|other", "reason": "..."}',
    "oppure:",
    '{"found": false, "reason": "..."}'
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
  const args = [
    "-p",
    prompt,
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
        const result = await runCommand({ command: "claude", args, cwd });
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
        const args = [
          "exec",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
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

  if (votes.size === 0) {
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
    const proposals = await Promise.all([
      searchByGemini(input, workingDirectory),
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
