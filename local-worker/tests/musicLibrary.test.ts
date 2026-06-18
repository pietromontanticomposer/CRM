/**
 * Test unità — libreria riferimenti musicali (selezione deterministica, zero AI).
 * Pietro+codex 2026-06-11.
 */
import {
  MUSIC_LIBRARY,
  pickMusicReferences,
  formatMusicReferences,
  injectMusicReferences,
  shortlistMusicReferences,
  resolveRefsByIds,
  refIdOf,
} from "../musicReferences";

let failures = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? "ok  " : "FAIL"} - ${label}`);
  if (!ok) failures += 1;
};

// 1) REGOLA FERREA: ogni voce ha titolo, compositore, tag e una sourceUrl http.
const allHaveSource = MUSIC_LIBRARY.every(
  (m) =>
    m.title.trim() &&
    m.composer.trim() &&
    Array.isArray(m.tags) &&
    m.tags.length > 0 &&
    /^https?:\/\//.test(m.sourceUrl) &&
    m.verifiedAt
);
check("ogni voce ha titolo+compositore+tag+sourceUrl verificata", allHaveSource);

// 2) seleziona sempre 3 riferimenti, con compositori DIVERSI
const cases = [
  "crisi abitativa, sfratti, lavoratori poveri", // sociale
  "documentario senza parole sulla natura e gli animali", // natura
  "scalata di una parete di ghiaccio in montagna", // montagna
  "una bambina in una fattoria, infanzia e famiglia", // intimo/rurale
  "viaggio in bicicletta attraverso la Patagonia", // viaggio
  "", // fallback
  "un testo qualunque senza tono", // fallback
];
let all3distinct = true;
for (const c of cases) {
  const refs = pickMusicReferences(c);
  const composers = new Set(refs.map((r) => r.composer));
  if (refs.length !== 3 || composers.size !== 3) {
    all3distinct = false;
    console.log("   caso fallito:", JSON.stringify(c), "->", formatMusicReferences(refs));
  }
}
check("ogni film -> 3 riferimenti con 3 compositori diversi", all3distinct);

// 3) coerenza: un film sociale deve pescare almeno un riferimento sociale
const social = pickMusicReferences("povertà, sfratti, disoccupazione, lavoro");
check(
  "film sociale -> almeno un riferimento taggato sociale",
  social.some((r) => r.tags.includes("sociale"))
);

// 4) iniezione: il placeholder viene sostituito dai riferimenti scelti
const body = "Per il suo progetto potrei immaginare un sound ispirato a {{MUSICAL_REFS}}.";
const injected = injectMusicReferences(body, "scalata in montagna, sopravvivenza");
check("placeholder {{MUSICAL_REFS}} sostituito", !injected.includes("{{MUSICAL_REFS}}") && /\(.+\)/.test(injected));

// 4b) placeholder CON SPAZI deve comunque essere sostituito (niente residui)
const bodySp = "un sound ispirato a {{ MUSICAL_REFS }}.";
const injSp = injectMusicReferences(bodySp, "montagna");
check("placeholder con spazi sostituito (nessun residuo)", !/\{\{/.test(injSp) && /\(.+\)/.test(injSp));

// 5) fallback iniezione: se manca il placeholder ma c'è "ispirato a … .", sostituisce
const body2 = "potrei immaginare un sound ispirato a Tizio (Caio), Sempronio (Mevio), X (Y).";
const injected2 = injectMusicReferences(body2, "natura, oceano");
check("fallback: sostituisce la lista dopo 'ispirato a'", !/Tizio \(Caio\)/.test(injected2) && /ispirato a .+\(/.test(injected2));

// 6) fallback SENZA punto finale (es. la frase finisce a fine riga)
const body3 = "un sound ispirato a Tizio (Caio), X (Y)";
const injected3 = injectMusicReferences(body3, "montagna, scalata");
check("fallback senza punto finale: sostituisce comunque", !/Tizio \(Caio\)/.test(injected3) && /ispirato a .+\(/.test(injected3));

// 7) IBRIDO — shortlist verificata (≤8) e id risolvibili
const sl = shortlistMusicReferences("scalata estrema in montagna", 8);
check("shortlist: ≤8 voci, tutte dalla libreria", sl.length > 0 && sl.length <= 8 && sl.every((m) => MUSIC_LIBRARY.includes(m)));

// 8) resolveRefsByIds: 3 id validi DALLA shortlist -> 3 refs verificate
const goodIds = [refIdOf(sl[0]), refIdOf(sl[1]), refIdOf(sl[2])];
const resolved = resolveRefsByIds(goodIds, sl);
check("3 id dalla shortlist -> 3 refs verificate", resolved !== null && resolved.length === 3);

// 9) CASO CRITICO (codex): id valido in libreria ma FUORI shortlist -> null
const outside = MUSIC_LIBRARY.find((m) => !sl.includes(m))!;
check("id in libreria ma FUORI shortlist -> null", resolveRefsByIds([refIdOf(outside), refIdOf(sl[0]), refIdOf(sl[1])], sl) === null);

// 10) id inventato / meno di 3 / duplicati -> null
check("id inventato -> null", resolveRefsByIds(["nonexistent-x", refIdOf(sl[0]), refIdOf(sl[1])], sl) === null);
check("meno di 3 id -> null", resolveRefsByIds([refIdOf(sl[0])], sl) === null);
check("id duplicati -> null", resolveRefsByIds([refIdOf(sl[0]), refIdOf(sl[0]), refIdOf(sl[1])], sl) === null);

// 11) slug `refIdOf` UNICI su tutta la libreria
const slugs = MUSIC_LIBRARY.map((m) => refIdOf(m));
check("slug refIdOf unici (no collisioni)", new Set(slugs).size === slugs.length && slugs.every((s) => s.length > 0));

console.log(
  failures === 0 ? "\nTUTTI I TEST LIBRERIA MUSICALE PASSATI." : `\n${failures} TEST FALLITI.`
);
process.exit(failures === 0 ? 0 : 1);
