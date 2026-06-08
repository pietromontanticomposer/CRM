"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const SECTION_STORAGE_KEY = "crm-section";

type EmailStatus =
  | "present"
  | "missing"
  | "found_public"
  | "needs_review"
  | "not_found";

type ImportedRow = {
  name: string;
  email: string | null;
  source_link: string | null;
  notes: string | null;
  language: string | null;
  company: string | null;
  city: string | null;
  email_source_url: string | null;
  email_confidence: number | null;
  email_status: EmailStatus;
};

type FileReport = {
  file_name: string;
  file_type: string;
  status: "parsed" | "needs_review" | "file_not_readable" | "error";
  rows: ImportedRow[];
  errors: string[];
  raw_text: string | null;
};

type FileBlock = {
  id: string;
  file_name: string;
  status: FileReport["status"];
  errors: string[];
  rows: ImportedRow[];
  raw_text: string | null;
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

const newBlockId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const FILE_STATUS_LABEL: Record<FileReport["status"], string> = {
  parsed: "Letto",
  needs_review: "Da controllare",
  file_not_readable: "Non leggibile",
  error: "Errore",
};

const FILE_STATUS_TONE: Record<FileReport["status"], string> = {
  parsed: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  needs_review: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  file_not_readable: "bg-orange-500/10 text-orange-300 border-orange-500/30",
  error: "bg-red-500/10 text-red-300 border-red-500/30",
};

export function OutreachImportClient() {
  const router = useRouter();
  const [files, setFiles] = useState<FileBlock[]>([]);
  const [importing, setImporting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Festival del batch (se sono registi di un festival): se compilato, ogni mail
  // apre con "ho visto il tuo film al (festival)…" invece di "navigando online".
  const [festival, setFestival] = useState("");
  // Personalizzazione: altre istruzioni libere per lo scrittore, per tutto l'import.
  const [personalization, setPersonalization] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const totals = useMemo(() => {
    const allRows = files.flatMap((f) => f.rows);
    const withEmail = allRows.filter((r) => r.email).length;
    return {
      contacts: allRows.length,
      files: files.length,
      withEmail,
      withoutEmail: allRows.length - withEmail,
    };
  }, [files]);

  const ingestFiles = useCallback(async (list: File[]) => {
    if (!list.length) return;
    setError(null);
    setExtracting(true);
    try {
      const formData = new FormData();
      list.forEach((file) => formData.append("file", file));
      const response = await fetch(
        "/api/contacts/import-directors-files",
        { method: "POST", body: formData }
      ).catch(() => null);
      if (!response) {
        throw new Error("Server non raggiungibile.");
      }
      const payload = (await response.json().catch(() => ({}))) as {
        files?: FileReport[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Lettura del file fallita.");
      }
      const newBlocks: FileBlock[] = (payload.files ?? []).map((report) => ({
        id: newBlockId(),
        file_name: report.file_name,
        status: report.status,
        errors: report.errors,
        rows: report.rows,
        raw_text: report.raw_text ?? null,
      }));
      setFiles((prev) => [...prev, ...newBlocks]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Errore inatteso."
      );
    } finally {
      setExtracting(false);
    }
  }, []);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const list = Array.from(event.dataTransfer.files ?? []);
    if (list.length > 0) void ingestFiles(list);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!dragOver) setDragOver(true);
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
  };

  const pickFile = () => fileInputRef.current?.click();

  const onFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(event.target.files ?? []);
    if (list.length > 0) void ingestFiles(list);
    event.target.value = "";
  };

  const removeBlock = (blockId: string) => {
    setFiles((prev) => prev.filter((b) => b.id !== blockId));
  };

  const resetAll = () => {
    setFiles([]);
    setError(null);
  };

  const handleImport = async () => {
    const allRows = files.flatMap((b) => b.rows);
    if (!allRows.length) return;

    setImporting(true);
    setError(null);

    const section =
      typeof window !== "undefined"
        ? window.localStorage.getItem(SECTION_STORAGE_KEY) || "cinema"
        : "cinema";

    const rowToBlock = new Map<ImportedRow, FileBlock>();
    files.forEach((block) => {
      block.rows.forEach((row) => rowToBlock.set(row, block));
    });

    const contactsPayload = allRows
      .filter((row) => row.name?.trim() || row.email?.trim())
      .map((row) => {
        const block = rowToBlock.get(row);
        return {
          name:
            row.name?.trim() || row.email?.split("@")[0] || "(senza nome)",
          email: row.email?.trim() || null,
          company: row.company,
          notes: row.notes,
          section,
          sourceLink: row.source_link,
          verifiedFactsJson: block?.raw_text
            ? {
                pdf_full_text: block.raw_text,
                source_file: block.file_name,
              }
            : {},
          email_source_url: row.email_source_url,
          email_confidence: row.email_confidence,
          email_status: row.email_status,
          role: "Regista",
        };
      });

    const f = festival.trim();
    const festivalInstruction = f
      ? `Sono registi del "${f}". Cerca info SOLO sui loro film di quel festival (scheda ufficiale, sinossi, recensioni): i film NON sono guardabili online, è normale. APERTURA OBBLIGATORIA — UNA SOLA, SOSTITUISCE "navigando online" (mai tutte e due): di' che hai visto il loro film al "${f}" e che hai provato ad avvicinarti di persona ma non ci sei riuscito. Spirito ESATTO — EN: «I saw your "(title)" at the ${f} and I tried to get close to you but I couldn't.» · IT: «Ho visto il suo "(titolo)" al ${f} e ho provato ad avvicinarla di persona, ma non ci sono riuscito.» Usa il TITOLO dal contesto e il nome ESATTO "${f}"; NON inventare numeri/edizioni del festival.`
      : "";
    const masterRules =
      [festivalInstruction, personalization.trim()].filter(Boolean).join("\n\n") ||
      undefined;

    const response = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "outreach_import",
        batchName: `Import ${new Date().toLocaleString("it-IT", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })}`,
        section,
        promptMasterRules: masterRules,
        contacts: contactsPayload,
      }),
    }).catch(() => null);

    if (!response) {
      setError("Server non raggiungibile.");
      setImporting(false);
      return;
    }
    if (!response.ok) {
      setError(await readApiError(response, "Import fallito."));
      setImporting(false);
      return;
    }
    const payload = (await response.json()) as {
      batch?: { id?: string };
    };
    if (payload.batch?.id) {
      router.push(`/crm/outreach/${payload.batch.id}`);
    } else {
      setImporting(false);
    }
  };

  const hasFiles = files.length > 0;
  const hasContacts = totals.contacts > 0;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--bg)]/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-3">
            <Link
              href="/crm"
              className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] transition hover:text-[var(--ink)]"
            >
              ← CRM
            </Link>
            <h1 className="text-sm font-semibold tracking-tight text-[var(--ink)]">
              Importa registi
            </h1>
          </div>
          <div className="flex items-center gap-2 text-[11px] tabular-nums text-[var(--muted)]">
            <span>{totals.files} file</span>
            <span>·</span>
            <span>{totals.contacts} contatti</span>
            {totals.withEmail > 0 && (
              <>
                <span>·</span>
                <span className="text-emerald-400">
                  {totals.withEmail} con email
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        {/* STEP 1 — DROPZONE */}
        <section>
          <div className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-white">
              1
            </span>
            <span>Carica i file</span>
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={pickFile}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                pickFile();
              }
            }}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            className={`flex cursor-pointer select-none flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition ${
              dragOver
                ? "border-[var(--accent)] bg-[var(--accent)]/10"
                : "border-[var(--line)] bg-[var(--panel)] hover:border-[var(--accent)]/50"
            }`}
          >
            <div className="grid h-14 w-14 place-items-center rounded-full border border-[var(--line)] bg-[var(--panel-strong)] text-[var(--muted-strong)]">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 3v12" />
                <path d="m7 8 5-5 5 5" />
                <path d="M5 21h14" />
              </svg>
            </div>
            <div>
              <div className="text-base font-semibold text-[var(--ink)]">
                {extracting
                  ? "Sto leggendo i file…"
                  : hasFiles
                  ? "Aggiungi altri file"
                  : "Trascina qui i file con la lista di registi"}
              </div>
              <div className="mt-1 text-xs text-[var(--muted)]">
                {extracting
                  ? "Un attimo…"
                  : "PDF, CSV, TXT o JSON · oppure clicca per scegliere"}
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".json,.csv,.pdf,.txt,application/json,application/pdf,text/csv,text/plain"
              className="hidden"
              onChange={onFileInputChange}
            />
          </div>
          {error && (
            <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </section>

        {/* STEP 2 — REVISIONE */}
        {hasFiles && (
          <section className="mt-10">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
                <span
                  className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white ${
                    hasContacts ? "bg-[var(--accent)]" : "bg-[var(--line-strong)]"
                  }`}
                >
                  2
                </span>
                <span>Anteprima</span>
              </div>
              <button
                type="button"
                onClick={resetAll}
                className="text-[11px] font-medium text-[var(--muted)] hover:text-[var(--ink)]"
              >
                Svuota tutto
              </button>
            </div>

            <p className="mb-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-[11px] leading-relaxed text-[var(--muted-strong)]">
              Questo è solo un riepilogo di ciò che è stato letto. Non devi
              sistemare niente a mano: le 3 AI cercano le email, scrivono le
              bozze e <span className="font-medium text-[var(--ink)]">scartano
              da sole</span> le righe che non sono registi reali (titoli di
              film, nazioni, intestazioni). Se un intero file è sbagliato puoi
              rimuoverlo.
            </p>

            <div className="space-y-4">
              {files.map((block) => (
                <div
                  key={block.id}
                  className="rounded-xl border border-[var(--line)] bg-[var(--panel)]"
                >
                  <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] ${FILE_STATUS_TONE[block.status]}`}
                      >
                        {FILE_STATUS_LABEL[block.status]}
                      </span>
                      <span className="truncate text-sm font-medium text-[var(--ink)]">
                        {block.file_name}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-[var(--muted)]">
                        {block.rows.length}{" "}
                        {block.rows.length === 1 ? "riga" : "righe"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeBlock(block.id)}
                      className="rounded-md px-2 py-1 text-[11px] font-medium text-[var(--muted)] transition hover:text-red-300"
                    >
                      Rimuovi
                    </button>
                  </header>

                  {block.errors.length > 0 && (
                    <div className="border-b border-[var(--line)] bg-amber-500/5 px-4 py-2 text-[11px] text-amber-200">
                      {block.errors.join(" · ")}
                    </div>
                  )}

                  {block.rows.length > 0 ? (
                    <div className="max-h-[420px] overflow-y-auto">
                      <table className="w-full table-fixed border-collapse text-sm">
                        <thead className="sticky top-0 z-10 bg-[var(--panel)] text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
                          <tr>
                            <th className="w-[40%] px-4 py-2 text-left">
                              Nome
                            </th>
                            <th className="w-[42%] px-2 py-2 text-left">
                              Email
                            </th>
                            <th className="w-[18%] px-2 py-2 text-left">
                              Stato
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {block.rows.map((row, index) => {
                            const hasEmail = Boolean(row.email);
                            return (
                              <tr
                                key={`${block.id}-${index}`}
                                className="border-t border-[var(--line)]"
                              >
                                <td className="truncate px-4 py-1.5 text-sm text-[var(--ink)]">
                                  {row.name}
                                </td>
                                <td className="truncate px-2 py-1.5 text-sm text-[var(--muted-strong)]">
                                  {row.email ?? (
                                    <span className="text-[var(--muted)]">
                                      la cercano le AI
                                    </span>
                                  )}
                                </td>
                                <td className="px-2 py-1.5">
                                  <span
                                    className={`inline-flex items-center gap-1 text-[11px] ${
                                      hasEmail
                                        ? "text-emerald-300"
                                        : "text-amber-300"
                                    }`}
                                  >
                                    <span
                                      className={`h-1.5 w-1.5 rounded-full ${
                                        hasEmail
                                          ? "bg-emerald-400"
                                          : "bg-amber-400"
                                      }`}
                                    />
                                    {hasEmail ? "Email nel file" : "Da cercare"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="px-4 py-6 text-center text-xs text-[var(--muted)]">
                      Nessuna riga letta da questo file.
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* STEP 3 — AVVIA LE AI */}
        {hasContacts && (
          <section className="mt-10">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-white">
                3
              </span>
              <span>Avvia le 3 AI</span>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
                    Totale contatti
                  </div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--ink)]">
                    {totals.contacts}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
                    Email già nel file
                  </div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-300">
                    {totals.withEmail}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
                    Da cercare online
                  </div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-amber-300">
                    {totals.withoutEmail}
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/5 p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-500/20 text-sky-300">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>
                  </div>
                  <div className="text-xs leading-relaxed text-[var(--ink)]">
                    <div className="mb-1 font-semibold">
                      Cosa succede quando clicchi qui sotto
                    </div>
                    <div className="text-[var(--muted-strong)]">
                      <span className="font-medium text-[var(--ink)]">1.</span> Il worker sul tuo Mac inizia a cercare su internet le {totals.withoutEmail} email mancanti.{" "}
                      <span className="font-medium text-[var(--ink)]">2.</span> Il Writer Claude scrive una bozza personalizzata per ciascun contatto.{" "}
                      <span className="font-medium text-[var(--ink)]">3.</span> I 3 agenti (Claude, Codex, Gemini) controllano ogni bozza.{" "}
                      <span className="font-medium text-[var(--ink)]">4.</span> Tu approvi nella prossima schermata. Nessuna email parte automaticamente.
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-5 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink)]">
                  Festival del batch (se sono registi di un festival)
                </label>
                <input
                  className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2 text-sm text-[var(--ink)]"
                  placeholder="es: 74° Trento Film Festival 2026  —  lascia vuoto se NON è un festival"
                  value={festival}
                  onChange={(event) => setFestival(event.target.value)}
                />
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  Se lo compili, ogni mail apre con “Ho visto il suo film al{" "}
                  {festival.trim() || "(festival)"} e ho provato ad avvicinarla ma
                  non ci sono riuscito” (in italiano o in inglese), al posto di
                  “navigando online”.
                </p>
                <label className="mb-1 mt-3 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Altre istruzioni (opzionale)
                </label>
                <textarea
                  className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2 text-sm text-[var(--ink)]"
                  rows={3}
                  placeholder="Istruzioni in più per lo scrittore, applicate a ogni mail (lascia vuoto se non serve)."
                  value={personalization}
                  onChange={(event) => setPersonalization(event.target.value)}
                />
              </div>
              <button
                type="button"
                disabled={importing || extracting || totals.contacts === 0}
                onClick={() => void handleImport()}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importing ? (
                  <>
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Avvio in corso…
                  </>
                ) : (
                  <>
                    Avvia ricerca email + bozze ({totals.contacts}{" "}
                    {totals.contacts === 1 ? "contatto" : "contatti"})
                    <span aria-hidden>→</span>
                  </>
                )}
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
