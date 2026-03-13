import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const REMINDER_RECIPIENT = "pietromontanticomposer@gmail.com";
const KEEP_IN_TOUCH_MONTHS = 2;
const KEEP_IN_TOUCH_NOTE = `Mantenere in contatto (automatico ogni ${KEEP_IN_TOUCH_MONTHS} mesi)`;

const getEnv = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var ${key}`);
  return value;
};

const getOptionalEnv = (key: string) => {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value : null;
};

const getCronSecretFromRequest = (request: Request) => {
  const headerSecret = request.headers.get("x-cron-secret");
  if (headerSecret && headerSecret.trim().length > 0) return headerSecret.trim();
  const authHeader = request.headers.get("authorization");
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, "").trim();
  }
  return null;
};

const getSupabase = () =>
  createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

const getTodayDate = () => {
  const tz = getOptionalEnv("REMINDER_TIMEZONE");
  if (!tz) return new Date().toISOString().slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
};

const addMonthsToDateOnly = (dateOnly: string, months: number) => {
  const parsed = new Date(`${dateOnly}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateOnly;
  parsed.setMonth(parsed.getMonth() + months);
  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
  const day = `${parsed.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const isKeepInTouchNote = (value?: string | null) =>
  value?.trim() === KEEP_IN_TOUCH_NOTE;

const getSmtpConfig = () => {
  const host =
    getOptionalEnv("MAILDEV_HOST") ||
    getOptionalEnv("SMTP_HOST") ||
    null;
  const portValue =
    getOptionalEnv("MAILDEV_PORT") || getOptionalEnv("SMTP_PORT");
  const port = portValue ? Number(portValue) : null;
  if (!host || !port || !Number.isFinite(port)) return null;

  const user = getOptionalEnv("SMTP_USER");
  const pass = getOptionalEnv("SMTP_PASS");
  return {
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  };
};

const buildBody = (
  date: string,
  item: {
    name: string | null;
    email: string | null;
    company: string | null;
    role: string | null;
    note: string | null;
  }
) => {
  const label = item.name || item.email || "Contatto";
  const details = [
    item.email ? `Email: ${item.email}` : null,
    item.company ? `Azienda: ${item.company}` : null,
    item.role ? `Ruolo: ${item.role}` : null,
    item.note ? `Nota: ${item.note}` : null,
  ].filter(Boolean);
  const lines = [
    `Follow-up da fare oggi (${date}).`,
    "",
    `Contatto: ${label}`,
    ...details.map((entry) => `- ${entry}`),
  ];
  return lines.join("\n").trim();
};

export async function POST(request: Request) {
  const cronSecret = getCronSecretFromRequest(request);
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const reminderEmail = REMINDER_RECIPIENT;

  const supabase = getSupabase();
  const today = getTodayDate();
  const { data: dueContacts, error } = await supabase
    .from("contacts")
    .select(
      "id, name, email, company, role, status, next_action_at, next_action_note"
    )
    .eq("next_action_at", today)
    .neq("status", "Chiuso")
    .neq("status", "Non interessato");

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Failed to fetch follow-ups" },
      { status: 500 }
    );
  }

  if (!dueContacts || dueContacts.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const transportConfig = getSmtpConfig();
  const transport = transportConfig
    ? nodemailer.createTransport(transportConfig)
    : nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: getEnv("GMAIL_USER"),
          pass: getEnv("GMAIL_APP_PASSWORD"),
        },
      });

  const fromAddress =
    getOptionalEnv("MAIL_FROM") ||
    getOptionalEnv("GMAIL_USER") ||
    "crm@local.test";

  let sent = 0;
  for (const contact of dueContacts) {
    const body = buildBody(today, {
      name: contact.name,
      email: contact.email,
      company: contact.company,
      role: contact.role,
      note: contact.next_action_note,
    });
    const subjectLabel =
      contact.name || contact.email || "Contatto";
    await transport.sendMail({
      from: fromAddress,
      to: reminderEmail,
      subject: `Follow-up da fare: ${subjectLabel}`,
      text: body,
    });
    sent += 1;
  }

  const notifications = dueContacts.map((contact) => ({
    type: "followup_due",
    contact_id: contact.id,
    email_id: null,
    title: `Follow-up in scadenza: ${contact.name || contact.email || "Contatto"}`,
    body: contact.next_action_note || null,
  }));
  if (notifications.length) {
    await supabase.from("notifications").insert(notifications);
  }

  const keepInTouchContacts = dueContacts.filter((contact) =>
    isKeepInTouchNote(contact.next_action_note)
  );

  if (keepInTouchContacts.length) {
    for (const contact of keepInTouchContacts) {
      const baseDate =
        typeof contact.next_action_at === "string" &&
        contact.next_action_at.length >= 10
          ? contact.next_action_at.slice(0, 10)
          : today;
      const nextDate = addMonthsToDateOnly(baseDate, KEEP_IN_TOUCH_MONTHS);
      await supabase
        .from("contacts")
        .update({
          next_action_at: nextDate,
          next_action_note: KEEP_IN_TOUCH_NOTE,
        })
        .eq("id", contact.id);
    }
  }

  return NextResponse.json({ ok: true, sent });
}
