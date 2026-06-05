export const AI_AGENT_NAMES = ["gemini", "claude", "codex"] as const;
export const AI_WORKFLOW_STATUSES = [
  "not_checked",
  "imported",
  "draft_ready",
  "processing",
  "approved",
  "needs_review",
  "blocked",
  "error",
] as const;
export const AI_VALIDATION_STATUSES = [
  "not_checked",
  "passed",
  "needs_review",
  "blocked",
  "error",
] as const;

export type AiAgentName = (typeof AI_AGENT_NAMES)[number];
export type AiWorkflowStatus = (typeof AI_WORKFLOW_STATUSES)[number];
export type AiValidationStatus = (typeof AI_VALIDATION_STATUSES)[number];

export type AiAgentIssue = {
  code?: string;
  field?: string;
  message?: string;
  severity?: string;
  [key: string]: unknown;
};

export type AiAgentCheck = {
  approved: boolean;
  risk_level: string;
  contact_ok: boolean;
  email_ok: boolean;
  draft_ok: boolean;
  send_allowed: boolean;
  failed: boolean;
  issues: AiAgentIssue[];
  suggested_status: string;
  raw_output?: string | null;
  checked_at?: string | null;
};

export type AiAgentChecksMap = Partial<Record<AiAgentName, AiAgentCheck>>;

export type AiOutreachSendGate = {
  ai_batch_id?: string | null;
  ai_email_body?: string | null;
  ai_email_subject?: string | null;
  ai_status?: string | null;
  ai_validation_status?: string | null;
  email?: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const isAiOutreachContact = (contact: AiOutreachSendGate) =>
  isNonEmptyString(contact.ai_batch_id) ||
  (typeof contact.ai_status === "string" &&
    contact.ai_status !== "not_checked");

export const hasApprovedDraft = (contact: AiOutreachSendGate) =>
  isNonEmptyString(contact.ai_email_subject) &&
  isNonEmptyString(contact.ai_email_body);

export const getAiWorkflowStatusLabel = (status?: string | null) => {
  switch (status) {
    case "imported":
      return "Imported";
    case "draft_ready":
      return "Draft ready";
    case "processing":
      return "In lavorazione";
    case "approved":
      return "Approved";
    case "needs_review":
      return "Needs review";
    case "blocked":
      return "Blocked";
    case "error":
      return "Error";
    default:
      return "Not checked";
  }
};

export const getAiValidationStatusLabel = (status?: string | null) => {
  switch (status) {
    case "passed":
      return "Passed";
    case "needs_review":
      return "Needs review";
    case "blocked":
      return "Blocked";
    case "error":
      return "Error";
    default:
      return "Not checked";
  }
};

export const getAiOutreachSendBlockReason = (
  contact: AiOutreachSendGate
) => {
  if (!isAiOutreachContact(contact)) return null;
  if (!isNonEmptyString(contact.email)) {
    return "Invio bloccato: il contatto outreach non ha un'email.";
  }
  if (contact.ai_status !== "approved") {
    return "Invio bloccato: il contatto outreach non e approvato dal worker AI.";
  }
  if (contact.ai_validation_status !== "passed") {
    return "Invio bloccato: la validazione finale non e in stato passed.";
  }
  if (!hasApprovedDraft(contact)) {
    return "Invio bloccato: soggetto o corpo approvati mancanti.";
  }
  return null;
};

const normalizeIssue = (value: unknown): AiAgentIssue | null => {
  if (isNonEmptyString(value)) {
    return { message: value };
  }
  if (!isRecord(value)) return null;
  const issue: AiAgentIssue = {};
  Object.entries(value).forEach(([key, fieldValue]) => {
    if (
      typeof fieldValue === "string" ||
      typeof fieldValue === "number" ||
      typeof fieldValue === "boolean" ||
      fieldValue === null
    ) {
      issue[key] = fieldValue;
    }
  });
  if (!isNonEmptyString(issue.message)) {
    issue.message = "Issue reported";
  }
  return issue;
};

const readBool = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

export const normalizeAiAgentCheck = (value: unknown): AiAgentCheck | null => {
  if (!isRecord(value)) return null;
  if (typeof value.approved !== "boolean") return null;
  const issues = Array.isArray(value.issues)
    ? value.issues.map(normalizeIssue).filter(Boolean)
    : [];

  return {
    approved: value.approved,
    risk_level: isNonEmptyString(value.risk_level) ? value.risk_level : "unknown",
    contact_ok: readBool(value.contact_ok, false),
    email_ok: readBool(value.email_ok, false),
    draft_ok: readBool(value.draft_ok, false),
    send_allowed: readBool(value.send_allowed, false),
    failed: readBool(value.failed, false),
    issues: issues as AiAgentIssue[],
    suggested_status: isNonEmptyString(value.suggested_status)
      ? value.suggested_status
      : "error",
    raw_output: isNonEmptyString(value.raw_output) ? value.raw_output : null,
    checked_at: isNonEmptyString(value.checked_at) ? value.checked_at : null,
  };
};

export const normalizeAiAgentChecks = (value: unknown): AiAgentChecksMap => {
  if (!isRecord(value)) return {};
  return AI_AGENT_NAMES.reduce((acc, agentName) => {
    const normalized = normalizeAiAgentCheck(value[agentName]);
    if (normalized) {
      acc[agentName] = normalized;
    }
    return acc;
  }, {} as AiAgentChecksMap);
};
