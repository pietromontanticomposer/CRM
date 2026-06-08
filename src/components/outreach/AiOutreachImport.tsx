"use client";

import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";

export type OutreachImportDraft = {
  batchName: string;
  promptMasterRules: string;
  contactsJson: string;
};

export type EmailStatus =
  | "present"
  | "missing"
  | "found_public"
  | "needs_review"
  | "not_found";

export type ImportedRow = {
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

export type FileReport = {
  file_name: string;
  file_type: string;
  status: "parsed" | "needs_review" | "file_not_readable" | "error";
  rows: ImportedRow[];
  errors: string[];
};

type Props = {
  draft: OutreachImportDraft;
  importing: boolean;
  message: string | null;
  onDraftChange: (next: OutreachImportDraft) => void;
  onImport: (rows: ImportedRow[]) => Promise<void> | void;
};

const emailStatusLabel: Record<EmailStatus, string> = {
  present: "Email presente",
  missing: "Email mancante",
  found_public: "Email trovata online",
  needs_review: "Email dubbia",
  not_found: "Email non trovata",
};

const emailStatusClass = (status: EmailStatus) => {
  switch (status) {
    case "present":
    case "found_public":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
    case "missing":
    case "not_found":
      return "border-amber-500/40 bg-amber-500/10 text-amber-200";
    case "needs_review":
      return "border-orange-500/40 bg-orange-500/10 text-orange-200";
    default:
      return "border-[var(--line)] bg-[var(--panel)] text-[var(--muted)]";
  }
};

const fileStatusClass = (status: FileReport["status"]) => {
  switch (status) {
    case "parsed":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
    case "needs_review":
      return "border-orange-500/40 bg-orange-500/10 text-orange-200";
    case "file_not_readable":
      return "border-amber-500/40 bg-amber-500/10 text-amber-200";
    case "error":
      return "border-red-500/40 bg-red-500/10 text-red-200";
    default:
      return "border-[var(--line)] bg-[var(--panel)] text-[var(--muted)]";
  }
};

export function AiOutreachImport({
  draft,
  importing,
  message,
  onDraftChange,
  onImport,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [reports, setReports] = useState<FileReport[]>([]);
  const [topError, setTopError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const totalRows = useMemo(
    () => reports.reduce((acc, report) => acc + report.rows.length, 0),
    [reports]
  );

  const withEmail = useMemo(
    () =>
      reports.reduce(
        (acc, report) =>
          acc + report.rows.filter((row) => row.email).length,
        0
      ),
    [reports]
  );

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(Boolean);
    if (list.length === 0) return;
    setTopError(null);
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
        throw new Error(payload.error || "Parsing fallito.");
      }
      const newReports = payload.files ?? [];
      setReports((prev) => [...prev, ...newReports]);
    } catch (error) {
      setTopError(
        error instanceof Error ? error.message : "Errore durante il parsing."
      );
    } finally {
      setExtracting(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files?.length) {
      void handleFiles(event.dataTransfer.files);
    }
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!dragOver) setDragOver(true);
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
  };

  const onPickFile = () => {
    fileInputRef.current?.click();
  };

  const onFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      void handleFiles(event.target.files);
    }
    event.target.value = "";
  };

  const updateRow = (
    fileIndex: number,
    rowIndex: number,
    patch: Partial<ImportedRow>
  ) => {
    setReports((prev) =>
      prev.map((report, i) => {
        if (i !== fileIndex) return report;
        return {
          ...report,
          rows: report.rows.map((row, j) =>
            j === rowIndex ? { ...row, ...patch } : row
          ),
        };
      })
    );
  };

  const removeRow = (fileIndex: number, rowIndex: number) => {
    setReports((prev) =>
      prev.map((report, i) => {
        if (i !== fileIndex) return report;
        return {
          ...report,
          rows: report.rows.filter((_, j) => j !== rowIndex),
        };
      })
    );
  };

  const removeFile = (fileIndex: number) => {
    setReports((prev) => prev.filter((_, i) => i !== fileIndex));
  };

  const clearAll = () => {
    setReports([]);
    setTopError(null);
  };

  const importDisabled = importing || extracting || totalRows === 0;

  const handleImportClick = async () => {
    const allRows = reports.flatMap((report) => report.rows);
    if (allRows.length === 0) return;
    await onImport(allRows);
  };

  return (
    <div className="rounded-3xl border border-[var(--line)] bg-gradient-to-b from-[var(--panel)] to-[var(--panel-strong)] p-5 shadow-[0_30px_60px_-40px_rgba(15,23,42,0.55)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">
            AI Outreach
          </div>
          <h3 className="mt-1 text-base font-semibold text-[var(--ink)]">
            Importa registi da file
          </h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Trascina uno o più file (PDF, CSV, TXT, JSON). Il worker locale
            cerca email mancanti su fonti pubbliche e i 3 agenti CLI validano
            ogni bozza.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
          Local worker
        </span>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={onPickFile}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onPickFile();
          }
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`mt-4 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition cursor-pointer select-none ${
          dragOver
            ? "border-[var(--accent)] bg-[var(--accent)]/10"
            : "border-[var(--line)] bg-[var(--panel)] hover:border-[var(--accent)]/50 hover:bg-[var(--accent)]/5"
        }`}
      >
        <div className="grid h-11 w-11 place-items-center rounded-full border border-[var(--line)] bg-[var(--panel-strong)] text-[var(--muted)]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 3v12" />
            <path d="m7 8 5-5 5 5" />
            <path d="M5 21h14" />
          </svg>
        </div>
        <div className="text-sm font-semibold text-[var(--ink)]">
          {extracting
            ? "Sto leggendo i file…"
            : "Trascina qui PDF, CSV, TXT o JSON"}
        </div>
        <div className="text-[11px] text-[var(--muted)]">
          {extracting
            ? "Estraggo i contatti…"
            : "oppure clicca per caricare uno o più file"}
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

      {topError && (
        <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {topError}
        </div>
      )}

      {reports.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-[var(--ink)]">
              {totalRows} contatt{totalRows === 1 ? "o" : "i"} totali ·{" "}
              <span className="text-emerald-300">{withEmail} con email</span> ·{" "}
              <span className="text-amber-300">
                {totalRows - withEmail} da arricchire
              </span>
            </div>
            <button
              type="button"
              className="text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--ink)]"
              onClick={clearAll}
            >
              Svuota tutto
            </button>
          </div>

          {reports.map((report, fileIndex) => (
            <div
              key={`${report.file_name}-${fileIndex}`}
              className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${fileStatusClass(report.status)}`}
                  >
                    {report.status}
                  </span>
                  <span className="truncate text-xs font-semibold text-[var(--ink)]">
                    {report.file_name}
                  </span>
                  <span className="text-[10px] text-[var(--muted)]">
                    {report.rows.length} righe
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(fileIndex)}
                  className="rounded-full border border-transparent px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)] hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
                >
                  Rimuovi file
                </button>
              </div>

              {report.errors.length > 0 && (
                <div className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
                  {report.errors.join(" · ")}
                </div>
              )}

              {report.rows.length > 0 && (
                <div className="mt-2 max-h-72 overflow-y-auto pr-1 text-[11px]">
                  {report.rows.map((row, rowIndex) => (
                    <div
                      key={`${report.file_name}-${rowIndex}`}
                      className="group grid grid-cols-12 items-center gap-2 border-b border-dashed border-[var(--line)] py-1.5 last:border-0"
                    >
                      <input
                        className="col-span-4 truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-[var(--ink)] hover:border-[var(--line)] focus:border-[var(--accent)] focus:outline-none"
                        value={row.name}
                        onChange={(event) =>
                          updateRow(fileIndex, rowIndex, {
                            name: event.target.value,
                          })
                        }
                      />
                      <input
                        className="col-span-4 truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-[var(--muted)] hover:border-[var(--line)] focus:border-[var(--accent)] focus:outline-none"
                        placeholder="email…"
                        value={row.email ?? ""}
                        onChange={(event) => {
                          const value = event.target.value.trim();
                          updateRow(fileIndex, rowIndex, {
                            email: value || null,
                            email_status: value ? "present" : "missing",
                            email_confidence: value ? 1 : null,
                          });
                        }}
                      />
                      <span
                        className={`col-span-3 truncate rounded-full border px-2 py-0.5 text-center text-[10px] font-semibold ${emailStatusClass(row.email_status)}`}
                      >
                        {emailStatusLabel[row.email_status]}
                      </span>
                      <button
                        type="button"
                        aria-label={`Rimuovi ${row.name}`}
                        onClick={() => removeRow(fileIndex, rowIndex)}
                        className="col-span-1 justify-self-end rounded-full border border-transparent px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)] opacity-60 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 hover:opacity-100 group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-3">
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink)]">
          Personalizzazione — vale per TUTTI i contatti di questo import
        </label>
        <button
          type="button"
          onClick={() =>
            onDraftChange({
              ...draft,
              promptMasterRules:
                "Sono i registi del [SCRIVI QUI IL FESTIVAL, es: 74° Trento Film Festival 2026]. Cerca info SOLO sui loro film di quel festival (scheda ufficiale, sinossi, recensioni): i film NON sono guardabili online, è normale. Aggiungi a ogni mail, nel punto naturale: “ho visto il tuo lavoro al festival e ho provato ad avvicinarti ma non ti ho trovato”.",
            })
          }
          className="mb-2 rounded-full border border-[var(--accent)]/50 bg-[var(--accent)]/10 px-3 py-1 text-[11px] font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/20"
        >
          Preset: registi di un festival
        </button>
        <textarea
          className="w-full"
          rows={4}
          placeholder={
            "Istruzioni in più per lo scrittore, applicate a ogni mail di questo import. Es:\n" +
            "Sono tutti registi del Trento Film Festival 2026. Aggiungi alla mail: \"ho visto il tuo lavoro al festival di Trento e ho provato ad avvicinarti ma non ti ho trovato\"."
          }
          value={draft.promptMasterRules}
          onChange={(event) =>
            onDraftChange({ ...draft, promptMasterRules: event.target.value })
          }
        />
      </div>

      <button
        type="button"
        onClick={() => setAdvancedOpen((open) => !open)}
        className="mt-3 flex w-full items-center justify-between rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)] hover:text-[var(--ink)]"
      >
        <span>Opzioni avanzate</span>
        <span aria-hidden>{advancedOpen ? "−" : "+"}</span>
      </button>

      {advancedOpen && (
        <div className="mt-3 grid gap-3">
          <input
            className="w-full"
            placeholder="Nome batch (opzionale)"
            value={draft.batchName}
            onChange={(event) =>
              onDraftChange({ ...draft, batchName: event.target.value })
            }
          />
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          void handleImportClick();
        }}
        disabled={importDisabled}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_-22px_rgba(37,99,235,0.9)] transition hover:-translate-y-0.5 hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {importing ? (
          <>
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <span>Importazione in corso…</span>
          </>
        ) : (
          <span>
            Importa contatti{totalRows ? ` · ${totalRows}` : ""}
          </span>
        )}
      </button>

      {message && (
        <div
          className={`mt-3 rounded-xl border px-3 py-2 text-xs ${
            message.startsWith("Batch ")
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : "border-red-500/40 bg-red-500/10 text-red-200"
          }`}
        >
          {message}
        </div>
      )}
    </div>
  );
}
