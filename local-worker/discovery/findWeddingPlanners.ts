import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { runCommand } from "../agents/shared";

const WORKER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ROOT = path.resolve(WORKER_DIR, "..");

// ============================================================================
// RICERCA WEDDING PLANNER (Pietro 2026-06-18)
// ----------------------------------------------------------------------------
// Trova N wedding planner REALI entro ~2 ore d'auto da Verona, usando SOLO la
// CLI locale `claude` col web (nessuna API a pagamento, come il resto del CRM).
// Per ognuno raccoglie: nome, citta', sito/Instagram, email pubblica (se
// visibile) e un DETTAGLIO VERO dal loro sito/IG per il complimento. Salta i
// nomi gia' trovati (dedup), e ripete la ricerca finche' non raggiunge il
// target (o esaurisce i giri). Il worker poi scrive la mail e la fa controllare.
// ============================================================================

export type WeddingPlannerCandidate = {
  name: string;
  company: string | null;
  city: string | null;
  region: string | null;
  website: string | null;
  instagram: string | null;
  email: string | null;
  email_source_url: string | null;
  // Dettaglio REALE dal loro sito/IG su cui basare il complimento, + la fonte.
  about: string | null;
  compliment_source_url: string | null;
};

// Zone entro ~2h di auto da Verona (l'AI le usa come perimetro geografico).
const AREA_HINT =
  "entro circa 2 ore d'auto da Verona: tutto il Veneto (Verona, Lago di Garda, " +
  "Vicenza, Padova, Treviso, Venezia, Rovigo), il Trentino (Trento, Rovereto, " +
  "Riva del Garda) e l'Alto Adige meridionale, la Lombardia orientale (Brescia, " +
  "Bergamo, Mantova, Cremona), e l'Emilia occidentale/centrale entro il raggio " +
  "(Modena, Reggio Emilia, Bologna, Ferrara, Parma). NIENTE planner fuori da " +
  "questo raggio (no Roma, Milano citta', Firenze, sud Italia, estero).";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

const norm = (s: string): string =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const stripCodeFences = (raw: string) =>
  raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

