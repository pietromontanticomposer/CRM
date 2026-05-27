"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type AgentSnapshot = {
  approved?: boolean;
  failed?: boolean;
  risk_level?: string;
  email_ok?: boolean;
  contact_ok?: boolean;
  draft_ok?: boolean;
  send_allowed?: boolean;
  suggested_status?: string;
  issues?: Array<{ message?: string } | string>;
};

// Una "BatchContact" e' una outreach_draft. Non e' un contact reale: il
// contact reale viene creato solo all'approvazione (POST /approve).
type BatchContact = {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  batch_id: string | null;
  batch_name: string | null;
  ai_status: string | null;
  ai_validation_status: string | null;
  ai_email_subject: string | null;
  ai_email_body: string | null;
  ai_validation_summary: string | null;
  ai_send_allowed: boolean | null;
  ai_template_used: string | null;
  ai_link_visione: string | null;
  source_link: string | null;
  email_source_url: string | null;
  email_source_type: string | null;
  email_confidence: number | null;
  email_enrichment_status: string | null;
  email_enrichment_reason: string | null;
  ai_agent_checks_json: Record<string, AgentSnapshot> | null;
};

type Filter = "all" | "needs_review" | "approved" | "blocked";

type StepState = "done" | "active" | "pending" | "error";

const computeSteps = (
  status: string | null,
  validation: string | null
): Array<{ label: string; state: StepState }> => {
  const steps = [
    { label: "Import", state: "done" as StepState },
    { label: "Writer", state: "pending" as StepState },
    { label: "3-agent", state: "pending" as StepState },
    { label: "Review", state: "pending" as StepState },
  ];
  if (!status || status === "not_checked" || status === "imported") {
    steps[1].state = "active";
    return steps;
  }
  if (status === "error") {
    steps[1].state = "error";
    return steps;
  }
  if (status === "draft_ready") {
    steps[1].state = "done";
    steps[2].state = "active";
    return steps;
  }
  steps[1].state = "done";
  steps[2].state = "done";
  if (status === "approved" && validation === "passed") {
    steps[3].state = "done";
    return steps;
  }
  if (status === "needs_review") {
    steps[3].state = "active";
    return steps;
  }
  if (status === "blocked") {
    steps[3].state = "error";
    return steps;
  }
  steps[3].state = "active";
  return steps;
};

const stepClass = (state: StepState) => {
  switch (state) {
    case "done":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
    case "active":
      return "border-sky-500/40 bg-sky-500/10 text-sky-200 animate-pulse";
    case "error":
      return "border-red-500/40 bg-red-500/10 text-red-200";
    default:
      return "border-[var(--line)] bg-[var(--panel)] text-[var(--muted)]";
  }
};

const summarizeStatus = (status: string | null) => {
  switch (status) {
    case "imported":
      return "In coda — il Writer sta per partire";
    case "draft_ready":
      return "Bozza generata — i 3 agenti la stanno controllando";
    case "approved":
      return "Pronto: i 3 agenti hanno approvato";
    case "needs_review":
      return "Serve la tua review";
    case "blocked":
      return "Bloccato dai controlli";
    case "error":
      return "Errore tecnico durante la validazione";
    default:
      return "In attesa";
  }
};

const isReady = (status: string | null) =>
  status === "approved" || status === "needs_review" || status === "blocked";

const priorityOf = (status: string | null) => {
  if (status === "needs_review") return 0;
  if (status === "draft_ready" || status === "imported") return 1;
  if (status === "approved") return 2;
  if (status === "blocked") return 3;
  return 4;
};

const filterPillClass = (active: boolean) =>
  `rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] transition ${
    active
      ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--ink)]"
      : "border-[var(--line)] bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--ink)]"
  }`;

