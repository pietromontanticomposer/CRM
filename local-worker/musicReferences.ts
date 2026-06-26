/**
 * LIBRERIA RIFERIMENTI MUSICALI — selezione DETERMINISTICA (zero AI).
 * Pietro+codex 2026-06-11.
 *
 * Perché esiste: l'AI, lasciata scegliere i 3 riferimenti musicali, pescava
 * sempre i titoli "indie di prestigio" più abusati (Nomadland, Minari, The
 * Revenant) e rischiava attribuzioni compositore sbagliate. Risultato: dozzinale
 * e pericoloso. Qui la scelta la fa il CODICE, da una lista curata e VERIFICATA
 * a mano (ogni voce ha la sua `sourceUrl`), taggata per tono. L'AI NON sceglie
 * più i riferimenti.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  MODIFICA QUI il tuo gusto, Pietro:
 *   - aggiungi voci (titolo, compositore VERIFICATO + sourceUrl, tag);
 *   - metti `approved: true` su quelle che ami, `disabled: true` per escluderle;
 *   - alza `weight` (es. 1.5) per farle uscire più spesso.
 *  Regola ferrea: NESSUNA voce senza `sourceUrl` (un compositore sbagliato è una
 *  figuraccia). Il test `musicLibrary.test.ts` lo impedisce.
 * ════════════════════════════════════════════════════════════════════════════
 */

export type MusicRef = {
  title: string;
  composer: string;
  tags: string[];
  weight?: number; // default 1; alza per farla preferire
  sourceUrl: string; // fonte della verifica compositore (OBBLIGATORIA)
  verifiedAt: string;
  approved?: boolean; // true = approvata da Pietro (preferita)
  disabled?: boolean; // true = mai usare
};

