import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SendPayload = {
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  replyToEmailId?: string;
};

const getEnv = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var ${key}`);
  return value;
};

const getOptionalEnv = (key: string) => {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value : null;
};

const getSupabase = () =>
  createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

const findContactId = async (email?: string | null) => {
  if (!email) return null;
  const supabase = getSupabase();
  const { data } = await supabase
    .from("contacts")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  return data?.id ?? null;
};

const buildReferencesHeader = (references?: string | null, messageId?: string) => {
  const parts = [references, messageId].filter(Boolean) as string[];
  if (!parts.length) return null;
  const unique = Array.from(new Set(parts.join(" ").split(/\s+/)));
  return unique.join(" ");
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getFollowUpDays = () => {
  const raw = Number(process.env.FOLLOWUP_DAYS ?? 10);
  if (!Number.isFinite(raw)) return 10;
  return Math.max(1, Math.floor(raw));
};

const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

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

export async function POST(request: Request) {
  let payload: SendPayload;
  try {
    payload = (await request.json()) as SendPayload;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!payload?.to) {
    return NextResponse.json({ ok: false, error: "Missing to" }, { status: 400 });
  }

  const supabase = getSupabase();

  let replyMessageId: string | null = null;
  let replyReferences: string | null = null;
  let replySubject: string | null = null;

  if (payload.replyToEmailId) {
    const { data } = await supabase
      .from("emails")
      .select("message_id_header, references, subject")
      .eq("id", payload.replyToEmailId)
      .maybeSingle();

    replyMessageId = data?.message_id_header ?? null;
    replyReferences = buildReferencesHeader(
      data?.references ?? null,
      replyMessageId ?? undefined
    );
    replySubject = data?.subject ?? null;
  }

  let subject = payload.subject?.trim() || replySubject || "";
  if (payload.replyToEmailId && subject && !/^re:/i.test(subject)) {
    subject = `Re: ${subject}`;
  }

  const smtpConfig = getSmtpConfig();
  const transport = smtpConfig
    ? nodemailer.createTransport(smtpConfig)
    : nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: getEnv("GMAIL_USER"),
          pass: getEnv("GMAIL_APP_PASSWORD"),
        },
      });

  const headers: Record<string, string> = {};
  if (replyMessageId) headers["In-Reply-To"] = replyMessageId;
  if (replyReferences) headers["References"] = replyReferences;

  const fromAddress =
    getOptionalEnv("MAIL_FROM") ||
    getOptionalEnv("GMAIL_USER") ||
    "crm@local.test";

  const info = await transport.sendMail({
    from: fromAddress,
    to: payload.to,
    subject: subject || undefined,
    text: payload.text,
    html: payload.html,
    headers,
  });

  const contactId = await findContactId(payload.to);
  const now = new Date().toISOString();

  const { data: insertedEmail } = await supabase
    .from("emails")
    .insert({
      contact_id: contactId,
      direction: "outbound",
      gmail_uid: null,
      message_id_header: info.messageId ?? null,
      in_reply_to: replyMessageId,
      references: replyReferences,
      from_email: fromAddress,
      from_name: null,
      to_email: payload.to,
      subject: subject || null,
      text_body: payload.text ?? null,
      html_body: payload.html ?? null,
      received_at: now,
      raw: { messageId: info.messageId ?? null },
    })
    .select("id")
    .single();

  if (insertedEmail?.id) {
    await supabase.from("notifications").insert({
      type: "email_sent",
      contact_id: contactId,
      email_id: insertedEmail.id,
      title: `Email inviata a ${payload.to}`,
      body: subject || null,
    });
  }

  if (contactId) {
    const followUpDays = getFollowUpDays();
    const today = new Date();
    const followUpDate = addDays(today, followUpDays);
    const followUpIso = toDateOnly(followUpDate);
    await supabase
      .from("contacts")
      .update({
        last_action_at: toDateOnly(today),
        last_action_note: "Email inviata dal CRM",
        next_action_at: followUpIso,
        next_action_note: `Follow-up automatico (${followUpDays} giorni)`,
      })
      .eq("id", contactId);
  }

  return NextResponse.json({ ok: true, messageId: info.messageId });
}
