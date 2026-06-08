import { NextResponse } from "next/server";
import { parseDirectorsPdf } from "@/lib/server/parseDirectorsPdf";
import { isUnauthorizedError, requireCurrentUser } from "@/lib/server/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EmailStatus =
  | "present"
  | "missing"
  | "found_public"
  | "needs_review"
  | "not_found";

type ParsedRow = {
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
  rows: ParsedRow[];
  errors: string[];
  raw_text: string | null;
};

const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_REGEX = /\bhttps?:\/\/[^\s,;<>()"']+/gi;
const NAME_TAIL_REGEX =
  /([A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]+){0,4})\s*[<(,;\s]*$/u;
const NAME_ONLY_REGEX =
  /\b([A-ZÀ-Ý][a-zà-ÿ'’.-]{1,}(?:\s+(?:[A-ZÀ-Ý][a-zà-ÿ'’.-]{1,}|[A-ZÀ-Ý]\.)){1,3})\b/gu;

const SKIP_NAME_TOKENS = new Set([
  "Trento",
  "Film",
  "Festival",
  "Concorso",
  "Concorsi",
  "Premio",
  "Sezione",
  "Paese",
  "Paesi",
  "Anno",
  "Titolo",
  "Regista",
  "Registi",
  "Elenco",
  "Completo",
  "Programma",
  "Apertura",
  "Chiusura",
  "Italia",
  "Italiano",
  "Italiana",
  "Francia",
  "Spagna",
  "Germania",
  "Argentina",
  "Brasile",
  "Canada",
  "Stati",
  "Uniti",
  "Regno",
  "Unito",
  "Belgio",
  "Cinema",
  "Lungometraggio",
  "Documentario",
  "Cortometraggio",
  "Fuori",
  "Maggio",
  "Aprile",
  "Marzo",
  "Giugno",
  "Settembre",
  "Ottobre",
  "Novembre",
  "Dicembre",
  "Gennaio",
  "Febbraio",
  "Luglio",
  "Agosto",
]);

const sanitizeLine = (line: string) => line.replace(/\s+/g, " ").trim();

const baseRow = (name: string, email: string | null): ParsedRow => ({
  name,
  email,
  source_link: null,
  notes: null,
  language: null,
  company: null,
  city: null,
  email_source_url: null,
  email_confidence: email ? 1 : null,
  email_status: email ? "present" : "missing",
});

const csvSplit = (line: string) => {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((value) => value.trim());
};

const normalizeHeader = (value: string) =>
  value
    .toLowerCase()
    .replace(/^"|"$/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

const csvFieldAliases: Record<string, keyof ParsedRow> = {
  name: "name",
  nome: "name",
  director: "name",
  regista: "name",
  email: "email",
  mail: "email",
  source_link: "source_link",
  link: "source_link",
  website: "source_link",
  sito: "source_link",
  notes: "notes",
  note: "notes",
  language: "language",
  lingua: "language",
  company: "company",
  produzione: "company",
  azienda: "company",
  city: "city",
  citta: "city",
};

const parseCsv = (text: string): ParsedRow[] => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = csvSplit(lines[0]).map(normalizeHeader);
  return lines
    .slice(1)
    .map((line) => {
      const fields = csvSplit(line).map((value) => value.replace(/^"|"$/g, ""));
      const row = baseRow("", null);
      headers.forEach((header, index) => {
        const target = csvFieldAliases[header];
        const value = fields[index]?.trim();
        if (!target || !value) return;
        if (target === "email") {
          row.email = value.toLowerCase();
          row.email_status = "present";
          row.email_confidence = 1;
        } else if (target === "name") {
          row.name = value;
        } else if (target === "source_link") {
          row.source_link = value;
        } else if (target === "notes") {
          row.notes = value;
        } else if (target === "language") {
          row.language = value;
        } else if (target === "company") {
          row.company = value;
        } else if (target === "city") {
          row.city = value;
        }
      });
      return row;
    })
    .filter((row) => row.name || row.email || row.company);
};

const parseJson = (text: string): ParsedRow[] => {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
    )
    .map((entry) => {
      const row = baseRow(
        typeof entry.name === "string" ? entry.name.trim() : "",
        typeof entry.email === "string" && entry.email.trim()
          ? entry.email.trim().toLowerCase()
          : null
      );
      const sourceLink = entry.source_link ?? entry.sourceLink;
      if (typeof sourceLink === "string" && sourceLink.trim()) {
        row.source_link = sourceLink.trim();
      }
      if (typeof entry.notes === "string" && entry.notes.trim()) {
        row.notes = entry.notes.trim();
      }
      if (typeof entry.language === "string" && entry.language.trim()) {
        row.language = entry.language.trim();
      }
      if (typeof entry.company === "string" && entry.company.trim()) {
        row.company = entry.company.trim();
      }
      if (typeof entry.city === "string" && entry.city.trim()) {
        row.city = entry.city.trim();
      }
      return row;
    })
    .filter((row) => row.name || row.email || row.company);
};

