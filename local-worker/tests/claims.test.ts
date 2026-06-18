/**
 * Test unità — verifica deterministica dei claim del complimento
 * (`unsupportedClaims`). Pietro+codex 2026-06-11.
 * Ogni dettaglio concreto del complimento deve avere una `source_quote`
 * realmente presente nella sinossi: qui controlliamo i casi limite.
 */
import { unsupportedClaims } from "../agents/writerDraft";

let failures = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? "ok  " : "FAIL"} - ${label}`);
  if (!ok) failures += 1;
};

const synopsis =
  "Documentario senza parole sul mito di Sisifo: una donna restituisce al mare migliaia di scaglie di pesce, in un gesto di empatia verso gli esseri senzienti.";
const title = "Trillion";

// 1) claim VERO (quote nella sinossi) -> supportato (non torna)
check(
  "claim con quote nella sinossi = supportato",
  unsupportedClaims(
    [{ detail: "senza parole", source_quote: "Documentario senza parole sul mito di Sisifo" }],
    synopsis,
    title
  ).length === 0
);

// 2) claim INVENTATO (quote non nella sinossi) -> NON supportato (torna)
check(
  "claim con quote inventata = NON supportato",
  unsupportedClaims(
    [{ detail: "choreography", source_quote: "la coreografia porta avanti il film" }],
    synopsis,
    title
  ).length === 1
);

// 3) quote troppo corta = inaffidabile -> NON supportato
check(
  "quote troppo corta = NON supportato",
  unsupportedClaims([{ detail: "x", source_quote: "mare" }], synopsis, title).length === 1
);

// 4) niente sinossi -> non si verifica qui (torna [])
check(
  "senza sinossi non blocca (ritorna vuoto)",
  unsupportedClaims(
    [{ detail: "qualcosa", source_quote: "una frase qualsiasi lunga" }],
    null,
    title
  ).length === 0
);

// 5) match insensibile ad accenti/punteggiatura/maiuscole
check(
  "match robusto ad accenti e punteggiatura",
  unsupportedClaims(
    [{ detail: "empatia", source_quote: "GESTO di EMPATIA, verso gli esseri senzienti" }],
    synopsis,
    title
  ).length === 0
);

console.log(
  failures === 0 ? "\nTUTTI I TEST CLAIM PASSATI." : `\n${failures} TEST FALLITI.`
);
process.exit(failures === 0 ? 0 : 1);
