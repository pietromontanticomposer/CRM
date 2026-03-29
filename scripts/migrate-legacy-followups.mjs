import fs from "node:fs";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const LEGACY_AUTOMATIC_FOLLOW_UP_NOTE = "Follow-up automatico (10 giorni)";
const SECOND_FOLLOW_UP_DAYS = 30;
const SECOND_FOLLOW_UP_NOTE =
  "Follow-up automatico 2/2 (30 giorni dal primo follow-up)";

const dryRun = process.argv.includes("--dry-run");

const env = dotenv.parse(fs.readFileSync(".env.local", "utf8"));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const addDays = (dateOnly, days) => {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const getTodayInRome = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const today = getTodayInRome();

const main = async () => {
  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("id, name, last_action_at, next_action_at, next_action_note")
    .eq("next_action_note", LEGACY_AUTOMATIC_FOLLOW_UP_NOTE)
    .order("next_action_at", { ascending: true });

  if (error) throw error;

  const updates = (contacts ?? [])
    .filter((contact) => typeof contact.last_action_at === "string")
    .map((contact) => {
      const nextActionAt = addDays(contact.last_action_at, SECOND_FOLLOW_UP_DAYS);
      return {
        id: contact.id,
        name: contact.name || "Contatto senza nome",
        previousNextActionAt: contact.next_action_at,
        nextActionAt,
        nextActionNote: SECOND_FOLLOW_UP_NOTE,
      };
    });

  if (!dryRun) {
    for (const update of updates) {
      const { error: updateError } = await supabase
        .from("contacts")
        .update({
          next_action_at: update.nextActionAt,
          next_action_note: update.nextActionNote,
        })
        .eq("id", update.id);

      if (updateError) throw updateError;
    }
  }

  const hidden = updates.filter((item) => item.nextActionAt > today).length;
  const dueToday = updates
    .filter((item) => item.nextActionAt === today)
    .map((item) => item.name);
  const overdue = updates
    .filter((item) => item.nextActionAt < today)
    .map((item) => ({ name: item.name, nextActionAt: item.nextActionAt }));

  console.log(
    JSON.stringify(
      {
        dryRun,
        updated: updates.length,
        hidden,
        dueToday,
        overdue,
      },
      null,
      2
    )
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
