"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";

const SECTION_STORAGE_KEY = "crm-section";

// Estrae un nome plausibile (~2 parole) dall'input dell'utente.
// "diego carli verona monitus"   -> name="diego carli"   (resto = contesto)
// "Mario Rossi, regista di X"    -> name="Mario Rossi"  (virgola interrompe)
// "Maria Grazia Cucinotta, X"    -> name="Maria Grazia Cucinotta" (virgola dopo 3 parole)
// L'intero testo originale viene poi passato come pdf_full_text alle AI
// cosi' hanno comunque accesso a tutta l'info aggiuntiva (citta', produzione, etc).
const extractName = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // Se c'e' una virgola/newline/parentesi, prendi tutto prima
  const beforeBreak = trimmed.split(/[,\n(]/)[0]?.trim();
  if (beforeBreak && beforeBreak.length <= 80 && beforeBreak.length < trimmed.length) {
    return beforeBreak;
  }
  // Altrimenti: prime 2 parole (default per "Nome Cognome")
  const words = trimmed.split(/\s+/);
  return words.slice(0, 2).join(" ").slice(0, 80);
};

export function OutreachQuickSearchInput() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = value.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setError(null);

    const name = extractName(text);
    if (!name) {
      setError("Inserisci almeno il nome del regista.");
      setSubmitting(false);
      return;
    }

    const section =
      typeof window !== "undefined"
        ? window.localStorage.getItem(SECTION_STORAGE_KEY) || "cinema"
        : "cinema";

    try {
      const response = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "outreach_import",
          batchName: `Ricerca rapida · ${name} · ${new Date().toLocaleString(
            "it-IT",
            { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
          )}`,
          section,
          contacts: [
            {
              name,
              email: null,
              notes: text.length > name.length ? text : null,
              section,
              verifiedFactsJson: {
                pdf_full_text: text,
                source_file: "ricerca-rapida-manuale",
              },
              role: "Regista",
            },
          ],
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error || "Impossibile creare la draft.");
        setSubmitting(false);
        return;
      }
      const payload = (await response.json()) as {
        batch?: { id?: string };
      };
      if (payload.batch?.id) {
        router.push(`/crm/outreach/${payload.batch.id}`);
        return;
      }
      setSubmitting(false);
    } catch {
      setError("Server non raggiungibile.");
      setSubmitting(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form onSubmit={submit} className="mb-4">
      <div
        className={`flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-2.5 transition focus-within:border-[var(--accent)] ${
          submitting ? "opacity-70" : ""
        }`}
      >
        <span
          aria-hidden
          className="shrink-0 text-[var(--muted)]"
          title="Cerca regista"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Cerca regista per nome (es: Mario Rossi, regista di 'Il Sole Spento', Trento 2024)"
          disabled={submitting}
          className="flex-1 border-0 bg-transparent text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-0"
          style={{ boxShadow: "none", padding: 0 }}
        />
        <button
          type="submit"
          disabled={submitting || !value.trim()}
          className="shrink-0 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-1 text-xs font-semibold text-[var(--muted-strong)] transition hover:border-[var(--accent)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "…" : "Invio ↵"}
        </button>
      </div>
      {error && (
        <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300">
          {error}
        </div>
      )}
    </form>
  );
}