// Estrae il primo array JSON dall'output (claude a volte aggiunge testo intorno).
const extractJsonArray = (raw: string): unknown[] | null => {
  const cleaned = stripCodeFences(raw);
  const first = cleaned.indexOf("[");
  const last = cleaned.lastIndexOf("]");
  if (first < 0 || last <= first) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(first, last + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const cleanStr = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

const cleanUrl = (v: unknown): string | null => {
  const s = cleanStr(v);
  if (!s) return null;
  if (/^https?:\/\/\S+$/i.test(s) && s.length <= 400) return s;
  // accetta anche "www.xxx" o "dominio.it" nudi
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(s)) return `https://${s.replace(/^www\./i, "www.")}`;
  return null;
};

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const cleanEmail = (v: unknown): string | null => {
  const s = cleanStr(v);
  if (!s) return null;
  const lower = s.toLowerCase();
  if (!EMAIL_RE.test(lower)) return null;
  if (/noreply|no-reply|donotreply|example\.|test\.|sentry|wixpress/.test(lower)) return null;
  return lower;
};

const normalizeCandidate = (v: unknown): WeddingPlannerCandidate | null => {
  if (!isRecord(v)) return null;
  const name = cleanStr(v.name) ?? cleanStr(v.company);
  if (!name) return null;
  return {
    name,
    company: cleanStr(v.company),
    city: cleanStr(v.city),
    region: cleanStr(v.region) ?? cleanStr(v.province),
    website: cleanUrl(v.website) ?? cleanUrl(v.site),
    instagram: cleanStr(v.instagram),
    email: cleanEmail(v.email),
    email_source_url: cleanUrl(v.email_source_url),
    about: cleanStr(v.about) ?? cleanStr(v.compliment_hint),
    compliment_source_url: cleanUrl(v.compliment_source_url) ?? cleanUrl(v.source_url),
  };
};

const buildSearchPrompt = (
  howMany: number,
  excludeNames: string[]
): string => {
  const exclude =
    excludeNames.length > 0
      ? `\n\nGIA' TROVATI (NON includerli di nuovo, cercane di DIVERSI):\n${excludeNames
          .slice(0, 300)
          .map((n) => `- ${n}`)
          .join("\n")}`
      : "";
  return `Sei un investigatore. Devi trovare ${howMany} WEDDING PLANNER (organizzatori di matrimoni) REALI e ATTIVI ${AREA_HINT}

HAI ACCESSO A INTERNET (WebSearch + WebFetch). DEVI USARLO: cerca e APRI le pagine vere (siti ufficiali, profili Instagram). NON inventare nulla.

COSA CERCARE: studi/agenzie o professionisti di wedding planning con un SITO o un PROFILO INSTAGRAM pubblico e attivo, nella zona indicata. Preferisci realta' indipendenti e di fascia media (NON le grandi catene nazionali, NON portali/directory come matrimonio.com o zankyou: quelli sono elenchi, non planner).

PER OGNI planner, APRI il suo sito/Instagram e raccogli SOLO dati che leggi DAVVERO sulla pagina:
- name: il nome dello studio o della persona (come si firmano)
- company: il nome dell'attivita' se diverso dal nome
- city: la citta'/zona in cui hanno base (deve essere nel raggio indicato)
- region: la provincia o regione
- website: l'URL del sito (se ce l'hanno)
- instagram: l'handle Instagram (es. @nome) se ce l'hanno
- email: l'email PUBBLICA di contatto SE la vedi scritta sulla pagina (anche info@/hello@ del loro dominio va bene). Se non la vedi: null. NON inventarla, NON dedurla dal nome.
- email_source_url: l'URL ESATTO della pagina dove hai visto l'email (null se email null)
- about: UN dettaglio CONCRETO e VERO preso dal loro sito/IG su cui costruire un complimento sincero (lo stile che dichiarano, un tipo di matrimonio in cui sono specializzati, una location reale del loro portfolio, la loro filosofia). UNA frase, presa da quello che hai LETTO. Se non trovi nulla di concreto: null.
- compliment_source_url: l'URL della pagina da cui viene "about"

REGOLE FERREE:
- SOLO planner reali con presenza online verificata da te in questa sessione. Se non riesci ad aprire nulla di concreto su un planner, NON includerlo.
- Rispetta il raggio geografico: niente planner fuori dalla zona indicata.
- NIENTE duplicati e NIENTE planner della lista "gia' trovati".
- "about" ed "email" SOLO se letti davvero su una pagina aperta. Meglio null che inventato.${exclude}

OUTPUT: SOLO un array JSON (niente testo prima o dopo, niente markdown), ${howMany} oggetti:
[
  {"name":"...","company":"...","city":"...","region":"...","website":"https://...","instagram":"@...","email":"info@...","email_source_url":"https://...","about":"...","compliment_source_url":"https://..."}
]
Usa null per i campi che non hai potuto verificare. Restituisci meno di ${howMany} elementi piuttosto che inventarne.`;
};

const runClaudeSearch = async (
  howMany: number,
  excludeNames: string[],
  cwd: string
): Promise<WeddingPlannerCandidate[]> => {
  const prompt = buildSearchPrompt(howMany, excludeNames);
  const args = [
    "-p",
    "--allowedTools",
    "WebSearch",
    "WebFetch",
    "--permission-mode",
    "acceptEdits",
    "--output-format",
    "text",
    "--no-session-persistence",
  ];
  if (process.env.DISCOVERY_MODEL?.trim()) {
    args.push("--model", process.env.DISCOVERY_MODEL.trim());
  } else if (process.env.CLAUDE_MODEL?.trim()) {
    args.push("--model", process.env.CLAUDE_MODEL.trim());
  }
  // Timeout generoso: la ricerca apre molte pagine.
  const TIMEOUT_MS = Number(process.env.DISCOVERY_TIMEOUT_MS) || 420_000;
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), TIMEOUT_MS);
  });
  try {
    const run = runCommand({ command: "claude", args, cwd, stdin: prompt });
    const result = await Promise.race([run, timeout]);
    if (!result) {
      console.warn("[discovery] claude timeout");
      return [];
    }
    if (result.code !== 0) {
      console.warn(
        `[discovery] claude exited ${result.code}: ${(result.stderr || result.stdout).slice(0, 300)}`
      );
      return [];
    }
    const raw = result.stdout.trim() || result.stderr.trim();
    const arr = extractJsonArray(raw);
    if (!arr) {
      console.warn("[discovery] output non parsabile come array JSON");
      return [];
    }
    return arr
      .map(normalizeCandidate)
      .filter((c): c is WeddingPlannerCandidate => c !== null);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const findWeddingPlanners = async (opts: {
  target: number;
  existingNames: string[];
  cwd?: string;
  maxRounds?: number;
}): Promise<WeddingPlannerCandidate[]> => {
  const cwd = opts.cwd ?? PROJECT_ROOT;
  const target = Math.max(1, opts.target);
  const maxRounds = Math.max(1, opts.maxRounds ?? 3);
  const seen = new Set(opts.existingNames.map(norm));
  const found: WeddingPlannerCandidate[] = [];

  for (let round = 0; round < maxRounds && found.length < target; round += 1) {
    const remaining = target - found.length;
    // Chiedo qualcuno in piu' per assorbire scarti/duplicati.
    const ask = Math.min(remaining + 3, remaining * 2 + 2);
    const excludeNames = [
      ...opts.existingNames,
      ...found.map((c) => c.name),
    ];
    console.log(
      `[discovery] giro ${round + 1}/${maxRounds}: chiedo ${ask} planner (ne mancano ${remaining})`
    );
    const batch = await runClaudeSearch(ask, excludeNames, cwd);
    let added = 0;
    for (const cand of batch) {
      const key = norm(cand.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      found.push(cand);
      added += 1;
      if (found.length >= target) break;
    }
    console.log(
      `[discovery] giro ${round + 1}: ricevuti ${batch.length}, nuovi ${added}, totale ${found.length}/${target}`
    );
    if (added === 0) break; // il giro non ha portato nulla di nuovo: mi fermo
  }

  return found.slice(0, target);
};

// ----------------------------------------------------------------------------
// SEMINA BOZZE: inserisce i candidati in outreach_drafts via REST (service role),
// stessa forma usata da /api/contacts (mode outreach_import). ai_status=imported
// fa partire il worker. Dedup gestita dall'UNIQUE index (409/23505 = salta).
// ----------------------------------------------------------------------------
export type SeedResult = { inserted: number; skipped: number };

const OFFER_NOTE =
  "Offerta: musica dal vivo per matrimoni (sax dal vivo, set sax + DJ, ensemble da cerimonia, trio jazz). Base a Verona.";

export const seedWeddingPlannerDrafts = async (opts: {
  ownerId: string;
  batchId: string;
  batchName: string;
  candidates: WeddingPlannerCandidate[];
  supabaseUrl?: string;
  serviceKey?: string;
}): Promise<SeedResult> => {
  const url = (opts.supabaseUrl ?? process.env.SUPABASE_URL)?.trim();
  const key = (opts.serviceKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !key) throw new Error("Missing SUPABASE env (URL / SERVICE_ROLE_KEY).");

  let inserted = 0;
  let skipped = 0;
  for (const c of opts.candidates) {
    const verified_facts_json: Record<string, unknown> = {
      planner_city: c.city,
      planner_region: c.region,
      website: c.website,
      instagram: c.instagram,
      about: c.about,
      compliment_source_url: c.compliment_source_url,
      discovery_source: "wedding_planner_finder",
    };
    const payload: Record<string, unknown> = {
      owner_id: opts.ownerId,
      batch_id: opts.batchId,
      batch_name: opts.batchName,
      section: "live_music",
      name: c.name,
      email: c.email,
      company: c.company,
      role: "Wedding planner",
      notes: [c.city, c.region, OFFER_NOTE].filter(Boolean).join(" · "),
      source_link: c.website ?? c.compliment_source_url ?? null,
      verified_facts_json,
      ai_status: "imported",
      ai_validation_status: "not_checked",
      ai_send_allowed: false,
    };
    if (c.email) {
      payload.email_source_url = c.email_source_url;
      payload.email_source_type = "discovery";
      // Email letta sul sito del planner: certa abbastanza per scrivere (>=0.7).
      payload.email_confidence = c.email_source_url ? 0.8 : 0.7;
      payload.email_enrichment_status = "found_public";
      payload.email_enrichment_reason =
        "Email pubblica trovata sul sito/IG del planner durante la ricerca.";
      payload.email_found_at = new Date().toISOString();
    }

    const res = await fetch(`${url}/rest/v1/outreach_drafts`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      inserted += 1;
    } else if (res.status === 409) {
      skipped += 1; // doppione (UNIQUE owner+nome): gia' trovato in passato
    } else {
      const text = await res.text().catch(() => "");
      console.warn(`[discovery] insert "${c.name}" HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
  }
  return { inserted, skipped };
};

// Carica i nomi gia' presenti (bozze + contatti) per l'owner: dedup robusta.
export const loadExistingNames = async (opts: {
  ownerId: string;
  supabaseUrl?: string;
  serviceKey?: string;
}): Promise<string[]> => {
  const url = (opts.supabaseUrl ?? process.env.SUPABASE_URL)?.trim();
  const key = (opts.serviceKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !key) return [];
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const names = new Set<string>();
  for (const table of ["outreach_drafts", "contacts"]) {
    try {
      const res = await fetch(
        `${url}/rest/v1/${table}?owner_id=eq.${opts.ownerId}&select=name&limit=100000`,
        { headers }
      );
      if (!res.ok) continue;
      const rows = (await res.json().catch(() => [])) as Array<{ name?: string }>;
      rows.forEach((r) => {
        if (typeof r.name === "string" && r.name.trim()) names.add(r.name.trim());
      });
    } catch {
      /* ignore */
    }
  }
  return [...names];
};

// ----------------------------------------------------------------------------
// CLI di test: `tsx local-worker/discovery/findWeddingPlanners.ts --dry-run --target 3`
// --dry-run: cerca e STAMPA, nessuna scrittura su DB (per capire se la ricerca funziona).
// --insert --owner <id>: cerca e SEMINA le bozze (poi il worker le elabora).
// ----------------------------------------------------------------------------
const isMain = (() => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMain) {
  loadEnv({ path: path.join(PROJECT_ROOT, ".env.local"), override: false });
  loadEnv({ path: path.join(PROJECT_ROOT, ".env"), override: false });

  const argv = process.argv.slice(2);
  const getFlag = (name: string) => argv.includes(name);
  const getOpt = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const target = Number(getOpt("--target")) || 3;
  const dryRun = getFlag("--dry-run") || !getFlag("--insert");
  const ownerId = getOpt("--owner");

  (async () => {
    const existingNames = ownerId ? await loadExistingNames({ ownerId }) : [];
    console.log(
      `[discovery] target=${target} dryRun=${dryRun} owner=${ownerId ?? "—"} (gia' noti: ${existingNames.length})`
    );
    const candidates = await findWeddingPlanners({ target, existingNames, cwd: PROJECT_ROOT });
    console.log(`\n[discovery] TROVATI ${candidates.length}:\n`);
    candidates.forEach((c, i) => {
      console.log(
        `${i + 1}. ${c.name}${c.company && c.company !== c.name ? ` (${c.company})` : ""}` +
          `\n   zona: ${c.city ?? "?"}${c.region ? ", " + c.region : ""}` +
          `\n   sito: ${c.website ?? "—"}   IG: ${c.instagram ?? "—"}` +
          `\n   email: ${c.email ?? "—"}${c.email_source_url ? "  (" + c.email_source_url + ")" : ""}` +
          `\n   spunto: ${c.about ?? "—"}` +
          `\n   fonte spunto: ${c.compliment_source_url ?? "—"}\n`
      );
    });

    // --write: prova lo SCRITTORE matrimonio sul primo planner trovato e stampa
    // la mail (niente DB, niente invio). Test end-to-end del motore.
    if (getFlag("--write") && candidates.length > 0) {
      const { runWeddingWriterDraft } = await import("../agents/writerWeddingDraft");
      const c = candidates[0];
      const input = {
        name: c.name,
        email: c.email,
        company: c.company,
        source_link: c.website ?? c.compliment_source_url,
        notes: [c.city, c.region].filter(Boolean).join(" · ") || null,
        language: null,
        role: "Wedding planner",
        section: "live_music",
        verified_facts_json: {
          planner_city: c.city,
          planner_region: c.region,
          website: c.website,
          instagram: c.instagram,
          about: c.about,
          compliment_source_url: c.compliment_source_url,
        },
        email_source_url: c.email_source_url,
        email_confidence: c.email ? 0.8 : null,
        email_enrichment_status: c.email ? "found_public" : null,
        prompt_master_rules: null,
      };
      console.log(`\n[discovery] scrivo la mail di PROVA per: ${c.name}\n`);
      const out = await runWeddingWriterDraft(input, PROJECT_ROOT);
      if ("error" in out) {
        console.log("WRITER ERRORE:", out.error);
      } else {
        console.log("OGGETTO: " + out.subject);
        console.log("\nCORPO:\n" + out.body);
        console.log("\nFONTI: " + (out.sources.join(" | ") || "—"));
        console.log(`risk_score: ${out.risk_score} | reason: ${out.reason}`);
      }
    }

    if (!dryRun) {
      if (!ownerId) {
        console.error("[discovery] --insert richiede --owner <id>. Niente scritto.");
        process.exit(1);
      }
      const batchId = randomUUID();
      const batchName = `Wedding planners ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
      const seed = await seedWeddingPlannerDrafts({
        ownerId,
        batchId,
        batchName,
        candidates,
      });
      console.log(
        `[discovery] SEMINATE: inserite ${seed.inserted}, saltate(doppioni) ${seed.skipped}. batch=${batchId}`
      );
    } else {
      console.log("[discovery] dry-run: nessuna scrittura su DB.");
    }
    process.exit(0);
  })().catch((e) => {
    console.error("[discovery] errore:", e);
    process.exit(1);
  });
}
