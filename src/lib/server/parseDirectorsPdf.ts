import { extractText, getDocumentProxy } from "unpdf";

// Parser POSIZIONALE per cataloghi/tabelle di festival (es. "ELENCO REGISTI").
// Problema risolto: unpdf con mergePages butta tutta la tabella su una riga
// sola, e il vecchio parser a regex spaccava i nomi ("Boue Jean-" / "Gabriel
// Leynaud"). Qui usiamo le coordinate x/y di ogni testo (pdf.js) per
// ricostruire le colonne reali e leggere la colonna REGISTA/I esatta.
//
// Celle multi-riga (registi/paesi lunghi che vanno a capo): la riga "orfana"
// viene assegnata al numero di riga (#) con la y PIU' VICINA, non semplicemente
// al record precedente — altrimenti un regista a capo finiva attribuito al film
// sopra (bug "Laurent dans le vent" / "142 secondi").

export type DirectorRow = {
  name: string;
  film: string | null;
  context: string | null;
};

type PdfItem = { x: number; y: number; str: string };
type RawLine = { page: number; y: number; cells: PdfItem[] };
type DataLine = { page: number; y: number; col: Record<ColKey, string[]> };

type ColKey =
  | "num"
  | "title"
  | "director"
  | "section"
  | "country"
  | "year"
  | "dur";

type ColAnchors = Record<ColKey, number>;

const COL_KEYS: ColKey[] = [
  "num",
  "title",
  "director",
  "section",
  "country",
  "year",
  "dur",
];

const NOISE_LINE =
  /(fonte\s*:|dato non disponibile|programma totale|elenco completo|film da \d+\s+paesi|trento film festival|^\s*#\s*$)/i;

// Raggruppa gli item in righe visive per coordinata y (tolleranza 2px: le due
// baseline di una stessa riga — numero/anno/durata vs titolo/regista — distano
// ~1px e vanno unite; una riga "a capo" di una cella dista di piu' e resta a se').
const groupLines = (items: PdfItem[]): { y: number; cells: PdfItem[] }[] => {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const lines: { y: number; cells: PdfItem[] }[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= 2) last.cells.push(it);
    else lines.push({ y: it.y, cells: [it] });
  }
  return lines;
};

const findAnchors = (lines: { cells: PdfItem[] }[]): ColAnchors | null => {
  for (const line of lines) {
    const joined = line.cells.map((c) => c.str).join(" ").toUpperCase();
    if (!(joined.includes("TITOLO") && joined.includes("REGISTA"))) continue;
    const xOf = (pred: (s: string) => boolean) => {
      const hit = line.cells.find((c) => pred(c.str.toUpperCase().trim()));
      return hit ? hit.x : null;
    };
    const title = xOf((s) => s.includes("TITOLO"));
    const director = xOf((s) => s.includes("REGISTA"));
    const section = xOf((s) => s.includes("SEZIONE"));
    const country = xOf((s) => s.includes("PAESE"));
    const year = xOf((s) => s.includes("ANNO"));
    const num = xOf((s) => s === "#");
    const dur = xOf((s) => s.includes("DUR"));
    if (
      title != null &&
      director != null &&
      section != null &&
      country != null &&
      year != null
    ) {
      return {
        num: num ?? title - 24,
        title,
        director,
        section,
        country,
        year,
        dur: dur ?? year + 28,
      };
    }
  }
  return null;
};

// Assegna un item alla colonna la cui ancora x e' la piu' grande <= x (+6px).
const assignColumn = (x: number, a: ColAnchors): ColKey => {
  let best: ColKey = "title";
  let bestAnchor = -Infinity;
  for (const key of COL_KEYS) {
    const ax = a[key];
    if (ax <= x + 6 && ax > bestAnchor) {
      best = key;
      bestAnchor = ax;
    }
  }
  return best;
};

// Spezza una cella REGISTA/I in registi singoli.
// - Sempre sulla VIRGOLA: "A, B, C" -> 3.
// - Sull'"&" SOLO se entrambi i lati sono NOMI COMPLETI (≥2 parole): cosi'
//   "Alice Rossi & Marco Bianchi" -> 2 registi, ma un duo a cognome singolo come
//   "Zhang & Knight" resta UN UNICO contatto (spezzarlo dava due righe inutili
//   "Zhang"/"Knight", impossibili da cercare). (regola affinata con codex 2026-06-11)
// - NON spezza i nomi con trattino ("Jean-Gabriel Leynaud").
const isFullName = (s: string): boolean =>
  s.trim().split(/\s+/).filter(Boolean).length >= 2;
const splitDirectors = (raw: string): string[] => {
  const out: string[] = [];
  for (const part of raw.split(/\s*,\s*/)) {
    const cell = part.replace(/\s+/g, " ").trim();
    const amp = cell.split(/\s+&\s+/);
    // splitta sull'& solo se TUTTI i pezzi sembrano nomi completi
    if (amp.length > 1 && amp.every(isFullName)) out.push(...amp.map((s) => s.trim()));
    else out.push(cell);
  }
  return out.filter((s) => s.length > 1 && !/^n\/?d$/i.test(s));
};