// 23 colonne sonore RICONOSCIBILI (film/serie noti) con compositori verificati,
// taggate per tono. Aggiornata 2026-06-26 (confronto con codex + web): i registi
// devono RICONOSCERE i riferimenti, restando di gusto (no nicchia, no cheesy).
export const MUSIC_LIBRARY: MusicRef[] = [
  // — intimo / memoria / lutto / famiglia —
  { title: "Moonlight", composer: "Nicholas Britell", tags: ["intimo", "identita", "memoria", "urbano"], weight: 1.2, sourceUrl: "https://en.wikipedia.org/wiki/Moonlight_(soundtrack)", verifiedAt: "2026-06-26" },
  { title: "The Hours", composer: "Philip Glass", tags: ["intimo", "memoria", "lutto", "contemplativo"], weight: 1.1, sourceUrl: "https://en.wikipedia.org/wiki/The_Hours_(soundtrack)", verifiedAt: "2026-06-26" },
  { title: "Aftersun", composer: "Oliver Coates", tags: ["intimo", "memoria", "famiglia", "lutto", "contemplativo"], weight: 1.2, sourceUrl: "https://en.wikipedia.org/wiki/Aftersun", verifiedAt: "2026-06-26" },
  { title: "Minari", composer: "Emile Mosseri", tags: ["famiglia", "rurale", "intimo", "identita"], weight: 1.0, sourceUrl: "https://en.wikipedia.org/wiki/Minari_(soundtrack)", verifiedAt: "2026-06-26" },
  // — sociale / realista / urbano —
  { title: "Parasite", composer: "Jung Jae-il", tags: ["sociale", "famiglia", "tensione", "morale"], weight: 1.2, sourceUrl: "https://en.wikipedia.org/wiki/Parasite_(2019_film)", verifiedAt: "2026-06-26" },
  { title: "Nomadland", composer: "Ludovico Einaudi", tags: ["sociale", "viaggio", "intimo", "identita"], weight: 1.2, sourceUrl: "https://en.wikipedia.org/wiki/Nomadland", verifiedAt: "2026-06-26" },
  { title: "The Social Network", composer: "Trent Reznor & Atticus Ross", tags: ["sociale", "lavoro", "identita", "tensione"], weight: 1.2, sourceUrl: "https://en.wikipedia.org/wiki/The_Social_Network_(soundtrack)", verifiedAt: "2026-06-26" },
  // — natura / documentario / paesaggio —
  { title: "Planet Earth II", composer: "Hans Zimmer, Jacob Shea & Jasha Klebe", tags: ["natura", "ambiente", "osservativo", "montagna"], weight: 1.3, sourceUrl: "https://en.wikipedia.org/wiki/Planet_Earth_II", verifiedAt: "2026-06-26" },
  { title: "Our Planet", composer: "Steven Price", tags: ["natura", "ambiente", "osservativo"], weight: 1.1, sourceUrl: "https://en.wikipedia.org/wiki/Our_Planet", verifiedAt: "2026-06-26" },
  { title: "The Tree of Life", composer: "Alexandre Desplat", tags: ["natura", "spirituale", "memoria", "contemplativo"], weight: 1.1, sourceUrl: "https://en.wikipedia.org/wiki/The_Tree_of_Life_(soundtrack)", verifiedAt: "2026-06-26" },
  // — montagna / avventura / sopravvivenza —
  { title: "The Revenant", composer: "Ryuichi Sakamoto, Alva Noto & Bryce Dessner", tags: ["sopravvivenza", "natura", "montagna", "tensione"], weight: 1.3, sourceUrl: "https://en.wikipedia.org/wiki/The_Revenant_(soundtrack)", verifiedAt: "2026-06-26" },
  { title: "Free Solo", composer: "Marco Beltrami", tags: ["montagna", "scalata", "sopravvivenza", "tensione"], weight: 1.0, sourceUrl: "https://en.wikipedia.org/wiki/Free_Solo_(soundtrack)", verifiedAt: "2026-06-26" },
  { title: "Into the Wild", composer: "Michael Brook, Kaki King & Eddie Vedder", tags: ["viaggio", "natura", "identita", "rurale"], weight: 1.0, sourceUrl: "https://en.wikipedia.org/wiki/Into_the_Wild_(film)", verifiedAt: "2026-06-26" },
  { title: "Everest", composer: "Dario Marianelli", tags: ["montagna", "scalata", "sopravvivenza", "tensione"], weight: 1.0, sourceUrl: "https://en.wikipedia.org/wiki/Everest_(2015_film)", verifiedAt: "2026-06-26" },
  // — storico / epico / mito / antichità —
  { title: "Gladiator", composer: "Hans Zimmer & Lisa Gerrard", tags: ["storia", "epico", "antichita", "morale", "tensione"], weight: 1.2, sourceUrl: "https://en.wikipedia.org/wiki/Gladiator_(2000_soundtrack)", verifiedAt: "2026-06-26" },
  { title: "The Last Emperor", composer: "Ryuichi Sakamoto, David Byrne & Cong Su", tags: ["storia", "antichita", "memoria", "morale"], weight: 1.0, sourceUrl: "https://en.wikipedia.org/wiki/The_Last_Emperor_(album)", verifiedAt: "2026-06-26" },
  { title: "The Mission", composer: "Ennio Morricone", tags: ["storia", "epico", "sacro", "spirituale", "morale"], weight: 1.2, sourceUrl: "https://en.wikipedia.org/wiki/The_Mission_(soundtrack)", verifiedAt: "2026-06-26" },
  { title: "1492: Conquest of Paradise", composer: "Vangelis", tags: ["storia", "epico", "viaggio", "spirituale"], weight: 1.1, sourceUrl: "https://en.wikipedia.org/wiki/1492:_Conquest_of_Paradise_(album)", verifiedAt: "2026-06-26" },
  // — tensione / thriller / crime —
  { title: "Sicario", composer: "Jóhann Jóhannsson", tags: ["tensione", "sopravvivenza", "sociale"], weight: 1.2, sourceUrl: "https://en.wikipedia.org/wiki/Sicario_(soundtrack)", verifiedAt: "2026-06-26" },
  { title: "There Will Be Blood", composer: "Jonny Greenwood", tags: ["tensione", "storia", "morale", "rurale"], weight: 1.1, sourceUrl: "https://en.wikipedia.org/wiki/There_Will_Be_Blood_(soundtrack)", verifiedAt: "2026-06-26" },
  { title: "Oppenheimer", composer: "Ludwig Göransson", tags: ["storia", "scienza", "tensione", "morale"], weight: 1.2, sourceUrl: "https://en.wikipedia.org/wiki/Oppenheimer_(soundtrack)", verifiedAt: "2026-06-26" },
  // — serie TV note —
  { title: "Chernobyl", composer: "Hildur Guðnadóttir", tags: ["tensione", "scienza", "storia", "sociale"], weight: 1.2, sourceUrl: "https://en.wikipedia.org/wiki/Chernobyl_(soundtrack)", verifiedAt: "2026-06-26" },
  { title: "Succession", composer: "Nicholas Britell", tags: ["sociale", "lavoro", "morale", "identita"], weight: 1.1, sourceUrl: "https://en.wikipedia.org/wiki/Succession_(soundtrack)", verifiedAt: "2026-06-26" },
];

