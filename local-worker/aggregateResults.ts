import {
  type AiAgentChecksMap,
  type AiAgentName,
  type AiValidationStatus,
  type AiWorkflowStatus,
} from "../src/lib/aiOutreach";
import type { AgentRunResult } from "./agents/shared";

export type AggregatedValidationResult = {
  ai_status: AiWorkflowStatus;
  ai_validation_status: AiValidationStatus;
  ai_send_allowed: boolean;
  summary: string;
  checks_json: AiAgentChecksMap;
};

const AGENT_LABELS: Record<AiAgentName, string> = {
  gemini: "Gemini",
  claude: "Claude",
  codex: "Codex",
};

const labelOf = (name: AiAgentName) => AGENT_LABELS[name] ?? name;

export const aggregateResults = (
  results: AgentRunResult[]
): AggregatedValidationResult => {
  const checked_at = new Date().toISOString();
  const checks_json = results.reduce((acc, result) => {
    acc[result.agent_name] = {
      approved: result.approved,
      risk_level: result.risk_level,
      contact_ok: result.contact_ok,
      email_ok: result.email_ok,
      draft_ok: result.draft_ok,
      send_allowed: result.send_allowed,
      failed: result.failed,
      issues: result.issues,
      suggested_status: result.suggested_status,
      raw_output: result.raw_output,
      checked_at,
    };
    return acc;
  }, {} as AiAgentChecksMap);

  // ai_send_allowed globale: TUTTI gli agenti devono dichiarare send_allowed=true.
  // Basta un false (o un agente failed) per bloccare.
  const ai_send_allowed = results.every(
    (result) => result.send_allowed && !result.failed
  );

  const approvedCount = results.filter(
    (result) => result.approved && !result.failed
  ).length;

  const failedAgents = results
    .filter((result) => result.failed)
    .map((result) => labelOf(result.agent_name));

  const rejected = results
    .filter((result) => !result.approved && !result.failed)
    .map((result) => labelOf(result.agent_name));

  // Override: se almeno un agente segnala contact_ok=false, lo stato minimo e' needs_review.
  const hasContactDoubt = results.some(
    (result) => !result.failed && !result.contact_ok
  );

  let ai_status: AiWorkflowStatus;
  let ai_validation_status: AiValidationStatus;
  let summary: string;

  if (approvedCount === results.length && results.length > 0) {
    if (hasContactDoubt) {
      ai_status = "needs_review";
      ai_validation_status = "needs_review";
      summary =
        "Validazione completata ma contact_ok=false segnalato: serve revisione manuale.";
    } else {
      ai_status = "approved";
      ai_validation_status = "passed";
      summary = "Validazione completata: Gemini, Claude e Codex approvano.";
    }
  } else if (approvedCount >= 1) {
    // Pietro 2026-05-29: se ALMENO 1 validatore approva, la bozza va a
    // revisione manuale (non bloccata). Il writer puo' aver citato un lavoro
    // vero che gli altri validatori non riescono a verificare via web in
    // questa sessione — meglio che decida Pietro.
    ai_status = "needs_review";
    ai_validation_status = "needs_review";
    const blockers = [...rejected, ...failedAgents].join(", ");
    summary = blockers
      ? `Serve revisione manuale: ${blockers} ha segnalato problemi.`
      : "Serve revisione manuale.";
  } else {
    ai_status = "blocked";
    ai_validation_status = "blocked";
    const blockers = [...rejected, ...failedAgents].join(", ");
    summary = blockers
      ? `Invio bloccato: ${blockers} hanno respinto la bozza.`
      : "Invio bloccato: nessun agente ha approvato.";
  }

  return {
    ai_status,
    ai_validation_status,
    ai_send_allowed,
    summary,
    checks_json,
  };
};
