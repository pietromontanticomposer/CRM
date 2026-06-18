/**
 * TEST DI INTEGRAZIONE — ciclo-vita delle bozze.
 *
 * REQUISITO NUOVO (Pietro 2026-06-11, dopo l'incidente: un SIGHUP cancellò un
 * intero batch di 123 registi). La chiusura del worker — SIGTERM, SIGHUP
 * (finestra del Terminale chiusa), deploy, sleep del Mac — NON deve MAI
 * cancellare le bozze. outreach_drafts è lo spazio di lavoro: gli APPROVATI
 * vengono spostati in `contacts`; i NON approvati RESTANO finché Pietro non li
 * approva, li scarta a mano, o invecchiano oltre il TTL (30 giorni).
 *
 * Questo test lancia il WORKER VERO (processo reale + segnali reali + DB reale):
 *   1. SIGTERM (kill / stop)              -> le bozze RESTANO
 *   2. SIGHUP  (finestra Terminale chiusa) -> le bozze RESTANO
 *   3. Takeover (relaunch del worker)     -> le bozze RESTANO (anche dopo che il
 *      successore viene fermato)
 *   4. Backstop avvio                     -> rimuove SOLO i leftover VECCHI
 *      (>30 giorni) senza toccare gli import freschi
 *
 * Seminiamo in stato "needs_review": la coda del worker NON li pesca (pesca
 * imported/draft_ready/processing), quindi restano fermi nel DB e NON consumano
 * AI: è il ciclo-vita (persistenza/pulizia), non l'elaborazione, a essere testato.
 */
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

const WORKER_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(WORKER_DIR, "..", "..");
loadEnv({ path: path.join(PROJECT_ROOT, ".env.local"), quiet: true });

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? "ok  " : "FAIL"} - ${label}`);
  if (!ok) failures += 1;
};

let ownerId: string | null = null;
const resolveOwner = async () => {
  const { data } = await sb.from("contacts").select("owner_id").limit(1);
  ownerId = (data?.[0]?.owner_id as string) ?? null;
};

const countDrafts = async () => {
  const { count } = await sb
    .from("outreach_drafts")
    .select("*", { count: "exact", head: true });
  return count ?? 0;
};

const wipeAll = async () => {
  await sb.from("outreach_drafts").delete().not("id", "is", null);
};

type SeedRow = { name: string; createdAtIso?: string };
const seed = async (rows: SeedRow[]) => {
  const batchId = randomUUID();
  const payload = rows.map((r) => ({
    owner_id: ownerId,
    name: r.name,
    ai_status: "needs_review",
    ai_validation_status: "needs_review",
    verified_facts_json: {},
    batch_id: batchId,
    batch_name: "TEST ciclo-vita",
    created_at: r.createdAtIso ?? new Date().toISOString(),
  }));
  const { error } = await sb.from("outreach_drafts").insert(payload);
  if (error) throw new Error(`seed fallito: ${error.message}`);
};

// Lancia il worker reale. Risolve quando stampa "polling" (= avvio completato).
const startWorker = (
  label: string
): Promise<{ child: ChildProcessWithoutNullStreams; out: () => string }> => {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "local-worker/run-worker.ts"],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, OUTREACH_WORKER_POLL_MS: "5000" },
    }
  ) as ChildProcessWithoutNullStreams;
  let buf = "";
  child.stdout.on("data", (d) => (buf += d.toString()));
  child.stderr.on("data", (d) => (buf += d.toString()));
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (/polling every/.test(buf)) {
        clearInterval(timer);
        clearTimeout(killer);
        resolve({ child, out: () => buf });
      }
    }, 150);
    const killer = setTimeout(() => {
      clearInterval(timer);
      child.kill("SIGKILL");
      reject(new Error(`[${label}] worker non avviato in tempo:\n${buf}`));
    }, 45000);
  });
};

const stopWorker = (
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals
): Promise<void> =>
  new Promise((resolve) => {
    child.on("exit", () => resolve());
    child.kill(signal);
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* gia' morto */
      }
      resolve();
    }, 15000);
  });

const main = async () => {
  await resolveOwner();
  console.log(`owner_id usato per il seed: ${ownerId ?? "(null)"}`);
  await wipeAll();

  // --- TEST 1: SIGTERM NON cancella ---
  await seed([{ name: "Test Alpha" }, { name: "Test Beta" }, { name: "Test Gamma" }]);
  check("setup 1: 3 draft seminati", (await countDrafts()) === 3);
  {
    const { child } = await startWorker("sigterm");
    await sleep(1000);
    check("1: draft presenti col worker vivo", (await countDrafts()) === 3);
    await stopWorker(child, "SIGTERM");
    await sleep(500);
    check("1: SIGTERM (stop) -> le bozze RESTANO", (await countDrafts()) === 3);
  }

  // --- TEST 2: SIGHUP (finestra chiusa) NON cancella ---
  await wipeAll();
  await seed([{ name: "Hup Uno" }, { name: "Hup Due" }]);
  {
    const { child } = await startWorker("sighup");
    await sleep(1000);
    await stopWorker(child, "SIGHUP");
    await sleep(500);
    check("2: SIGHUP (finestra chiusa) -> le bozze RESTANO", (await countDrafts()) === 2);
  }

  // --- TEST 3: takeover (relaunch) NON cancella, nemmeno fermando il successore ---
  await wipeAll();
  await seed([{ name: "Keep Uno" }, { name: "Keep Due" }, { name: "Keep Tre" }]);
  {
    const a = await startWorker("A");
    await sleep(800);
    const b = await startWorker("B"); // fa takeover di A
    await sleep(800);
    check(
      "3: relaunch (takeover) -> bozze NON cancellate",
      (await countDrafts()) === 3
    );
    await stopWorker(b.child, "SIGTERM");
    await sleep(500);
    check(
      "3: stop del successore -> bozze ANCORA presenti",
      (await countDrafts()) === 3
    );
    try {
      a.child.kill("SIGKILL");
    } catch {
      /* gia' morto */
    }
  }

  // --- TEST 4: backstop avvio (leftover VECCHI >30gg vs import freschi) ---
  await wipeAll();
  const thirtyOneDaysAgo = new Date(
    Date.now() - 31 * 24 * 3600_000
  ).toISOString();
  await seed([
    { name: "Vecchio Leftover", createdAtIso: thirtyOneDaysAgo },
    { name: "Import Fresco" },
  ]);
  check("setup 4: 2 draft (1 vecchio >30gg, 1 fresco)", (await countDrafts()) === 2);
  {
    const { child } = await startWorker("backstop");
    await sleep(1200);
    const remaining = await sb
      .from("outreach_drafts")
      .select("name")
      .order("name");
    const names = (remaining.data ?? []).map((r) => r.name as string);
    check(
      "4: avvio rimuove il leftover VECCHIO (>30gg)",
      !names.includes("Vecchio Leftover")
    );
    check("4: avvio NON tocca l'import FRESCO", names.includes("Import Fresco"));
    await stopWorker(child, "SIGTERM");
    await sleep(500);
  }

  // pulizia finale
  await wipeAll();
  check("cleanup finale: database vuoto", (await countDrafts()) === 0);

  console.log(
    failures === 0
      ? "\nTUTTI I TEST DI CICLO-VITA PASSATI."
      : `\n${failures} TEST FALLITI.`
  );
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error("ERRORE test:", e?.message || e);
  process.exit(1);
});