// Sezioni di OMAGGIO/retrospettiva: classici e registi celebri (spesso deceduti)
// a cui il festival rende omaggio. NON sono contatti per cold outreach (es.
// Sydney Pollack, Robert Redford con film del 1979/1998): si scartano all'import
// cosi' non sporcano il batch ne' bruciano quota AI. Lista conservativa: solo
// "omaggio/tributo/retrospettiva", NON "classici/restauro" (potrebbero essere
// opere restaurate di registi vivi e contattabili).
const HOMAGE_SECTION = /omaggio|retrospettiv|tributo|in\s*memoria|tribute|homage/i;

export const parseDirectorsPdf = async (
  data: Uint8Array
): Promise<{ text: string; directors: DirectorRow[] }> => {
  const document = await getDocumentProxy(data);

  // Testo grezzo (fallback per PDF non tabellari).
  let text = "";
  try {
    const { text: raw } = await extractText(document, { mergePages: true });
    text = Array.isArray(raw) ? raw.join("\n") : raw || "";
  } catch {
    text = "";
  }

  const directors: DirectorRow[] = [];
  try {
    const rawLines: RawLine[] = [];
    const numPages: number = document.numPages;
    for (let p = 1; p <= numPages; p += 1) {
      const page = await document.getPage(p);
      const content = await page.getTextContent();
      const items: PdfItem[] = [];
      for (const it of content.items as {
        str?: string;
        transform?: number[];
      }[]) {
        if (!it.str || !it.str.trim() || !it.transform) continue;
        items.push({ x: it.transform[4], y: it.transform[5], str: it.str });
      }
      for (const line of groupLines(items))
        rawLines.push({ page: p, y: line.y, cells: line.cells });
    }

    const anchors = findAnchors(rawLines);
    if (anchors) {
      // 1) Trasforma le righe utili in righe-con-colonne (saltando header/rumore).
      const dataLines: DataLine[] = [];
      let seenHeader = false;
      for (const rl of rawLines) {
        const joined = rl.cells.map((c) => c.str).join(" ").trim();
        if (!joined) continue;
        const upper = joined.toUpperCase();
        if (upper.includes("TITOLO") && upper.includes("REGISTA")) {
          seenHeader = true;
          continue;
        }
        if (!seenHeader) continue;
        if (NOISE_LINE.test(joined)) continue;
        const col: Record<ColKey, string[]> = {
          num: [],
          title: [],
          director: [],
          section: [],
          country: [],
          year: [],
          dur: [],
        };
        for (const cell of [...rl.cells].sort((a, b) => a.x - b.x))
          col[assignColumn(cell.x, anchors)].push(cell.str.trim());
        dataLines.push({ page: rl.page, y: rl.y, col });
      }

      // 2) Le righe con un # valido sono i record; le altre (celle a capo) si
      //    agganciano al record con la y piu' vicina nella stessa pagina.
      const anchorIdx: number[] = [];
      dataLines.forEach((l, i) => {
        if (/^\d{1,3}$/.test(l.col.num.join(" ").trim())) anchorIdx.push(i);
      });
      const groups = new Map<number, DataLine[]>();
      for (const ai of anchorIdx) groups.set(ai, [dataLines[ai]]);
      for (let i = 0; i < dataLines.length; i += 1) {
        if (groups.has(i)) continue;
        const l = dataLines[i];
        let bestAi = -1;
        let bestDist = Infinity;
        for (const ai of anchorIdx) {
          const a = dataLines[ai];
          if (a.page !== l.page) continue;
          const d = Math.abs(a.y - l.y);
          if (d < bestDist) {
            bestDist = d;
            bestAi = ai;
          }
        }
        if (bestAi >= 0) groups.get(bestAi)!.push(l);
      }

      // 3) Costruisci i registi (una riga per regista).
      const seen = new Set<string>();
      for (const ai of anchorIdx) {
        const lines = groups.get(ai)!.slice().sort((a, b) => b.y - a.y);
        const colJoin = (k: ColKey) =>
          lines
            .map((l) => l.col[k].join(" "))
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        const title = colJoin("title");
        const section = colJoin("section");
        // Salta gli OMAGGIO/retrospettive SOLO se il film è anche VECCHIO
        // (≥15 anni fa): così si scartano i classici (Pollack 1979, Redford 1998)
        // ma si TIENE un eventuale omaggio a un regista vivo con un film recente
        // — che è contattabile. (regola affinata con codex 2026-06-11)
        const filmYear = parseInt(colJoin("year").replace(/[^0-9]/g, "").slice(0, 4), 10);
        const isOldFilm =
          Number.isFinite(filmYear) &&
          filmYear > 1900 &&
          filmYear < new Date().getFullYear() - 15;
        if (HOMAGE_SECTION.test(section) && isOldFilm) continue;
        const director = colJoin("director");
        const names = splitDirectors(director);
        if (names.length === 0) continue;
        const context =
          [title, section, colJoin("country"), colJoin("year")]
            .map((v) => v.trim())
            .filter(Boolean)
            .join(" · ") || null;
        for (const name of names) {
          const key = `${name.toLowerCase()}|${title.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          directors.push({ name, film: title || null, context });
        }
      }
    }
  } catch {
    directors.length = 0;
  }

  return { text, directors };
};