// Set di FALLBACK elegante (codex): se il film non matcha bene nessun tono,
// meglio 3 riferimenti eleganti e versatili che 3 "precisi" fuori tono.
const FALLBACK_TITLES = ["Moonlight", "The Tree of Life", "The Hours"];

// ── Rilevamento tono dal testo del film (sinossi+titolo+note), bilingue ──
const TAG_RULES: Array<{ tag: string; re: RegExp }> = [
  { tag: "sociale", re: /povert|sfratt|abitativ|alloggio|lavorat|operai|disoccup|precari|salari|stipendio|social|welfare|housing|eviction|poverty|labou?r|working[- ]class|inequal/i },
  { tag: "poverta", re: /povert|sfratt|miseria|poverty|destitut|homeless/i },
  { tag: "lavoro", re: /lavorat|operai|fabbrica|sindacat|disoccup|precari|worker|factory|union|gig economy|employ/i },
  { tag: "migrazione", re: /migrant|rifugiat|profugh|immigrat|frontiera|refugee|migrant|border|exile/i },
  { tag: "infanzia", re: /bambin|infanz|ragazzin|minore|child|kid|childhood|young girl|young boy/i },
  { tag: "montagna", re: /montagn|vetta|cima|alpin|ghiacc|vertic|parete|mountain|alpine|summit|peak|glacier|ascent|ridge/i },
  { tag: "scalata", re: /scalat|arrampic|alpinis|climb|climber|mountaineer|ascensione/i },
  { tag: "sopravvivenza", re: /sopravviv|survival|survive|estrem|life[- ]threatening|al limite/i },
  { tag: "natura", re: /natur|animal|fauna|selvatic|foresta|bosco|ambient|clima|ecolog|specie|wildlife|nature|forest|environment|climate|wilderness|landscape|paesaggio/i },
  { tag: "oceano", re: /ocean|mare\b|marino|subacque|scoglier|sea\b|underwater|reef|coast/i },
  { tag: "ambiente", re: /ambient|clima|ecolog|inquinam|environment|climate|ecolog|pollution|sustainab/i },
  { tag: "scienza", re: /scienz|scientif|vulcan|ricercator|science|scientist|research|volcano|biolog/i },
  { tag: "viaggio", re: /viaggio|cammino|attravers|percorso\b|bici|biciclet|nomad|on the road|journey|road trip|travel|crossing|ride across|trek/i },
  { tag: "strada", re: /strada|road|highway|on the road/i },
  { tag: "intimo", re: /intim|personal|privat|interior|intimate|personal|inner/i },
  { tag: "memoria", re: /memoria|ricord|passato|memory|remembrance|nostalg/i },
  { tag: "lutto", re: /lutto|perdita|morte|grief|loss|mourning|death|bereave/i },
  { tag: "famiglia", re: /famigl|padre|madre|figli|genitor|family|father|mother|daughter|son|parent/i },
  { tag: "rurale", re: /rural|campagn|contadin|pastor|villaggio|malga|alpeggio|farm|village|countryside|peasant|shepherd/i },
  { tag: "spirituale", re: /spiritual|fede|sacro|preghier|spiritual|faith|sacred|prayer|soul/i },
  { tag: "morale", re: /moral|coscienz|etic|resist|sacrific|conscience|moral|resistance|dignit/i },
  { tag: "osservativo", re: /senza parole|silenz|contemplat|osserva|lento|wordless|silent|contemplat|observational|meditative|slow cinema/i },
  { tag: "identita", re: /identit|chi è|chi sono|ritrovar|identity|self|who he is|who she is|coming of age/i },
  { tag: "storia", re: /stori[ac]|antichit|antico|antichi|epoca|secol|millenni|medioev|romaniz|impero|civilt|reperto|archeolog|veneti|etrusch|histor|ancient|medieval|empire|civili[sz]ation|archaeolog/i },
  { tag: "epico", re: /epico|epopea|mito|mitolog|leggend|saga|eroe|epic|myth|legend|heroic/i },
  { tag: "antichita", re: /antichit|antico|antichi|veneti|etrusch|roman|greco|celt|ancient|etruscan|tribe|tribù/i },
];