const agentBadge = (label: string, snap?: AgentSnapshot | null) => {
  if (!snap) return null;
  const cls = snap.failed
    ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
    : snap.approved
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
    : "border-red-500/40 bg-red-500/10 text-red-200";
  const text = snap.failed
    ? "errore"
    : snap.approved
    ? "ok"
    : "no";
  return (
    <span
      key={label}
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${cls}`}
    >
      {label} · {text}
    </span>
  );
};

const EMAIL_STATUS_LABEL: Record<string, string> = {
  found_public: "Email trovata",
  needs_review: "Email da controllare",
  not_found: "Email non trovata",
  error: "Errore ricerca email",
  present: "Email presente",
  missing: "Email mancante",
};

const EMAIL_STATUS_TONE: Record<string, string> = {
  found_public: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  needs_review: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  not_found: "border-red-500/40 bg-red-500/10 text-red-200",
  error: "border-red-500/40 bg-red-500/10 text-red-200",
  present: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  missing: "border-[var(--line)] bg-[var(--panel)] text-[var(--muted)]",
};

const SOURCE_TYPE_LABEL: Record<string, string> = {
  official_site: "sito ufficiale",
  production: "sito produzione",
  festival: "sito festival",
  imdb: "IMDb",
  vimeo: "Vimeo",
  filmfreeway: "FilmFreeway",
  file_import: "file importato",
  consensus: "3 AI concordi",
  single_agent: "1 AI",
  unverified: "non verificata",
};

const readApiError = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.clone().json()) as { error?: string };
    if (payload.error?.trim()) return payload.error;
  } catch {
    // ignore
  }
  return fallback;
};

export function OutreachBatchClient({ batchId }: { batchId: string }) {
  const [contacts, setContacts] = useState<BatchContact[]>([]);
  const [batchName, setBatchName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [actionPendingId, setActionPendingId] = useState<string | null>(null);
  const [bulkPending, setBulkPending] = useState<null | "approve" | "reject">(
    null
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const requestIdRef = useRef(0);

  const loadBatch = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      const requestId = ++requestIdRef.current;
      if (!silent) setLoading(true);
      const response = await fetch(
        `/api/outreach/drafts?batchId=${encodeURIComponent(batchId)}`,
        { method: "GET", cache: "no-store" }
      ).catch(() => null);
      if (requestId !== requestIdRef.current) return;
      if (!response) {
        setError("Server non raggiungibile.");
        if (!silent) setLoading(false);
        return;
      }
      if (!response.ok) {
        setError(await readApiError(response, "Impossibile caricare il batch."));
        if (!silent) setLoading(false);
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as {
        drafts?: BatchContact[];
      };
      const drafts = payload.drafts ?? [];
      setContacts(drafts);
      const name = drafts.find((c) => c.batch_name)?.batch_name ?? null;
      setBatchName(name);
      setError(null);
      if (!silent) setLoading(false);
    },
    [batchId]
  );

  useEffect(() => {
    void loadBatch();
  }, [loadBatch]);

  useEffect(() => {
    const stillProcessing = contacts.some(
      (contact) =>
        contact.ai_status === "imported" || contact.ai_status === "draft_ready"
    );
    if (!stillProcessing) return;
    const id = window.setInterval(() => {
      void loadBatch({ silent: true });
    }, 3000);
    return () => window.clearInterval(id);
  }, [contacts, loadBatch]);

  const counts = useMemo(() => {
    let processed = 0;
    let needsReview = 0;
    let approved = 0;
    let blocked = 0;
    let sendAllowed = 0;
    let emailsFound = 0;
    let emailsChecked = 0;
    let draftsWritten = 0;
    contacts.forEach((contact) => {
      if (isReady(contact.ai_status)) processed += 1;
      if (contact.ai_status === "needs_review") needsReview += 1;
      if (contact.ai_status === "approved") approved += 1;
      if (contact.ai_status === "blocked") blocked += 1;
      if (contact.ai_send_allowed) sendAllowed += 1;
      if (contact.email) emailsFound += 1;
      if (contact.email || contact.email_enrichment_status) emailsChecked += 1;
      if (contact.ai_email_subject?.trim() && contact.ai_email_body?.trim()) {
        draftsWritten += 1;
      }
    });
    return {
      processed,
      total: contacts.length,
      needsReview,
      approved,
      blocked,
      sendAllowed,
      emailsFound,
      emailsChecked,
      draftsWritten,
    };
  }, [contacts]);

  const isWorking = useMemo(
    () =>
      contacts.some(
        (contact) =>
          contact.ai_status === "imported" || contact.ai_status === "draft_ready"
      ),
    [contacts]
  );

  const visible = useMemo(() => {
    const filtered = contacts.filter((contact) => {
      if (filter === "all") return true;
      return contact.ai_status === filter;
    });
    return [...filtered].sort(
      (a, b) => priorityOf(a.ai_status) - priorityOf(b.ai_status)
    );
  }, [contacts, filter]);

  const patchContact = async (
    contactId: string,
    payload: Record<string, unknown>
  ) => {
    setActionPendingId(contactId);
    try {
      const response = await fetch(`/api/outreach/drafts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => null);
      if (!response || !response.ok) {
        const message = response
          ? await readApiError(response, "Aggiornamento fallito.")
          : "Server non raggiungibile.";
        setError(message);
        return false;
      }
      await loadBatch({ silent: true });
      return true;
    } finally {
      setActionPendingId(null);
    }
  };

  const deleteContact = async (contactId: string, silent = false) => {
    if (!silent) setActionPendingId(contactId);
    try {
      const response = await fetch(`/api/outreach/drafts/${contactId}`, {
        method: "DELETE",
      }).catch(() => null);
      if (!response || !response.ok) {
        const message = response
          ? await readApiError(response, "Cancellazione fallita.")
          : "Server non raggiungibile.";
        setError(message);
        return false;
      }
      return true;
    } finally {
      if (!silent) setActionPendingId(null);
    }
  };

  // Promuove la draft a contact reale nella tabella contacts (e cancella la
  // draft). Solo dopo questo passaggio il contatto compare in /crm.
  const promoteDraft = async (id: string) => {
    setActionPendingId(id);
    try {
      const response = await fetch(
        `/api/outreach/drafts/${id}/approve`,
        { method: "POST" }
      ).catch(() => null);
      if (!response || !response.ok) {
        const message = response
          ? await readApiError(response, "Approvazione fallita.")
          : "Server non raggiungibile.";
        setError(message);
        return false;
      }
      return true;
    } finally {
      setActionPendingId(null);
    }
  };

  const handleApprove = async (id: string) => {
    const ok = await promoteDraft(id);
    if (ok) await loadBatch({ silent: true });
  };

  const handleReject = async (id: string) => {
    const ok = await deleteContact(id);
    if (ok) await loadBatch({ silent: true });
  };

  const startEdit = (contact: BatchContact) => {
    setEditingId(contact.id);
    setEditSubject(contact.ai_email_subject ?? "");
    setEditBody(contact.ai_email_body ?? "");
  };

  const handleSaveEdit = async (contact: BatchContact) => {
    // Salva le modifiche al subject/body sulla draft, poi promuovi.
    const patched = await patchContact(contact.id, {
      ai_email_subject: editSubject.trim(),
      ai_email_body: editBody.trim(),
    });
    if (!patched) return;
    const promoted = await promoteDraft(contact.id);
    if (promoted) {
      setEditingId(null);
      await loadBatch({ silent: true });
    }
  };

  const bulkApprove = async () => {
    const readyIds = contacts
      .filter(
        (contact) =>
          contact.ai_status === "needs_review" ||
          contact.ai_status === "approved"
      )
      .filter(
        (contact) =>
          contact.ai_email_subject?.trim() && contact.ai_email_body?.trim()
      )
      .map((contact) => contact.id);
    if (!readyIds.length) return;
    setBulkPending("approve");
    try {
      for (const id of readyIds) {
        await promoteDraft(id);
      }
      await loadBatch({ silent: true });
    } finally {
      setBulkPending(null);
    }
  };

  const bulkReject = async () => {
    const ids = contacts
      .filter((contact) => contact.ai_status === "blocked")
      .map((contact) => contact.id);
    if (!ids.length) return;
    setBulkPending("reject");
    try {
      for (const id of ids) {
        await deleteContact(id, true);
      }
      await loadBatch({ silent: true });
    } finally {
      setBulkPending(null);
    }
  };

  const purgeUnapproved = async () => {
    const ids = contacts
      .filter((contact) => contact.ai_status !== "approved")
      .map((contact) => contact.id);
    if (!ids.length) return;
    const confirmed = window.confirm(
      `Cancello ${ids.length} contatti non approvati dal database. Procedo?`
    );
    if (!confirmed) return;
    setBulkPending("reject");
    try {
      for (const id of ids) {
        await deleteContact(id, true);
      }
      await loadBatch({ silent: true });
    } finally {
      setBulkPending(null);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--panel)]/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/crm"
              className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--ink)]"
            >
              ← CRM
            </Link>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">
                Worker AI · revisione batch
              </div>
              <div className="mt-1 text-base font-semibold text-[var(--ink)]">
                {batchName || "Batch AI Outreach"}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 font-semibold text-[var(--muted)]">
              {counts.processed}/{counts.total} processati
            </span>
            {counts.needsReview > 0 && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 font-semibold text-amber-200">
                {counts.needsReview} da rivedere
              </span>
            )}
            {counts.approved > 0 && (
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 font-semibold text-emerald-200">
                {counts.approved} approvati
              </span>
            )}
            {counts.blocked > 0 && (
              <span className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 font-semibold text-red-200">
                {counts.blocked} bloccati
              </span>
            )}
            {counts.sendAllowed > 0 && (
              <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 font-semibold text-sky-200">
                {counts.sendAllowed} send_allowed
              </span>
            )}
            <button
              type="button"
              disabled={!!bulkPending || counts.needsReview === 0}
              onClick={bulkApprove}
              className="rounded-full bg-emerald-500/90 px-3 py-1 font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {bulkPending === "approve"
                ? "Approvo…"
                : `Approva tutti i pronti${
                    counts.needsReview ? ` · ${counts.needsReview}` : ""
                  }`}
            </button>
            <button
              type="button"
              disabled={!!bulkPending || counts.blocked === 0}
              onClick={bulkReject}
              className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 font-semibold text-red-200 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancella bloccati {counts.blocked || ""}
            </button>
            <button
              type="button"
              disabled={
                !!bulkPending || counts.total - counts.approved === 0
              }
              onClick={() => void purgeUnapproved()}
              className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 font-semibold text-[var(--muted)] hover:border-red-500/40 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
              title="Cancella dal database tutti i contatti non ancora approvati"
            >
              Svuota non approvati
            </button>
          </div>
        </div>
        <div className="mx-auto w-full max-w-6xl px-6 pb-3">
          <div
            className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${
              isWorking
                ? "border-sky-500/40 bg-sky-500/5"
                : "border-emerald-500/40 bg-emerald-500/5"
            }`}
          >
            <span
              aria-hidden
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                isWorking ? "animate-pulse bg-sky-400" : "bg-emerald-400"
              }`}
            />
            <div className="text-sm font-semibold text-[var(--ink)]">
              {isWorking
                ? "Le 3 AI stanno lavorando — aggiornamento ogni 3 secondi"
                : "Tutto pronto per la tua revisione"}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-1 font-medium text-[var(--muted-strong)]">
                <span className="text-[var(--ink)] tabular-nums">{counts.emailsFound}</span>
                <span className="text-[var(--muted)]"> / {counts.total}</span>
                <span className="ml-1 text-[var(--muted)]">email trovate</span>
              </span>
              <span className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-1 font-medium text-[var(--muted-strong)]">
                <span className="text-[var(--ink)] tabular-nums">{counts.draftsWritten}</span>
                <span className="text-[var(--muted)]"> / {counts.total}</span>
                <span className="ml-1 text-[var(--muted)]">bozze scritte</span>
              </span>
              <span className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-1 font-medium text-[var(--muted-strong)]">
                <span className="text-[var(--ink)] tabular-nums">{counts.processed}</span>
                <span className="text-[var(--muted)]"> / {counts.total}</span>
                <span className="ml-1 text-[var(--muted)]">validati dalle 3 AI</span>
              </span>
            </div>
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-6 pb-3">
          <button
            type="button"
            className={filterPillClass(filter === "all")}
            onClick={() => setFilter("all")}
          >
            Tutti · {counts.total}
          </button>
          <button
            type="button"
            className={filterPillClass(filter === "needs_review")}
            onClick={() => setFilter("needs_review")}
          >
            Da rivedere · {counts.needsReview}
          </button>
          <button
            type="button"
            className={filterPillClass(filter === "approved")}
            onClick={() => setFilter("approved")}
          >
            Approvati · {counts.approved}
          </button>
          <button
            type="button"
            className={filterPillClass(filter === "blocked")}
            onClick={() => setFilter("blocked")}
          >
            Bloccati · {counts.blocked}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 py-6">
        {error && (
          <div className="mb-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {loading && contacts.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--muted)]">
            Carico il batch…
          </div>
        )}

        {!loading && contacts.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--muted)]">
            Nessun contatto trovato per questo batch.
          </div>
        )}

        {visible.length === 0 && contacts.length > 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--muted)]">
            Nessun contatto in questa categoria. Cambia filtro per vedere gli
            altri.
          </div>
        )}

        <div className="grid gap-4">
          {visible.map((contact) => {
            const steps = computeSteps(
              contact.ai_status,
              contact.ai_validation_status
            );
            const ready = isReady(contact.ai_status);
            const isEditing = editingId === contact.id;
            const pending = actionPendingId === contact.id;
            const checks = contact.ai_agent_checks_json ?? {};
            return (
              <article
                key={contact.id}
                className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--accent)]/15 text-base font-semibold text-[var(--accent)]">
                      {contact.name?.charAt(0)?.toUpperCase() || "?"}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[var(--ink)]">
                        {contact.name || "(senza nome)"}
                      </div>
                      <div className="text-[11px] text-[var(--muted)]">
                        {contact.email || "email ancora da cercare"}
                      </div>
                      <div
                        className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          contact.ai_status === "approved"
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                            : contact.ai_status === "needs_review"
                            ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                            : contact.ai_status === "blocked"
                            ? "border-red-500/40 bg-red-500/10 text-red-200"
                            : contact.ai_status === "error"
                            ? "border-red-500/40 bg-red-500/10 text-red-200"
                            : "border-sky-500/40 bg-sky-500/10 text-sky-200"
                        }`}
                      >
                        {(contact.ai_status === "imported" ||
                          contact.ai_status === "draft_ready" ||
                          !contact.ai_status ||
                          contact.ai_status === "not_checked") && (
                          <span
                            aria-hidden
                            className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400"
                          />
                        )}
                        {summarizeStatus(contact.ai_status)}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {steps.map((step) => (
                      <span
                        key={step.label}
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${stepClass(step.state)}`}
                      >
                        {step.label}
                      </span>
                    ))}
                  </div>
                </div>

                {(() => {
                  const agentBadges = [
                    agentBadge("Claude", checks.claude),
                    agentBadge("Gemini", checks.gemini),
                    agentBadge("Codex", checks.codex),
                  ].filter(Boolean);
                  const enrichmentLabel = contact.email_enrichment_status
                    ? EMAIL_STATUS_LABEL[contact.email_enrichment_status] ??
                      contact.email_enrichment_status
                    : null;
                  const enrichmentTone = contact.email_enrichment_status
                    ? EMAIL_STATUS_TONE[contact.email_enrichment_status] ??
                      "border-[var(--line)] bg-[var(--panel-strong)] text-[var(--muted)]"
                    : null;
                  const sourceLabel = contact.email_source_type
                    ? SOURCE_TYPE_LABEL[contact.email_source_type] ??
                      contact.email_source_type
                    : null;
                  const validationDone =
                    contact.ai_validation_status &&
                    contact.ai_validation_status !== "not_checked";
                  const hasAnything =
                    agentBadges.length > 0 ||
                    enrichmentLabel ||
                    sourceLabel ||
                    contact.ai_template_used ||
                    validationDone;
                  if (!hasAnything) return null;
                  return (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px]">
                      {enrichmentLabel && (
                        <span
                          className={`rounded-full border px-2 py-0.5 font-medium ${enrichmentTone}`}
                        >
                          {enrichmentLabel}
                          {typeof contact.email_confidence === "number" &&
                            ` · ${Math.round(contact.email_confidence * 100)}%`}
                        </span>
                      )}
                      {sourceLabel && contact.email_source_url && (
                        <a
                          href={contact.email_source_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-2 py-0.5 text-[var(--muted)] hover:text-[var(--ink)]"
                        >
                          via {sourceLabel}
                        </a>
                      )}
                      {agentBadges}
                      {contact.ai_template_used && (
                        <span className="rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-2 py-0.5 text-[var(--muted)]">
                          Template {contact.ai_template_used}
                        </span>
                      )}
                      {validationDone && (
                        <span
                          className={`rounded-full border px-2 py-0.5 font-semibold ${
                            contact.ai_send_allowed
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                              : "border-red-500/40 bg-red-500/10 text-red-200"
                          }`}
                        >
                          {contact.ai_send_allowed
                            ? "pronto da inviare"
                            : "non inviabile"}
                        </span>
                      )}
                    </div>
                  );
                })()}

                {ready && !isEditing && (
                  <div className="mt-4 grid gap-3 md:grid-cols-[1fr,2fr]">
                    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                        Subject
                      </div>
                      <div className="mt-1 text-sm text-[var(--ink)]">
                        {contact.ai_email_subject || "—"}
                      </div>
                      {contact.ai_link_visione && (
                        <>
                          <div className="mt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                            Link visione
                          </div>
                          <div className="mt-1 text-[11px] text-[var(--muted)] break-all">
                            {contact.ai_link_visione}
                          </div>
                        </>
                      )}
                    </div>
                    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                        Body
                      </div>
                      <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-[var(--ink)]">
                        {contact.ai_email_body || "—"}
                      </pre>
                    </div>
                  </div>
                )}

                {isEditing && (
                  <div className="mt-4 grid gap-2">
                    <input
                      className="w-full"
                      placeholder="Subject"
                      value={editSubject}
                      onChange={(event) => setEditSubject(event.target.value)}
                    />
                    <textarea
                      className="w-full"
                      rows={10}
                      placeholder="Body"
                      value={editBody}
                      onChange={(event) => setEditBody(event.target.value)}
                    />
                  </div>
                )}

                {contact.ai_validation_summary && !isEditing && (
                  <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
                    {contact.ai_validation_summary}
                  </div>
                )}

                {ready && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {!isEditing ? (
                      <>
                        <button
                          type="button"
                          disabled={pending || !contact.ai_email_subject}
                          onClick={() => void handleApprove(contact.id)}
                          className="rounded-full bg-emerald-500/90 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Approva
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => startEdit(contact)}
                          className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-4 py-1.5 text-xs font-semibold text-[var(--ink)] hover:border-[var(--accent)]"
                        >
                          Modifica
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => void handleReject(contact.id)}
                          className="rounded-full border border-red-500/40 bg-red-500/10 px-4 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                          title="Rimuove il contatto dal database (non recuperabile)"
                        >
                          Scarta · cancella
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => void handleSaveEdit(contact)}
                          className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Salva e approva
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-4 py-1.5 text-xs font-semibold text-[var(--muted)] hover:text-[var(--ink)]"
                        >
                          Annulla
                        </button>
                      </>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}
