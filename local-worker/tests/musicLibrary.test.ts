/**
 * Test unità — libreria riferimenti musicali (selezione deterministica, zero AI).
 * Pietro+codex 2026-06-11.
 */
import {
  MUSIC_LIBRARY,
  pickMusicReferences,
  formatMusicReferences,
  injectMusicReferences,
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

console.log(
  failures === 0 ? "\nTUTTI I TEST LIBRERIA MUSICALE PASSATI." : `\n${failures} TEST FALLITI.`
);
process.exit(failures === 0 ? 0 : 1);
