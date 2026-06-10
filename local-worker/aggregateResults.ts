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
  const ai_send_allowed =
    results.length > 0 &&
    results.every((result) => result.send_allowed && !result.failed);

  const nonFailed = results.filter((result) => !result.failed);

  const failedAgents = results
    .filter((result) => result.failed)
    .map((result) => labelOf(result.agent_name));

  // Un validatore approva il CONTENUTO se: persona giusta (contact_ok) + email
  // valida (email_ok) + bozza senza claim falsi (draft_ok). send_allowed
  // riguarda solo l'invio AUTOMATICO (es. email a confidence bassa): non e' un
  // problema di contenuto, quindi NON conta per bloccare/cancellare.
  const contentOk = nonFailed.filter(
    (result) => result.contact_ok && result.email_ok && result.draft_ok
  );
  const contentRejectCount = nonFailed.length - contentOk.length;
  const rejected = nonFailed
    .filter(
      (result) => !(result.contact_ok && result.email_ok && result.draft_ok)
    )
    .map((result) => labelOf(result.agent_name));
  const hasContactDoubt = nonFailed.some((result) => !result.contact_ok);

  let ai_status: AiWorkflowStatus;
  let ai_validation_status: AiValidationStatus;
  let summary: string;

  if (nonFailed.length === 0) {
    // TUTTI i validatori falliti (rete / tetto abbonamento esaurito): NON e' un
    // verdetto. La bozza e' gia' scritta -> "draft_ready" cosi' il worker la
    // RIPRENDE e ri-valida al prossimo giro (o quando il tetto torna). Niente
    // stato "da rivedere".
    ai_status = "draft_ready";
    ai_validation_status = "not_checked";
    summary = `Validatori non disponibili (${failedAgents.join(
      ", "
    )}): riprovo al prossimo giro.`;
  } else if (contentRejectCount > contentOk.length) {
    // ANTI-CAZZATE: la MAGGIORANZA dei validatori che hanno girato ha respinto
    // il CONTENUTO (claim falso/non documentato, persona sbagliata, riferimento
    // musicale errato). BOCCIATO, anche se uno non l'ha beccato.
    ai_status = "blocked";
    ai_validation_status = "blocked";
    summary = `Invio bloccato: ${rejected.join(
      ", "
    )} hanno respinto il contenuto (claim non verificati o errati).`;
  } else if (
    failedAgents.length === 0 &&
    contentOk.length === nonFailed.length &&
    nonFailed.every((result) => result.approved) &&
    !hasContactDoubt
  ) {
    // Tutti e 3 i validatori hanno girato e approvano tutto, invio incluso.
    ai_status = "approved";
    ai_validation_status = "passed";
    summary = "Validazione completata: tutti i validatori approvano.";
  } else if (failedAgents.length > 0) {
    // Un validatore non ha potuto controllare (transitorio / tetto esaurito):
    // NON e' un verdetto e NON scarta. Ri-valido al prossimo giro (bozza gia'
    // scritta -> "draft_ready"). Cosi' un tetto esaurito non butta un buon lavoro.
    ai_status = "draft_ready";
    ai_validation_status = "not_checked";
    summary = `Validazione incompleta (${failedAgents.join(
      ", "
    )} non disponibili): riprovo.`;
  } else {
    // REGOLA PIETRO (2026-06-10): tutti i validatori hanno girato ma NON tutti
    // approvano -> dubbio REALE -> SCARTATA. Niente "da rivedere": 10 perfetti
    // meglio di 30 incerti.
    ai_status = "blocked";
    ai_validation_status = "blocked";
    summary = rejected.length
      ? `Scartata: dubbi sul contenuto da ${rejected.join(", ")}.`
      : "Scartata: contenuto non certo al 100%.";
  }

  return {
    ai_status,
    ai_validation_status,
    ai_send_allowed,
    summary,
    checks_json,
  };
};
