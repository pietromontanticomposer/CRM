// AUTO-VERIFICA dei fatti del progetto crm-next.
// Serve a NON affermare cose false: si lancia con `npm run selfcheck` PRIMA di
// dire "fatto/funziona". Controlla solo fatti oggettivi (file presenti, launcher
// che si auto-aggiornano, file vietati intatti, niente file temporanei, ecc.).
// Esce con codice 1 se qualcosa non torna.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
let fail = 0;
const ok = (m) => console.log("  OK  " + m);
const bad = (m) => {
  console.log("  XX  " + m);
  fail++;
};
const exists = (rel) => fs.existsSync(path.join(root, rel));
const has = (rel, s) => {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8").includes(s);
  } catch {
    return false;
  }
};

console.log("== SELF-CHECK crm-next ==");

// 1) File chiave presenti
console.log("[file chiave]");
for (const f of [
  "CONTINUA.md",
  "STATO.md",
  "CLAUDE.md",
  "CLAUDE-SYNC.md",
  "Avvia-CRM-Worker.bat",
  "Avvia-CRM-Worker.command",
  "public/firma_pietro.png",
  "public/curriculum-pietro-montanti.pdf",
]) {
  exists(f) ? ok(f) : bad("MANCA " + f);
}

// 2) Launcher: si auto-aggiornano da GitHub e avviano il worker (parità Mac/Win)
console.log("[launcher auto-update]");
has("Avvia-CRM-Worker.bat", "git pull")
  ? ok("Windows .bat fa git pull")
  : bad("Windows .bat SENZA git pull");
has("Avvia-CRM-Worker.command", "git pull")
  ? ok("Mac .command fa git pull")
  : bad("Mac .command SENZA git pull");
has("Avvia-CRM-Worker.command", "npm run outreach:worker")
  ? ok("Mac .command avvia il worker")
  : bad("Mac .command non avvia il worker");
has("Avvia-CRM-Worker.bat", "npm run outreach:worker")
  ? ok("Windows .bat avvia il worker")
  : bad("Windows .bat non avvia il worker");

// 3) File DA NON TOCCARE: devono esistere (non cancellati/rinominati per sbaglio)
console.log("[file vietati intatti]");
for (const f of [
  "src/app/api/gmail/send/route.ts",
  "src/app/api/reminders/run/route.ts",
  "src/app/api/scheduled-emails/send/route.ts",
  "src/app/api/gmail/sync/route.ts",
  "src/app/api/postmark/inbound/route.ts",
  "src/lib/followUp.ts",
]) {
  exists(f) ? ok(f) : bad("FILE VIETATO MANCANTE " + f);
}

// 4) Niente file temporanei _tmp_ (sporcano il lint/build)
console.log("[igiene]");
const lw = path.join(root, "local-worker");
const tmp = fs.existsSync(lw)
  ? fs.readdirSync(lw).filter((f) => f.startsWith("_tmp_"))
  : [];
tmp.length === 0
  ? ok("nessun file _tmp_ residuo")
  : bad("file _tmp_ residui: " + tmp.join(", "));

// 5) Approva = invia: la schermata revisione chiama gmail/send dopo l'approvazione
console.log("[approva=invia]");
has("src/components/outreach/OutreachBatchClient.tsx", "/api/gmail/send")
  ? ok("la revisione invia via gmail/send")
  : bad("Approva NON invia (manca la chiamata a gmail/send)");

console.log(
  fail === 0 ? "\n== TUTTO OK ==" : `\n== ${fail} PROBLEMI — NON dire 'fatto' ==`
);
process.exit(fail === 0 ? 0 : 1);
