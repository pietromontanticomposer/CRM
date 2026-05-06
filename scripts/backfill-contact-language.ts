/**
 * One-shot backfill: detects language per contact from their latest inbound
 * email content and writes it to contacts.language. Skips contacts that
 * already have a non-null language (idempotent — safe to re-run).
 *
 * Uso: npx tsx scripts/backfill-contact-language.ts [--force]
 *      --force re-detects even if language is already set.
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { detectLanguageFromEmail, stripHtml } from "../src/lib/languageDetection";

const env = dotenv.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8")
);

const SUPABASE_URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
}

const force = process.argv.includes("--force");
const supabase = createClient(SUPABASE_URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type ContactRow = { id: string; name: string | null; email: string | null; language: string | null };
type EmailRow = {
  contact_id: string | null;
  received_at: string | null;
  created_at: string | null;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
};

const main = async () => {
  console.log(`Backfill contact language (force=${force})`);

  let query = supabase
    .from("contacts")
    .select("id, name, email, language")
    .order("created_at", { ascending: false });

  if (!force) {
    query = query.is("language", null);
  }

  const { data: contacts, error: cErr } = await query;
  if (cErr) throw cErr;
  if (!contacts?.length) {
    console.log("No contacts to backfill.");
    return;
  }

  console.log(`Processing ${contacts.length} contact(s)...`);

  const ids = (contacts as ContactRow[]).map((c) => c.id);
  const { data: emails, error: eErr } = await supabase
    .from("emails")
    .select("contact_id, received_at, created_at, subject, text_body, html_body")
    .eq("direction", "inbound")
    .in("contact_id", ids);
  if (eErr) throw eErr;

  const latestByContact = new Map<string, { ts: number; text: string }>();
  (emails as EmailRow[] | null)?.forEach((row) => {
    if (!row.contact_id) return;
    const ts = new Date(row.received_at ?? row.created_at ?? 0).getTime();
    const cur = latestByContact.get(row.contact_id);
    if (cur && cur.ts >= ts) return;
    latestByContact.set(row.contact_id, {
      ts,
      text: [row.text_body, stripHtml(row.html_body), row.subject]
        .filter(Boolean)
        .join(" "),
    });
  });

  let updated = 0;
  let skipped = 0;
  for (const contact of contacts as ContactRow[]) {
    const candidate = latestByContact.get(contact.id);
    const detected = candidate ? detectLanguageFromEmail(candidate.text) : null;
    if (!detected) {
      skipped++;
      continue;
    }
    if (!force && contact.language === detected) {
      skipped++;
      continue;
    }
    const { error } = await supabase
      .from("contacts")
      .update({ language: detected })
      .eq("id", contact.id);
    if (error) {
      console.error(`Failed for ${contact.id}`, error);
      continue;
    }
    updated++;
    console.log(`  ✓ ${contact.name ?? contact.email ?? contact.id} → ${detected}`);
  }

  console.log(`\nDone. Updated: ${updated}, skipped (insufficient signal or already correct): ${skipped}.`);
};

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
