"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Bottone della sezione "Live": avvia la ricerca di wedding planner entro ~2h da
// Verona. Non cerca qui (le AI girano nel worker locale): manda il segnale e il
// worker (Mac, "Avvia CRM") fa il lavoro — trova i planner, scrive le mail, le
// fa controllare. Nessun invio automatico: le bozze restano da approvare a mano.
export function FindWeddingPlannersButton({ target = 20 }: { target?: number }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/outreach/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        batch?: { id?: string };
        pending?: boolean;
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error || "Impossibile avviare la ricerca.");
        setSubmitting(false);
        return;
      }
      if (payload.pending) {
        setMessage(payload.message || "Una ricerca è già in corso.");
        setSubmitting(false);
        return;
      }
      if (payload.batch?.id) {
        router.push(`/crm/outreach/${payload.batch.id}`);
        return;
      }
      setMessage("Ricerca avviata.");
      setSubmitting(false);
    } catch {
      setError("Server non raggiungibile.");
      setSubmitting(false);
    }
  };

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={start}
        disabled={submitting}
        className="group flex w-full items-center justify-between gap-4 rounded-xl border-2 border-dashed border-[var(--line)] bg-[var(--panel)] px-5 py-5 text-left transition hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-[var(--panel-strong)] text-[var(--muted-strong)] transition group-hover:border-[var(--accent)] group-hover:text-[var(--accent)]">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </div>
          <div>
            <div className="text-base font-semibold text-[var(--ink)]">
              Trova {target} wedding planner · entro ~2h da Verona
            </div>
            <div className="mt-0.5 text-xs text-[var(--muted)]">
              Cerco {target} nuovi wedding planner online, trovo l&apos;email e preparo le mail (musica dal vivo per matrimoni). Tu approvi. Tieni acceso &laquo;Avvia CRM&raquo;.
            </div>
          </div>
        </div>
        <span
          aria-hidden
          className="shrink-0 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--muted-strong)] transition group-hover:border-[var(--accent)] group-hover:text-[var(--ink)]"
        >
          {submitting ? "Avvio…" : "Cerca →"}
        </span>
      </button>
      {message && (
        <div className="mt-2 rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-1.5 text-[11px] text-[var(--muted-strong)]">
          {message}
        </div>
      )}
      {error && (
        <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
