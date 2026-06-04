import assert from "node:assert/strict";
import { aggregateResults } from "../aggregateResults";
import type { AgentRunResult } from "../agents/shared";
import { parseAgentOutput } from "../agents/shared";
import { parseTriageOutput } from "../agents/triageContact";
import type { AiAgentName } from "../../src/lib/aiOutreach";

type Override = Partial<AgentRunResult>;

const makeResult = (
  agent: AiAgentName,
  overrides: Override = {}
): AgentRunResult => ({
  agent_name: agent,
  approved: true,
  risk_level: "low",
  contact_ok: true,
  email_ok: true,
  draft_ok: true,
  send_allowed: true,
  failed: false,
  issues: [],
  suggested_status: "passed",
  raw_output: "",
  ...overrides,
});

const validJson = JSON.stringify({
  approved: true,
  risk_level: "low",
  contact_ok: true,
  email_ok: true,
  draft_ok: true,
  send_allowed: true,
  issues: [],
  suggested_status: "passed",
});

let testCount = 0;
const run = (label: string, fn: () => void) => {
  testCount += 1;
  try {
    fn();
    console.log(`ok ${testCount} - ${label}`);
  } catch (error) {
    console.error(`not ok ${testCount} - ${label}`);
    console.error(error);
    process.exitCode = 1;
  }
};

// --- parseAgentOutput ---

run("parser: JSON invalido => failed=true", () => {
  const result = parseAgentOutput("claude", "non json");
  assert.equal(result.failed, true);
  assert.equal(result.approved, false);
  assert.equal(result.send_allowed, false);
  assert.equal(result.suggested_status, "failed");
});

run("parser: campo bool mancante (contact_ok) => failed=true", () => {
  const raw = JSON.stringify({
    approved: true,
    risk_level: "low",
    email_ok: true,
    draft_ok: true,
    send_allowed: true,
    issues: [],
    suggested_status: "passed",
  });
  const result = parseAgentOutput("gemini", raw);
  assert.equal(result.failed, true);
  assert.equal(result.approved, false);
});

run("parser: JSON valido completo => failed=false, approved=true", () => {
  const result = parseAgentOutput("codex", validJson);
  assert.equal(result.failed, false);
  assert.equal(result.approved, true);
  assert.equal(result.send_allowed, true);
});

run("parser: email_ok=false forza send_allowed=false e approved=false", () => {
  const raw = JSON.stringify({
    approved: true,
    risk_level: "low",
    contact_ok: true,
    email_ok: false,
    draft_ok: true,
    send_allowed: true,
    issues: ["email mancante"],
    suggested_status: "blocked",
  });
  const result = parseAgentOutput("claude", raw);
  assert.equal(result.email_ok, false);
  assert.equal(result.send_allowed, false);
  assert.equal(result.approved, false);
});

run("parser: agente dichiara approved=true ma draft_ok=false => approved=false", () => {
  const raw = JSON.stringify({
    approved: true,
    risk_level: "medium",
    contact_ok: true,
    email_ok: true,
    draft_ok: false,
    send_allowed: true,
    issues: ["subject vuoto"],
    suggested_status: "blocked",
  });
  const result = parseAgentOutput("gemini", raw);
  assert.equal(result.approved, false);
});

run("parser: estrae JSON da markdown fences", () => {
  const wrapped = "```json\n" + validJson + "\n```";
  const result = parseAgentOutput("claude", wrapped);
  assert.equal(result.failed, false);
  assert.equal(result.approved, true);
});

// --- aggregateResults ---

run("aggregator: 3/3 approved => passed, ai_send_allowed=true", () => {
  const out = aggregateResults([
    makeResult("gemini"),
    makeResult("claude"),
    makeResult("codex"),
  ]);
  assert.equal(out.ai_status, "approved");
  assert.equal(out.ai_validation_status, "passed");
  assert.equal(out.ai_send_allowed, true);
});

run("aggregator: 2/3 approved => needs_review", () => {
  const out = aggregateResults([
    makeResult("gemini"),
    makeResult("claude"),
    makeResult("codex", { approved: false, suggested_status: "blocked" }),
  ]);
  assert.equal(out.ai_status, "needs_review");
  assert.equal(out.ai_validation_status, "needs_review");
});

run("aggregator: 1/3 approved => needs_review (revisione manuale)", () => {
  const out = aggregateResults([
    makeResult("gemini"),
    makeResult("claude", { approved: false }),
    makeResult("codex", { approved: false }),
  ]);
  assert.equal(out.ai_status, "needs_review");
  assert.equal(out.ai_validation_status, "needs_review");
});

