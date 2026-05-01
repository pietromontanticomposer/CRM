/**
 * Audit: trova le scheduled_emails 'pending' che dovrebbero essere
 * state cancellate dal bug di prima del fix.
 *
 * Criterio: per ogni pending, controlla se ESISTE un'email inbound
 * dal contatto con received_at > scheduled_email.created_at.
 * Se sì, il contatto ha già risposto e questa pending è "stale".
 *
 * Per default è DRY-RUN. Aggiungi --apply per cancellare davvero.
 *
 * Uso:
 *   npx tsx scripts/audit-stale-scheduled.ts          # dry run
 *   npx tsx scripts/audit-stale-scheduled.ts --apply  # cancella
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { isAutoReply } from "../src/lib/followUp";

const env = dotenv.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8")
);

const supabase = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const apply = process.argv.includes("--apply");

const main = async () => {
  console.log(`[audit] mode: ${apply ? "APPLY (cancellerà davvero)" : "DRY-RUN"}`);

  const { data: pendings, error: pErr } = await supabase
    .from("scheduled_emails")
    .select("id, contact_id, subject, send_at, created_at, owner_id, to_email")
    .eq("status", "pending");
  if (pErr) throw pErr;
  console.log(`[audit] pending totali: ${pendings?.length ?? 0}`);

  const stale: Array<{
    id: string;
    contact_id: string;
    to_email: string;
    send_at: string;
    reason: string;
  }> = [];

  for (const p of pendings ?? []) {
    if (!p.contact_id) continue;
    const { data: replies, error } = await supabase
      .from("emails")
      .select("id, subject, from_email, received_at")
      .eq("contact_id", p.contact_id)
      .eq("direction", "inbound")
      .gt("received_at", p.created_at)
      .order("received_at", { ascending: true });
    if (error) {
      console.error("err loading replies for", p.id, error.message);
      continue;
    }
    if (!replies || replies.length === 0) continue;

    const realReply = replies.find(
      (r) => !isAutoReply(r.subject, r.from_email)
    );
    if (!realReply) continue;

    stale.push({
      id: p.id,
      contact_id: p.contact_id,
      to_email: p.to_email,
      send_at: p.send_at,
      reason: `risposta inbound il ${realReply.received_at} (${realReply.subject ?? "(no subject)"})`,
    });
  }

  console.log(`\n[audit] STALE pending (contatto ha già risposto): ${stale.length}`);
  for (const s of stale) {
    console.log(`  • ${s.id}  contact=${s.contact_id}  to=${s.to_email}  send_at=${s.send_at}`);
    console.log(`    └ ${s.reason}`);
  }

  if (stale.length === 0) {
    console.log("\n[audit] niente da fare. ✅");
    return;
  }

  if (!apply) {
    console.log(
      `\n[audit] DRY-RUN: niente è stato cancellato. Riesegui con --apply per cancellare ${stale.length} pending.`
    );
    return;
  }

  const ids = stale.map((s) => s.id);
  const { error: updErr } = await supabase
    .from("scheduled_emails")
    .update({ status: "cancelled" })
    .in("id", ids);
  if (updErr) {
    console.error("[audit] update failed", updErr.message);
    process.exit(1);
  }
  console.log(`\n[audit] ✅ cancellate ${ids.length} scheduled_emails stale.`);
};

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
