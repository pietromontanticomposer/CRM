import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");

loadEnv({ path: path.join(PROJECT_ROOT, ".env.local"), override: false });
loadEnv({ path: path.join(PROJECT_ROOT, ".env"), override: false });

const getRequiredEnv = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing env var ${key}`);
  return value;
};

const supabase = createClient(
  getRequiredEnv("SUPABASE_URL"),
  getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const dryRun = process.argv.includes("--dry-run");

const main = async () => {
  // Pulisce sia gli outreach_drafts che i contacts approvati provenienti
  // da batch outreach (ai_batch_id non nullo).
  const { data: draftRows } = await supabase
    .from("outreach_drafts")
    .select("id, name, batch_id, batch_name, created_at");

  if (draftRows && draftRows.length > 0) {
    console.log(`Trovate ${draftRows.length} draft outreach.`);
    const byBatch = new Map<string, number>();
    draftRows.forEach((d) => {
      const key = `${d.batch_name ?? "(senza nome)"} :: ${d.batch_id}`;
      byBatch.set(key, (byBatch.get(key) ?? 0) + 1);
    });
    console.log("Distribuzione draft per batch:");
    Array.from(byBatch.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([key, count]) => console.log(`  - ${count}x  ${key}`));

    if (!dryRun) {
      const draftIds = draftRows.map((d) => d.id);
      const { error } = await supabase
        .from("outreach_drafts")
        .delete()
        .in("id", draftIds);
      if (error) {
        console.error("Errore cancellazione draft:", error);
      } else {
        console.log(`Cancellate ${draftIds.length} draft outreach.`);
      }
    }
  } else {
    console.log("Nessuna draft outreach trovata.");
  }

  const { data: rows, error: listError } = await supabase
    .from("contacts")
    .select("id, name, ai_batch_id, ai_batch_name, created_at")
    .not("ai_batch_id", "is", null);

  if (listError) {
    console.error("Errore listing:", listError);
    process.exit(1);
  }

  const list = rows ?? [];
  console.log(`Trovati ${list.length} contatti con ai_batch_id non nullo.`);
  if (list.length === 0) return;

  const byBatch = new Map<string, number>();
  list.forEach((c) => {
    const key = `${c.ai_batch_name ?? "(senza nome)"} :: ${c.ai_batch_id}`;
    byBatch.set(key, (byBatch.get(key) ?? 0) + 1);
  });
  console.log("Distribuzione per batch:");
  Array.from(byBatch.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([key, count]) => console.log(`  - ${count}x  ${key}`));

  if (dryRun) {
    console.log("\n[DRY RUN] Nessuna cancellazione eseguita.");
    return;
  }

  const ids = list.map((c) => c.id);
  console.log(`\nCancellazione di ${ids.length} contatti...`);

  // Cancellazione tabelle dipendenti prima
  const childTables = [
    "ai_outreach_agent_checks",
    "scheduled_emails",
    "emails",
    "notifications",
    "attachments",
  ];
  for (const table of childTables) {
    const { error } = await supabase
      .from(table)
      .delete()
      .in("contact_id", ids);
    if (error) {
      console.warn(`  ${table}: errore (${error.message}) — proseguo`);
    } else {
      console.log(`  ${table}: OK`);
    }
  }

  const { error: deleteError, count } = await supabase
    .from("contacts")
    .delete({ count: "exact" })
    .in("id", ids);

  if (deleteError) {
    console.error("Errore cancellazione contacts:", deleteError);
    process.exit(1);
  }
  console.log(`\nCancellati ${count ?? ids.length} contatti.`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