run("aggregator: 0/3 approved => blocked", () => {
  const out = aggregateResults([
    makeResult("gemini", { approved: false }),
    makeResult("claude", { approved: false }),
    makeResult("codex", { approved: false }),
  ]);
  assert.equal(out.ai_status, "blocked");
});

run("aggregator: 1 failed + 2 approved => needs_review (failed conta come non-approved)", () => {
  const out = aggregateResults([
    makeResult("gemini"),
    makeResult("claude"),
    makeResult("codex", {
      failed: true,
      approved: false,
      send_allowed: false,
      contact_ok: false,
      email_ok: false,
      draft_ok: false,
      suggested_status: "failed",
    }),
  ]);
  assert.equal(out.ai_status, "needs_review");
  assert.equal(out.ai_send_allowed, false);
});

run("aggregator: 2 failed + 1 approved => needs_review (revisione manuale)", () => {
  const out = aggregateResults([
    makeResult("gemini"),
    makeResult("claude", { failed: true, approved: false, send_allowed: false }),
    makeResult("codex", { failed: true, approved: false, send_allowed: false }),
  ]);
  assert.equal(out.ai_status, "needs_review");
  assert.equal(out.ai_send_allowed, false);
});

run("aggregator: 3/3 approved ma email_ok=false su uno => ai_send_allowed=false (override)", () => {
  // In pratica il parser forzerebbe approved=false se email_ok=false e send_allowed=false.
  // Qui simuliamo direttamente AgentRunResult per testare il livello aggregator.
  const out = aggregateResults([
    makeResult("gemini"),
    makeResult("claude"),
    makeResult("codex", { email_ok: false, send_allowed: false }),
  ]);
  assert.equal(out.ai_send_allowed, false);
});

run("aggregator: 3/3 approved ma contact_ok=false su uno => needs_review", () => {
  const out = aggregateResults([
    makeResult("gemini"),
    makeResult("claude"),
    makeResult("codex", { contact_ok: false }),
  ]);
  assert.equal(out.ai_status, "needs_review");
});

run("aggregator: 3/3 failed => blocked, ai_send_allowed=false", () => {
  const out = aggregateResults([
    makeResult("gemini", { failed: true, approved: false, send_allowed: false }),
    makeResult("claude", { failed: true, approved: false, send_allowed: false }),
    makeResult("codex", { failed: true, approved: false, send_allowed: false }),
  ]);
  assert.equal(out.ai_status, "blocked");
  assert.equal(out.ai_send_allowed, false);
});

// --- parseTriageOutput ---

run("triage: persona valida => is_real_person=true, nome ripulito", () => {
  const raw = JSON.stringify({
    is_real_person: true,
    cleaned_name: "Zhang Wei",
    confidence: 0.92,
    reason: "Nome e cognome plausibili di un regista.",
  });
  const result = parseTriageOutput(raw);
  assert.ok(!("error" in result));
  if (!("error" in result)) {
    assert.equal(result.is_real_person, true);
    assert.equal(result.cleaned_name, "Zhang Wei");
    assert.equal(result.confidence, 0.92);
  }
});

run("triage: spazzatura (titolo film) => is_real_person=false", () => {
  const raw = JSON.stringify({
    is_real_person: false,
    cleaned_name: "",
    confidence: 0.96,
    reason: "È un titolo di film, non una persona.",
  });
  const result = parseTriageOutput(raw);
  assert.ok(!("error" in result));
  if (!("error" in result)) {
    assert.equal(result.is_real_person, false);
  }
});

run("triage: JSON invalido => error", () => {
  const result = parseTriageOutput("non json");
  assert.ok("error" in result);
});

run("triage: manca is_real_person => error", () => {
  const result = parseTriageOutput(JSON.stringify({ cleaned_name: "Tizio" }));
  assert.ok("error" in result);
});

run("triage: estrae JSON da markdown fences + confidence di default", () => {
  const raw =
    "```json\n" +
    JSON.stringify({ is_real_person: true, cleaned_name: "Maria Rossi", reason: "ok" }) +
    "\n```";
  const result = parseTriageOutput(raw);
  assert.ok(!("error" in result));
  if (!("error" in result)) {
    assert.equal(result.is_real_person, true);
    assert.equal(result.cleaned_name, "Maria Rossi");
    assert.equal(result.confidence, 0.5);
  }
});

if (process.exitCode === 1) {
  console.error(`\n${testCount} test eseguiti, almeno uno fallito.`);
  process.exit(1);
}
console.log(`\n${testCount} test passati.`);
