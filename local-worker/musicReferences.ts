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

// 16 voci verificate a mano via web (2026-06-11), non-cliché, pesate su film
// tipo-Trento (montagna, natura, ambiente, sociale, intimo, viaggio).
export const MUSIC_LIBRARY: MusicRef[] = [
  // — natura / fauna / ambiente / osservazione —
  { title: "The Velvet Queen", composer: "Warren Ellis & Nick Cave", tags: ["natura", "fauna", "montagna", "contemplativo", "osservativo"], weight: 1.3, sourceUrl: "https://en.wikipedia.org/wiki/The_Velvet_Queen", verifiedAt: "2026-06-11" },
  { title: "Fire of Love", composer: "Nicolas Godin", tags: ["natura", "scienza", "ambiente", "poetico", "avventura", "passione"], weight: 1.2, sourceUrl: "https://en.wikipedia.org/wiki/Fire_of_Love_(2022_film)", verifiedAt: "2026-06-11" },
  { title: "All That Breathes", composer: "Roger Goula", tags: ["natura", "fauna", "ambiente", "urbano", "sociale", "osservativo"], weight: 1.1, sourceUrl: "https://en.wikipedia.org/wiki/All_That_Breathes", verifiedAt: "2026-06-11" },
  { title: "Cave of Forgotten Dreams", composer: "Ernst Reijseger", tags: ["natura", "sacro", "contemplativo", "montagna", "corale", "archeologia"], weight: 1.3, sourceUrl: "https://en.wikipedia.org/wiki/Cave_of_Forgotten_Dreams", verifiedAt: "2026-06-11" },
  { title: "My Octopus Teacher", composer: "Kevin Smuts", tags: ["natura", "fauna", "oceano", "intimo", "contemplativo"], weight: 1.0, sourceUrl: "https://en.wikipedia.org/wiki/My_Octopus_Teacher", verifiedAt: "2026-06-11" },
  { title: "Honeyland", composer: "Foltin", tags: ["natura", "rurale", "ambiente", "osservativo", "intimo", "tradizione"], weight: 1.0, sourceUrl: "https://en.wikipedia.org/wiki/Honeyland", verifiedAt: "2026-06-11" },
  // — montagna / scalata / sopravvivenza / avventura —
  { title: "Free Solo", composer: "Marco Beltrami", tags: ["montagna", "scalata", "sopravvivenza", "avventura", "tensione"], weight: 1.0, sourceUrl: "https://en.wikipedia.org/wiki/Free_Solo_(soundtrack)", verifiedAt: "2026-06-11" },
  { title: "Touching the Void", composer: "Alex Heffes", tags: ["montagna", "scalata", "sopravvivenza", "avventura", "tensione"], weight: 1.1, sourceUrl: "https://en.wikipedia.org/wiki/Touching_the_Void_(film)", verifiedAt: "2026-06-11" },
  // — sociale / povertà / lavoro / diritti —
  { title: "I, Daniel Blake", composer: "George Fenton", tags: ["sociale", "poverta", "lavoro", "dignita", "urbano", "intimo"], weight: 1.2, sourceUrl: "https://en.wikipedia.org/wiki/I,_Daniel_Blake", verifiedAt: "2026-06-11" },
  { title: "Capernaum", composer: "Khaled Mouzanar", tags: ["sociale", "poverta", "infanzia", "migrazione", "urbano"], weight: 1.1, sourceUrl: "https://en.wikipedia.org/wiki/Capernaum_(film)", verifiedAt: "2026-06-11" },
  // — intimo / memoria / lutto / famiglia —
  { title: "Aftersun", composer: "Oliver Coates", tags: ["intimo", "memoria", "famiglia", "lutto", "contemplativo"], weight: 1.3, sourceUrl: "https://en.wikipedia.org/wiki/Aftersun", verifiedAt: "2026-06-11" },
  { title: "The Quiet Girl", composer: "Stephen Rennicks", tags: ["intimo", "infanzia", "rurale", "famiglia", "tenero"], weight: 1.1, sourceUrl: "https://en.wikipedia.org/wiki/The_Quiet_Girl", verifiedAt: "2026-06-11" },
  { title: "Drive My Car", composer: "Eiko Ishibashi", tags: ["intimo", "lutto", "guarigione", "contemplativo", "viaggio"], weight: 1.2, sourceUrl: "https://en.wikipedia.org/wiki/Drive_My_Car_(film)", verifiedAt: "2026-06-11" },
  { title: "The Rider", composer: "Nathan Halpern", tags: ["intimo", "rurale", "identita", "recupero", "essenziale"], weight: 1.1, sourceUrl: "https://en.wikipedia.org/wiki/The_Rider_(film)", verifiedAt: "2026-06-11" },
  // — viaggio / strada / identità —
  { title: "The Motorcycle Diaries", composer: "Gustavo Santaolalla", tags: ["viaggio", "strada", "identita", "avventura", "sociale"], weight: 1.0, sourceUrl: "https://en.wikipedia.org/wiki/The_Motorcycle_Diaries_(soundtrack)", verifiedAt: "2026-06-11" },
  // — spirituale / morale / alpino —
  { title: "A Hidden Life", composer: "James Newton Howard", tags: ["spirituale", "morale", "montagna", "rurale", "resistenza"], weight: 1.2, sourceUrl: "https://en.wikipedia.org/wiki/A_Hidden_Life_(soundtrack)", verifiedAt: "2026-06-11" },
];

// Set di FALLBACK elegante (codex): se il film non matcha bene nessun tono,
// meglio 3 riferimenti eleganti e versatili che 3 "precisi" fuori tono.
const FALLBACK_TITLES = ["Aftersun", "The Quiet Girl", "A Hidden Life"];

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
export const pickMusicReferences = (
  filmText: string,
  n = 3
): MusicRef[] => {
  const pool = MUSIC_LIBRARY.filter((m) => !m.disabled);
  const tags = detectTags(filmText || "");

  const scored = pool
    .map((m) => {
      const overlap = m.tags.filter((t) => tags.has(t)).length;
      const approvedBonus = m.approved ? 0.5 : 0;
      const score = overlap * (m.weight ?? 1) + approvedBonus;
      return { m, overlap, score };
    })
    .sort((a, b) => b.score - a.score || (b.m.weight ?? 1) - (a.m.weight ?? 1));

  // soglia: serve almeno UN match di tono nei primi risultati, altrimenti
  // fallback (meglio eleganti che fuori tono).
  const bestOverlap = scored.length ? scored[0].overlap : 0;
  const ordered =
    bestOverlap > 0
      ? scored.map((s) => s.m)
      : FALLBACK_TITLES.map(
          (t) => pool.find((m) => m.title === t)!
        ).filter(Boolean);

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
export const injectMusicReferences = (
  body: string,
  filmText: string
): string => {
  const refs =
    formatMusicReferences(pickMusicReferences(filmText)) ||
    "un sound originale tarato sul tono del progetto";
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