const extractFromFreeText = (text: string): ParsedRow[] => {
  const seenEmails = new Set<string>();
  const seenNames = new Map<string, ParsedRow>();
  const rows: ParsedRow[] = [];
  const lines = text.split(/[\n\r]+/).map(sanitizeLine);

  lines.forEach((line, index) => {
    if (!line) return;
    const urlMatches = Array.from(line.matchAll(URL_REGEX)).map(
      (match) => match[0]
    );
    let emailMatch: RegExpExecArray | null;
    EMAIL_REGEX.lastIndex = 0;
    let foundEmailInLine = false;
    while ((emailMatch = EMAIL_REGEX.exec(line)) !== null) {
      const email = emailMatch[0].toLowerCase();
      if (seenEmails.has(email)) continue;
      seenEmails.add(email);
      foundEmailInLine = true;
      const before = line.slice(0, emailMatch.index);
      let nameCandidate = before.match(NAME_TAIL_REGEX)?.[1]?.trim() ?? "";
      if (!nameCandidate && index > 0) {
        nameCandidate = lines[index - 1].match(NAME_TAIL_REGEX)?.[1]?.trim() ?? "";
      }
      const row = baseRow(nameCandidate || "(senza nome)", email);
      if (urlMatches[0]) row.source_link = urlMatches[0];
      rows.push(row);
    }
    if (!foundEmailInLine) return;
  });

  if (rows.length === 0) {
    // Fallback name-only.
    const cleaned = text.replace(/\b[A-ZÀ-Ý]{2,}(?:\s+[A-ZÀ-Ý]{2,})*\b/g, " ");
    NAME_ONLY_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = NAME_ONLY_REGEX.exec(cleaned)) !== null) {
      const candidate = match[1].replace(/\s+/g, " ").trim();
      const parts = candidate.split(/\s+/);
      if (parts.length < 2) continue;
      if (parts.some((part) => SKIP_NAME_TOKENS.has(part))) continue;
      if (/\d/.test(candidate)) continue;
      if (candidate.length > 80) continue;
      const key = candidate.toLowerCase();
      if (seenNames.has(key)) continue;
      const row = baseRow(candidate, null);
      seenNames.set(key, row);
    }
    return [...seenNames.values()];
  }

  return rows;
};

const parseFile = async (file: File): Promise<FileReport> => {
  const fileName = file.name;
  const lowerName = fileName.toLowerCase();
  const fileType = file.type || "unknown";
  const report: FileReport = {
    file_name: fileName,
    file_type: fileType,
    status: "error",
    rows: [],
    errors: [],
    raw_text: null,
  };

  try {
    let rows: ParsedRow[] = [];

    if (lowerName.endsWith(".json") || fileType === "application/json") {
      rows = parseJson(await file.text());
    } else if (lowerName.endsWith(".csv") || fileType === "text/csv") {
      rows = parseCsv(await file.text());
    } else if (lowerName.endsWith(".pdf") || fileType === "application/pdf") {
      const buffer = new Uint8Array(await file.arrayBuffer());
      const { text, directors } = await parseDirectorsPdf(buffer);
      console.log(
        `[import-pdf] ${fileName}: bytes=${buffer.length} registi=${directors.length} testo=${text.length}`
      );
      if (!text.trim() && directors.length === 0) {
        report.status = "file_not_readable";
        report.errors.push(
          "Il PDF non contiene testo estraibile (forse è scansionato senza OCR)."
        );
        return report;
      }
      report.raw_text = text;
      if (directors.length > 0) {
        // Parser tabellare posizionale: una riga per regista, col film come
        // company e sezione/paese/anno nelle note. Niente più nomi spezzati.
        rows = directors.map((d) => {
          const row = baseRow(d.name, null);
          row.company = d.film;
          row.notes = d.context;
          return row;
        });
      } else {
        // PDF non tabellare: vecchia estrazione a testo libero (email-first).
        rows = extractFromFreeText(text);
      }
    } else if (
      lowerName.endsWith(".txt") ||
      fileType.startsWith("text/")
    ) {
      const text = await file.text();
      report.raw_text = text;
      rows = extractFromFreeText(text);
    } else {
      report.status = "error";
      report.errors.push(
        `Formato non supportato: ${fileType || fileName}. Usa PDF, TXT, JSON o CSV.`
      );
      return report;
    }

    if (rows.length === 0) {
      report.status = "needs_review";
      report.errors.push(
        "Nessun contatto rilevato automaticamente. Verifica il contenuto del file."
      );
      return report;
    }

    report.status = "parsed";
    report.rows = rows;
    return report;
  } catch (error) {
    report.status = "error";
    report.errors.push(
      error instanceof Error
        ? error.message
        : "Errore inatteso durante la lettura del file."
    );
    return report;
  }
};

export async function POST(request: Request) {
  try {
    await requireCurrentUser();
    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json(
        { error: "Form data non valido." },
        { status: 400 }
      );
    }
    const files = formData
      .getAll("file")
      .concat(formData.getAll("files"))
      .filter((value): value is File => value instanceof File);

    if (files.length === 0) {
      return NextResponse.json(
        { error: "Nessun file ricevuto." },
        { status: 400 }
      );
    }

    const reports = await Promise.all(files.map(parseFile));
    return NextResponse.json({ files: reports });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(
      "POST /api/contacts/import-directors-files failed",
      error
    );
    return NextResponse.json(
      { error: "Parsing fallito. Riprova." },
      { status: 500 }
    );
  }
}