const detectTags = (filmText: string): Set<string> => {
  const tags = new Set<string>();
  for (const { tag, re } of TAG_RULES) if (re.test(filmText)) tags.add(tag);
  return tags;
};

/**
 * Sceglie n (default 3) riferimenti musicali, in modo DETERMINISTICO, dal testo
 * del film. Zero AI. Diversità: mai due dello stesso compositore. Se nessun tono
 * matcha bene (sotto soglia), usa il set di fallback elegante.
 */
// Tag SPECIFICI: pesano il doppio dei generici (natura/sociale/intimo). (codex)
const STRONG_TAGS = new Set([
  "scalata", "sopravvivenza", "oceano", "infanzia", "lutto", "migrazione",
  "scienza", "viaggio", "spirituale", "resistenza", "rurale", "tradizione",
  "storia", "epico", "antichita", "mito",
]);

// Energia di una voce (dedotta dai tag) e del film (dal testo): una colonna
// "tesa" su un film "calmo/contemplativo" stona → penalità. (codex)
const entryEnergy = (m: MusicRef): "teso" | "calmo" | "neutro" => {
  if (m.tags.some((t) => ["tensione", "sopravvivenza", "scalata", "avventura"].includes(t)))
    return "teso";
  if (m.tags.some((t) => ["contemplativo", "intimo", "tenero", "osservativo", "sacro"].includes(t)))
    return "calmo";
  return "neutro";
};
const TENSE_RE = /tension|estrem|pericol|sopravviv|thriller|adrenalin|vertic|mortale|survival|danger|extreme|race against|al limite/i;
const CALM_RE = /contemplat|silenz|senza parole|lento|intim|delicat|quiet|wordless|meditative|slow|tender|poetic/i;
const detectFilmEnergy = (t: string): "teso" | "calmo" | "neutro" =>
  CALM_RE.test(t) ? "calmo" : TENSE_RE.test(t) ? "teso" : "neutro";

// Classifica TUTTA la libreria per coerenza col film (deterministico). Base sia
// per la scelta deterministica (fallback) sia per la shortlist passata all'AI.
const rankMusicReferences = (filmText: string): MusicRef[] => {
  const pool = MUSIC_LIBRARY.filter((m) => !m.disabled);
  const text = filmText || "";
  const tags = detectTags(text);
  const filmEnergy = detectFilmEnergy(text);

  const scored = pool
    .map((m) => {
      const matched = m.tags.filter((t) => tags.has(t));
      const strong = matched.filter((t) => STRONG_TAGS.has(t)).length;
      const weighted = matched.reduce(
        (s, t) => s + (STRONG_TAGS.has(t) ? 2 : 1),
        0
      );
      const e = entryEnergy(m);
      const penalty =
        filmEnergy === "calmo" && e === "teso"
          ? 3
          : filmEnergy === "teso" && e === "calmo"
            ? 1.5
            : 0;
      const score = weighted * (m.weight ?? 1) + (m.approved ? 1 : 0) - penalty;
      return { m, matched: matched.length, strong, score };
    })
    .sort((a, b) => b.score - a.score || (b.m.weight ?? 1) - (a.m.weight ?? 1));

  // SOGLIA DI CONFIDENZA (codex): si usa il match per tono SOLO se almeno una
  // voce ha ≥1 tag FORTE oppure ≥2 tag. Altrimenti fallback elegante.
  const qualifies = scored.some((s) => s.strong >= 1 || s.matched >= 2);
  return qualifies
    ? scored.map((s) => s.m)
    : FALLBACK_TITLES.map((t) => pool.find((m) => m.title === t)!).filter(Boolean);
};

// id stabile per ogni voce (slug del titolo): usato dallo scrittore + validazione.
export const refIdOf = (m: MusicRef): string =>
  m.title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// Shortlist VERIFICATA per l'AI: le top-k voci piu' coerenti col film. Lo
// scrittore sceglie i 3 migliori SOLO da qui (non puo' inventare).
export const shortlistMusicReferences = (filmText: string, k = 8): MusicRef[] =>
  rankMusicReferences(filmText).slice(0, k);

