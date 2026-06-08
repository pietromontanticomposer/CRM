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
  ai_sources: string[] | null;
  ai_director_tier: string | null;
  ai_director_tier_reason: string | null;
  ai_director_photo_url: string | null;
  source_link: string | null;
  email_source_url: string | null;
  email_source_type: string | null;
  email_confidence: number | null;
  email_enrichment_status: string | null;
  email_enrichment_reason: string | null;
  ai_agent_checks_json: Record<string, AgentSnapshot> | null;
};

type Filter = "all" | "needs_review" | "approved" | "blocked";

const summarizeStatus = (status: string | null) => {
  switch (status) {
    case "imported":
      return "In coda — il Writer sta per partire";
    case "processing":
      return "In lavorazione — sta cercando l'email e scrivendo la bozza";
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
  if (
    status === "draft_ready" ||
    status === "imported" ||
    status === "processing"
  )
    return 1;
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

const formatDuration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
};

export function OutreachBatchClient({ batchId }: { batchId: string }) {
  const [contacts, setContacts] = useState<BatchContact[]>([]);
  // Pannello "Modifica tutte le mail": aggiunge una frase a tutte le bozze.
  const [addOpen, setAddOpen] = useState(false);
  const [lineIt, setLineIt] = useState("");
  const [lineEn, setLineEn] = useState("");
  const [addPending, setAddPending] = useState(false);
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
        contact.ai_status === "imported" || contact.ai_status === "draft_ready" || contact.ai_status === "processing"
    );
    if (!stillProcessing) return;
    const id = window.setInterval(() => {
      void loadBatch({ silent: true });
    }, 1000);
    return () => window.clearInterval(id);
  }, [contacts, loadBatch]);

  const stillProcessing = useMemo(
    () =>
      contacts.some(
        (contact) =>
          contact.ai_status === "imported" ||
          contact.ai_status === "draft_ready" ||
          contact.ai_status === "processing"
      ),
    [contacts]
  );

  // Timer di elaborazione: da quanto il worker sta lavorando questo batch.
  // Lo start e' persistito in localStorage (sopravvive ai refresh), e si
  // "congela" quando non c'e' piu' niente in coda (fine giro).
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const key = `outreach_timer_${batchId}`;
    if (stillProcessing) {
      let start = Number(window.localStorage.getItem(key) || 0);
      if (!start) {
        start = Date.now();
        window.localStorage.setItem(key, String(start));
      }
      const tick = () => setElapsedMs(Date.now() - start);
      tick();
      const id = window.setInterval(tick, 1000);
      return () => window.clearInterval(id);
    }
    const start = Number(window.localStorage.getItem(key) || 0);
    if (start) {
      setElapsedMs(Date.now() - start);
      window.localStorage.removeItem(key);
    }
  }, [stillProcessing, batchId]);

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
          contact.ai_status === "imported" || contact.ai_status === "draft_ready" || contact.ai_status === "processing"
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

  // Anti-doppioni manuale (Pietro): azzera dal DB TUTTE le bozze importate OGGI
  // (globale, tutti i batch). Gli approvati (tabella contacts) restano.
  const deleteToday = async () => {
    const confirmed = window.confirm(
      "Elimino dal database TUTTE le bozze importate OGGI (non approvate), così non restano doppioni. I contatti già approvati restano intatti. Procedo?"
    );
    if (!confirmed) return;
    setBulkPending("reject");
    try {
      const response = await fetch("/api/outreach/drafts/cleanup-today", {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as {
        deleted?: number;
        error?: string;
      };
      if (!response.ok) {
        window.alert(`Errore: ${data.error || response.statusText}`);
        return;
      }
      window.alert(`Eliminate ${data.deleted ?? 0} bozze importate oggi.`);
      await loadBatch({ silent: true });
    } finally {
      setBulkPending(null);
    }
  };

  // Aggiunge una frase a TUTTE le mail del batch (ognuna nella sua lingua),
  // subito, senza rigenerare.
  const addLineToAll = async () => {
    if (!lineIt.trim() && !lineEn.trim()) {
      window.alert("Scrivi la frase (almeno una delle due).");
      return;
    }
    if (
      !window.confirm(
        "Aggiungo questa frase a TUTTE le mail di questo batch (italiano agli italiani, inglese agli stranieri). Procedo?"
      )
    ) {
      return;
    }
    setAddPending(true);
    try {
      const response = await fetch("/api/outreach/drafts/batch-add-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId,
          lineIt: lineIt.trim(),
          lineEn: lineEn.trim(),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        updated?: number;
        error?: string;
      };
      if (!response.ok) {
        window.alert(`Errore: ${data.error || response.statusText}`);
        return;
      }
      window.alert(`Frase aggiunta a ${data.updated ?? 0} mail.`);
      setLineIt("");
      setLineEn("");
      setAddOpen(false);
      await loadBatch({ silent: true });
    } finally {
      setAddPending(false);
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
            {(stillProcessing || elapsedMs > 0) && (
              <span
                className={`rounded-full border px-3 py-1 font-semibold tabular-nums ${
                  stillProcessing
                    ? "border-sky-500/40 bg-sky-500/10 text-sky-200"
                    : "border-[var(--line)] bg-[var(--panel)] text-[var(--muted)]"
                }`}
                title="Tempo di elaborazione del worker su questo batch"
              >
                {stillProcessing ? "⏱ " : "✓ "}
                {formatDuration(elapsedMs)}
                {stillProcessing ? "" : " totali"}
              </span>
            )}
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
                {counts.blocked} scartati
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
            <button
              type="button"
              disabled={!!bulkPending}
              onClick={() => void deleteToday()}
              className="rounded-full border border-red-500/50 bg-red-500/15 px-3 py-1 font-semibold text-red-200 hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              title="Cancella dal database tutte le bozze importate OGGI (anti-doppioni). Gli approvati restano."
            >
              Elimina importati oggi
            </button>
            <button
              type="button"
              onClick={() => setAddOpen((open) => !open)}
              className="rounded-full border border-[var(--accent)]/50 bg-[var(--accent)]/10 px-3 py-1 font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/20"
              title="Aggiungi una frase a TUTTE le mail di questo batch"
            >
              Modifica tutte le mail {addOpen ? "−" : "+"}
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

      {addOpen && (
        <div className="border-b border-[var(--line)] bg-[var(--panel)]/80">
          <div className="mx-auto w-full max-w-6xl px-6 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
              Modifica tutte le mail — aggiungi una frase a ogni mail del batch
            </div>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              La metto subito in tutte, ognuna nella sua lingua. Il sito non
              traduce da solo: scrivila in italiano (per gli italiani) e in
              inglese (per gli stranieri). Lascia vuota una se non ti serve.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Frase per i registi italiani
                </label>
                <textarea
                  className="w-full"
                  rows={2}
                  placeholder="Es: ho visto il tuo lavoro al festival di Trento e ho provato ad avvicinarti ma non ti ho trovato"
                  value={lineIt}
                  onChange={(event) => setLineIt(event.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Frase per gli stranieri (in inglese)
                </label>
                <textarea
                  className="w-full"
                  rows={2}
                  placeholder="Es: I saw your work at the Trento festival and tried to reach you but couldn't find you"
                  value={lineEn}
                  onChange={(event) => setLineEn(event.target.value)}
                />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={addPending}
                onClick={() => void addLineToAll()}
                className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {addPending ? "Aggiungo…" : "Aggiungi a tutte le mail"}
              </button>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--ink)]"
              >
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}

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
                    <div className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--accent)]/15 text-base font-semibold text-[var(--accent)]">
                      {contact.name?.charAt(0)?.toUpperCase() || "?"}
                      {contact.ai_director_photo_url && (
                        /* foto auto-trovata: se non carica (link rotto) si
                           nasconde e restano le iniziali. eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={contact.ai_director_photo_url}
                          alt={contact.name || "regista"}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          className="absolute inset-0 h-full w-full object-cover"
                          onError={(event) => {
                            event.currentTarget.style.display = "none";
                          }}
                        />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[var(--ink)]">
                        {contact.name || "(senza nome)"}
                      </div>
                      <div className="text-[11px] text-[var(--muted)]">
                        {contact.email || "email ancora da cercare"}
                      </div>
                      {(() => {
                        const t = contact.ai_director_tier || "sconosciuto";
                        const map: Record<
                          string,
                          { l: string; c: string }
                        > = {
                          sconosciuto: {
                            l: "Sconosciuto",
                            c: "border-[var(--line)] bg-[var(--panel-strong)] text-[var(--muted)]",
                          },
                          emergente: {
                            l: "Emergente",
                            c: "border-sky-500/40 bg-sky-500/10 text-sky-200",
                          },
                          affermato: {
                            l: "Affermato",
                            c: "border-violet-500/40 bg-violet-500/10 text-violet-200",
                          },
                          big: {
                            l: "Big",
                            c: "border-amber-500/50 bg-amber-500/15 text-amber-200",
                          },
                        };
                        const ui = map[t] ?? map.sconosciuto;
                        return (
                          <span
                            title={contact.ai_director_tier_reason ?? ""}
                            className={`mt-1 mr-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${ui.c}`}
                          >
                            Tier: {ui.l}
                          </span>
                        );
                      })()}
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
                          contact.ai_status === "processing" ||
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

                  // VERDETTO IN CHIARO (Pietro 2026-06-07): basta gergo. Un solo
                  // stato in italiano + cosa fare + checklist; il tecnico sotto
                  // "Dettagli".
                  const checksArr = [
                    checks.claude,
                    checks.codex,
                    checks.gemini,
                  ].filter(Boolean) as Array<{
                    contact_ok?: boolean;
                    email_ok?: boolean;
                    draft_ok?: boolean;
                    issues?: Array<string | { message?: string }>;
                  }>;
                  const conf =
                    typeof contact.email_confidence === "number"
                      ? Math.round(contact.email_confidence * 100)
                      : null;
                  const emailStrong =
                    (contact.email_enrichment_status === "found_public" ||
                      contact.email_enrichment_status === "present") &&
                    (conf === null || conf >= 75);
                  const emailWeak = Boolean(validationDone) && !emailStrong;
                  const contentDoubt = checksArr.some(
                    (c) => c.draft_ok === false
                  );
                  const personaDoubt =
                    checksArr.some((c) => c.contact_ok === false) ||
                    contact.ai_status === "blocked";
                  const contentIssues = checksArr
                    .filter((c) => c.draft_ok === false)
                    .flatMap((c) =>
                      (c.issues ?? []).map((i) =>
                        typeof i === "string" ? i : i?.message ?? ""
                      )
                    )
                    .filter(Boolean);

                  let vTitle = "Da rivedere";
                  let vAction = "Dai un'occhiata e approva.";
                  let vTone = "border-amber-500/50 bg-amber-500/10 text-amber-100";
                  if (contact.ai_status === "blocked") {
                    vTitle = "Scartata";
                    vAction = "Persona o contenuto non validi — non usarla.";
                    vTone = "border-red-500/50 bg-red-500/10 text-red-100";
                  } else if (contact.ai_status === "error") {
                    vTitle = "Errore nel controllo";
                    vAction = "Riprova: la verifica non è andata a buon fine.";
                    vTone = "border-red-500/50 bg-red-500/10 text-red-100";
                  } else if (
                    contact.ai_status === "approved" &&
                    contact.ai_send_allowed
                  ) {
                    vTitle = "Pronta da inviare";
                    vAction = "Dai un'ultima letta e invia.";
                    vTone =
                      "border-emerald-500/50 bg-emerald-500/10 text-emerald-100";
                  } else if (emailWeak && contentDoubt) {
                    vAction =
                      "Trova/conferma l'email (ora è indovinata) e controlla i dettagli segnalati nel testo.";
                  } else if (emailWeak) {
                    vAction = `Trova o conferma l'email: ora è solo indovinata${
                      conf !== null ? ` (${conf}%)` : ""
                    }.`;
                  } else if (contentDoubt) {
                    vAction =
                      "Controlla i dettagli segnalati nel testo prima di inviare.";
                  }

                  const chk = (ok: boolean, label: string) => (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                        ok
                          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200"
                          : "border-amber-500/40 bg-amber-500/10 text-amber-100"
                      }`}
                    >
                      <span aria-hidden>{ok ? "✓" : "!"}</span>
                      {label}
                    </span>
                  );

                  return (
                    <div className="mt-3 grid gap-2">
                      <div className={`rounded-xl border px-3 py-2 ${vTone}`}>
                        <div className="text-sm font-semibold">{vTitle}</div>
                        <div className="mt-0.5 text-[12px] opacity-90">
                          {vAction}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {chk(!personaDoubt, "Persona giusta")}
                        {chk(
                          !emailWeak,
                          emailWeak
                            ? `Email da confermare${
                                conf !== null ? ` (${conf}%)` : ""
                              }`
                            : "Email ok"
                        )}
                        {chk(
                          !contentDoubt,
                          contentDoubt ? "Testo da rivedere" : "Testo ok"
                        )}
                      </div>
                      {contentIssues.length > 0 && (
                        <ul className="list-disc pl-5 text-[11px] text-amber-100/90">
                          {contentIssues.slice(0, 3).map((msg, idx) => (
                            <li key={idx}>{msg}</li>
                          ))}
                        </ul>
                      )}
                      <details className="text-[10px] text-[var(--muted)]">
                        <summary className="cursor-pointer select-none">
                          Dettagli tecnici
                        </summary>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {enrichmentLabel && (
                            <span
                              className={`rounded-full border px-2 py-0.5 font-medium ${enrichmentTone}`}
                            >
                              {enrichmentLabel}
                              {typeof contact.email_confidence === "number" &&
                                ` · ${Math.round(
                                  contact.email_confidence * 100
                                )}%`}
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
                        </div>
                      </details>
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
                      {(contact.ai_link_visione ||
                        (contact.ai_sources &&
                          contact.ai_sources.length > 0)) && (
                        <div className="mt-3 rounded-lg border border-dashed border-[var(--line)] bg-[var(--panel)] p-2">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-600">
                            Verifica / Fonti — solo per te, NON viene inviata
                          </div>
                          {contact.ai_link_visione && (
                            <div className="mt-1 text-[11px] text-[var(--muted)] break-all">
                              Link visione: {contact.ai_link_visione}
                            </div>
                          )}
                          {contact.ai_sources &&
                            contact.ai_sources.length > 0 && (
                              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-[var(--muted)] break-all">
                                {contact.ai_sources.map((src, idx) => (
                                  <li key={idx}>{src}</li>
                                ))}
                              </ul>
                            )}
                        </div>
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
