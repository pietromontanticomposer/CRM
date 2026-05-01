/**
 * Test integrazione: verifica che quando un contatto risponde,
 * tutte le scheduled_emails 'pending' per quel contatto vengano marcate 'cancelled'.
 *
 * Uso: npx tsx scripts/test-followup-cancel.ts
 *
 * Crea contatti/email di test (email @example.invalid) sul DB reale,
 * esegue le asserzioni, e ripulisce alla fine. Nessuna email viene spedita.
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { handleContactInbound } from "../src/lib/followUp";

const env = dotenv.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8")
);

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
}

const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_EMAIL_DOMAIN = "example.invalid";
const TEST_TAG = `crm-test-cancel-${RUN_ID}`;

type Cleanup = () => Promise<void>;
const cleanups: Cleanup[] = [];

const log = (...args: unknown[]) => console.log("[test]", ...args);
const assert = (cond: unknown, msg: string) => {
  if (!cond) {
    console.error(`\n❌ ASSERT FAIL: ${msg}\n`);
    throw new Error(msg);
  }
  console.log(`   ✓ ${msg}`);
};

const today = () => new Date().toISOString().slice(0, 10);
const tomorrow = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const getOwnerId = async (): Promise<string> => {
  const loginEmail = env.APP_LOGIN_EMAIL || "pietromontanticomposer@gmail.com";
  const { data, error } = await supabase
    .from("app_users")
    .select("id")
    .ilike("email", loginEmail)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No app_user found for ${loginEmail}`);
  return data.id;
};

const createContact = async (ownerId: string, suffix: string): Promise<string> => {
  const { data, error } = await supabase
    .from("contacts")
    .insert({
      owner_id: ownerId,
      name: `${TEST_TAG}-${suffix}`,
      email: `${TEST_TAG}-${suffix}@${TEST_EMAIL_DOMAIN}`,
      status: "Attiva auto follow-up",
      next_action_at: tomorrow(),
      next_action_note: "Follow-up automatico 1/2 (10 giorni)",
    })
    .select("id")
    .single();
  if (error) throw error;
  cleanups.push(async () => {
    await supabase.from("contacts").delete().eq("id", data.id);
  });
  return data.id;
};

const createScheduledEmail = async (
  ownerId: string,
  contactId: string,
  status: "pending" | "sent" | "cancelled" | "failed",
  sendAt: string
): Promise<string> => {
  const insert: Record<string, unknown> = {
    owner_id: ownerId,
    contact_id: contactId,
    to_email: `${TEST_TAG}@${TEST_EMAIL_DOMAIN}`,
    subject: `${TEST_TAG} subject`,
    text_body: "test body",
    status,
    send_at: sendAt,
  };
  if (status === "sent") insert.sent_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("scheduled_emails")
    .insert(insert)
    .select("id")
    .single();
  if (error) throw error;
  cleanups.push(async () => {
    await supabase.from("scheduled_emails").delete().eq("id", data.id);
  });
  return data.id;
};

const getScheduledStatus = async (id: string): Promise<string> => {
  const { data, error } = await supabase
    .from("scheduled_emails")
    .select("status")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data.status;
};

const cleanupAll = async () => {
  log("cleanup…");
  for (const c of cleanups.reverse()) {
    try {
      await c();
    } catch (e) {
      console.error("cleanup err", e);
    }
  }
};

const test1_normalReplyCancelsPending = async (ownerId: string) => {
  log("\n=== TEST 1: reply normale → tutte le pending cancellate, sent intatta ===");
  const contactA = await createContact(ownerId, "A1");
  const contactB = await createContact(ownerId, "B1");

  const pendingA1 = await createScheduledEmail(ownerId, contactA, "pending", today());
  const pendingA2 = await createScheduledEmail(ownerId, contactA, "pending", tomorrow());
  const sentA = await createScheduledEmail(ownerId, contactA, "sent", "2025-01-01");
  const pendingB = await createScheduledEmail(ownerId, contactB, "pending", today());

  await handleContactInbound(supabase, contactA, {
    subject: "Re: la tua proposta",
    fromEmail: `${TEST_TAG}-A1@${TEST_EMAIL_DOMAIN}`,
  });

  assert(
    (await getScheduledStatus(pendingA1)) === "cancelled",
    "pendingA1 (oggi) → cancelled"
  );
  assert(
    (await getScheduledStatus(pendingA2)) === "cancelled",
    "pendingA2 (domani) → cancelled"
  );
  assert(
    (await getScheduledStatus(sentA)) === "sent",
    "sentA → resta 'sent' (non viene toccata)"
  );
  assert(
    (await getScheduledStatus(pendingB)) === "pending",
    "pendingB (altro contatto) → resta 'pending'"
  );

  const { data: contactARow } = await supabase
    .from("contacts")
    .select("status, next_action_at, next_action_note")
    .eq("id", contactA)
    .single();
  assert(
    contactARow?.next_action_at === null && contactARow?.next_action_note === null,
    "contactA: next_action_at e next_action_note azzerati"
  );
  assert(
    contactARow?.status === "Azione richiesta",
    `contactA: status='Azione richiesta' (era ${contactARow?.status})`
  );
};

const test2_autoReplyDoesNotCancel = async (ownerId: string) => {
  log("\n=== TEST 2: auto-reply → pending NON cancellate ===");
  const contact = await createContact(ownerId, "AR");
  const pending = await createScheduledEmail(ownerId, contact, "pending", today());

  const cases: Array<{ subject: string; fromEmail: string; label: string }> = [
    { subject: "Auto-Reply: out of office", fromEmail: `${TEST_TAG}-AR@${TEST_EMAIL_DOMAIN}`, label: "subject 'Auto-Reply'" },
    { subject: "Out of Office", fromEmail: `${TEST_TAG}-AR@${TEST_EMAIL_DOMAIN}`, label: "subject 'Out of Office'" },
    { subject: "Risposta automatica", fromEmail: `${TEST_TAG}-AR@${TEST_EMAIL_DOMAIN}`, label: "subject 'Risposta automatica'" },
    { subject: "Re: reply", fromEmail: `mailer-daemon@example.invalid`, label: "from mailer-daemon" },
    { subject: "Re: reply", fromEmail: `noreply@example.invalid`, label: "from noreply@" },
  ];

  for (const c of cases) {
    await supabase
      .from("scheduled_emails")
      .update({ status: "pending" })
      .eq("id", pending);

    await handleContactInbound(supabase, contact, {
      subject: c.subject,
      fromEmail: c.fromEmail,
    });

    assert(
      (await getScheduledStatus(pending)) === "pending",
      `auto-reply (${c.label}) → pending NON cancellata`
    );
  }
};

const test3_isolation = async (ownerId: string) => {
  log("\n=== TEST 3: reply su contatto A non tocca contatto B ===");
  const contactA = await createContact(ownerId, "I-A");
  const contactB = await createContact(ownerId, "I-B");
  const contactC = await createContact(ownerId, "I-C");

  const pA = await createScheduledEmail(ownerId, contactA, "pending", today());
  const pB = await createScheduledEmail(ownerId, contactB, "pending", today());
  const pC = await createScheduledEmail(ownerId, contactC, "pending", today());

  await handleContactInbound(supabase, contactA, {
    subject: "Re: ciao",
    fromEmail: `${TEST_TAG}-I-A@${TEST_EMAIL_DOMAIN}`,
  });

  assert((await getScheduledStatus(pA)) === "cancelled", "contatto A → cancelled");
  assert((await getScheduledStatus(pB)) === "pending", "contatto B → pending");
  assert((await getScheduledStatus(pC)) === "pending", "contatto C → pending");
};

const test4_cronDoesNotPickCancelled = async (ownerId: string) => {
  log("\n=== TEST 4: il cron query NON pesca le email cancelled ===");
  const contact = await createContact(ownerId, "CRON");
  const cancelled = await createScheduledEmail(
    ownerId,
    contact,
    "cancelled",
    today()
  );

  const { data, error } = await supabase
    .from("scheduled_emails")
    .select("id")
    .eq("status", "pending")
    .lte("send_at", today());
  if (error) throw error;

  const ids = (data ?? []).map((r: { id: string }) => r.id);
  assert(
    !ids.includes(cancelled),
    "scheduled_email 'cancelled' NON appare nella query del cron (status='pending' AND send_at<=today)"
  );
};

const test5_handlesNoPendingGracefully = async (ownerId: string) => {
  log("\n=== TEST 5: contatto senza pending → nessun errore ===");
  const contact = await createContact(ownerId, "EMPTY");
  await handleContactInbound(supabase, contact, {
    subject: "Re: ciao",
    fromEmail: `${TEST_TAG}-EMPTY@${TEST_EMAIL_DOMAIN}`,
  });
  assert(true, "handleContactInbound non lancia errori se non ci sono pending");
};

const test6_failedNotTouched = async (ownerId: string) => {
  log("\n=== TEST 6: scheduled_emails 'failed' non vengono cancellate ===");
  const contact = await createContact(ownerId, "FAIL");
  const failed = await createScheduledEmail(ownerId, contact, "failed", today());
  const pending = await createScheduledEmail(ownerId, contact, "pending", today());

  await handleContactInbound(supabase, contact, {
    subject: "Re: ciao",
    fromEmail: `${TEST_TAG}-FAIL@${TEST_EMAIL_DOMAIN}`,
  });

  assert((await getScheduledStatus(failed)) === "failed", "failed → resta 'failed'");
  assert((await getScheduledStatus(pending)) === "cancelled", "pending → cancelled");
};

const main = async () => {
  log(`run id: ${RUN_ID}`);
  const ownerId = await getOwnerId();
  log(`owner: ${ownerId}`);

  let failed = 0;
  const tests: Array<[string, () => Promise<void>]> = [
    ["test1_normalReplyCancelsPending", () => test1_normalReplyCancelsPending(ownerId)],
    ["test2_autoReplyDoesNotCancel", () => test2_autoReplyDoesNotCancel(ownerId)],
    ["test3_isolation", () => test3_isolation(ownerId)],
    ["test4_cronDoesNotPickCancelled", () => test4_cronDoesNotPickCancelled(ownerId)],
    ["test5_handlesNoPendingGracefully", () => test5_handlesNoPendingGracefully(ownerId)],
    ["test6_failedNotTouched", () => test6_failedNotTouched(ownerId)],
  ];
  try {
    for (const [name, fn] of tests) {
      try {
        await fn();
      } catch (e) {
        failed++;
        console.error(`💥 ${name} FAILED:`, e instanceof Error ? e.message : e);
      }
    }
  } finally {
    await cleanupAll();
  }

  if (failed > 0) {
    console.error(`\n❌ ${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`\n✅ tutti i test passati (${tests.length}/${tests.length})`);
};

main().catch(async (e) => {
  console.error("FATAL", e);
  await cleanupAll();
  process.exit(1);
});