// Risolve gli id scelti dallo scrittore in refs VERIFICATE. Valido SOLO se: 3 id
// distinti, tutti presenti nella `allowed` (la SHORTLIST passata allo scrittore,
// non l'intera libreria) e con compositori diversi. Altrimenti null -> fallback
// deterministico. Cosi' lo scrittore non puo' uscire dalla shortlist.
export const resolveRefsByIds = (
  ids: unknown,
  allowed: MusicRef[]
): MusicRef[] | null => {
  if (!Array.isArray(ids) || !Array.isArray(allowed) || allowed.length === 0)
    return null;
  const clean = [
    ...new Set(
      ids
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().toLowerCase())
    ),
  ];
  if (clean.length !== 3) return null;
  const found = clean
    .map((id) => allowed.find((m) => !m.disabled && refIdOf(m) === id))
    .filter((m): m is MusicRef => Boolean(m));
  const distinctComposers =
    new Set(found.map((m) => m.composer)).size === found.length;
  return found.length === 3 && distinctComposers ? found : null;
};

// Scelta DETERMINISTICA (fallback): top-3 con compositori diversi.
export const pickMusicReferences = (
  filmText: string,
  n = 3
): MusicRef[] => {
  const ordered = rankMusicReferences(filmText);
  const pool = MUSIC_LIBRARY.filter((m) => !m.disabled);

  const chosen: MusicRef[] = [];
  const usedComposers = new Set<string>();
  for (const m of ordered) {
    if (chosen.length >= n) break;
    if (usedComposers.has(m.composer)) continue; // diversità compositore
    chosen.push(m);
    usedComposers.add(m.composer);
  }
  // riempi se per qualche motivo siamo sotto n (lista corta): pesca dal fallback
  if (chosen.length < n) {
    for (const t of FALLBACK_TITLES) {
      if (chosen.length >= n) break;
      const m = pool.find((x) => x.title === t);
      if (m && !usedComposers.has(m.composer)) {
        chosen.push(m);
        usedComposers.add(m.composer);
      }
    }
  }
  return chosen.slice(0, n);
};

// "Titolo (Compositore), Titolo (Compositore), Titolo (Compositore)"
export const formatMusicReferences = (refs: MusicRef[]): string =>
  refs.map((r) => `${r.title} (${r.composer})`).join(", ");

/**
 * Inietta nel corpo della mail i 3 riferimenti SCELTI DAL CODICE (zero AI).
 * Lo scrittore lascia il placeholder `{{MUSICAL_REFS}}`; qui lo sostituiamo.
 * Fallback robusto: se il placeholder manca (lo scrittore ha disobbedito) ma
 * c'è la frase "ispirato a …" / "inspired by …", sostituiamo la lista lì dentro.
 * filmText = sinossi + titolo + note del film, per scegliere il tono.
 */
const PLACEHOLDER = /\{\{\s*MUSICAL_REFS\s*\}\}/g;
// Inietta una STRINGA di riferimenti già pronta ("Titolo (Comp), ...") nel body.
export const injectRefsString = (body: string, refsString: string): string => {
  const refs = refsString || "un sound originale tarato sul tono del progetto";
  // 1) Caso normale: c'è il placeholder (tollerante a spazi). Lo sostituisco.
  if (/\{\{\s*MUSICAL_REFS\s*\}\}/.test(body)) {
    return body.replace(PLACEHOLDER, refs);
  }
  // 2) Niente placeholder: sostituisco ciò che segue "ispirato a"/"inspired by"
  //    fino al punto o a fine riga (robusto anche senza punto finale).
  let out = body.replace(/(ispirato a\s+)[^.\n]*/i, `$1${refs}`);
  if (out === body)
    out = body.replace(/(inspired by\s+)[^.\n]*/i, `$1${refs}`);
  // 3) GARANZIA: nessun placeholder deve mai restare nella mail spedita.
  out = out.replace(PLACEHOLDER, refs);
  return out;
};

// Wrapper DETERMINISTICO (zero AI): sceglie i 3 col codice e li inietta. Usato
// come fallback quando lo scrittore non fornisce una scelta valida.
export const injectMusicReferences = (
  body: string,
  filmText: string
): string =>
  injectRefsString(body, formatMusicReferences(pickMusicReferences(filmText)));
