import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SendPayload = {
  contactId?: string;
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

const normalizeEmail = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
};

const extractEmails = (value?: string | null) => {
  if (!value) return [];
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  if (!matches) return [];
  const unique = new Set(matches.map((item) => item.toLowerCase()));
  return Array.from(unique);
};

const uniqueEmails = (values: Array<string | null | undefined>) => {
  const unique = new Set<string>();
  values.forEach((value) => {
    const normalized = normalizeEmail(value);
    if (normalized) unique.add(normalized);
  });
  return Array.from(unique);
};

const escapeIlike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const findContactIdsFromAddresses = async (
  addresses: Array<string | null | undefined>
) => {
  const candidates = uniqueEmails(addresses);
  if (!candidates.length) return [];

  const supabase = getSupabase();
  const found = new Set<string>();
  const chunkSize = 25;

  for (let index = 0; index < candidates.length; index += chunkSize) {
    const chunk = candidates.slice(index, index + chunkSize);
    const filter = chunk
      .map((email) => `email.ilike.%${escapeIlike(email)}%`)
      .join(",");
    const { data } = await supabase
      .from("contacts")
      .select("id")
      .or(filter)
      .limit(2000);
    data?.forEach((row) => {
      if (row.id) found.add(row.id);
    });
  }

  return Array.from(found);
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

const parseDateValue = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const shouldSkipFollowUp = (status?: string | null) =>
  status === "Chiuso" || status === "Non interessato";

const updateContactAfterOutbound = async (
  contactId: string,
  sentAt: string
) => {
  const supabase = getSupabase();
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, status, last_action_at, next_action_at")
    .eq("id", contactId)
    .maybeSingle();

  if (!contact || shouldSkipFollowUp(contact.status)) return;

  const sentDate = parseDateValue(sentAt) ?? new Date();
  const sentDateOnly = toDateOnly(sentDate);
  const promotedStatus =
    contact.status === "Da contattare" ? "Già contattato" : contact.status;
  const shouldPromoteStatus = promotedStatus !== contact.status;
  const followUpDays = getFollowUpDays();
  const { data: firstOutboundEmail } = await supabase
    .from("emails")
    .select("received_at")
    .eq("contact_id", contactId)
    .eq("direction", "outbound")
    .not("received_at", "is", null)
    .order("received_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const firstOutboundDate =
    parseDateValue(firstOutboundEmail?.received_at) ?? sentDate;
  const followUpIso = toDateOnly(addDays(firstOutboundDate, followUpDays));
  const lastActionDate = parseDateValue(contact.last_action_at);
  const nextActionDate = parseDateValue(contact.next_action_at);
  const shouldRefreshLastAction =
    !lastActionDate || toDateOnly(lastActionDate) < sentDateOnly;
  const shouldRefreshFollowUp =
    (nextActionDate ? toDateOnly(nextActionDate) : null) !== followUpIso;

  if (!shouldPromoteStatus && !shouldRefreshLastAction && !shouldRefreshFollowUp) {
    return;
  }

  const updatePayload: Record<string, unknown> = {};
  if (shouldPromoteStatus) {
    updatePayload.status = promotedStatus;
  }
  if (shouldRefreshLastAction) {
    updatePayload.last_action_at = sentDateOnly;
    updatePayload.last_action_note = "Email inviata dal CRM";
  }
  if (shouldRefreshFollowUp) {
    updatePayload.next_action_at = followUpIso;
    updatePayload.next_action_note = `Follow-up automatico (${followUpDays} giorni)`;
  }

  await supabase
    .from("contacts")
    .update(updatePayload)
    .eq("id", contactId);
};

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

  const explicitContactId =
    typeof payload.contactId === "string" && payload.contactId.trim().length > 0
      ? payload.contactId.trim()
      : null;
  const recipientAddresses = extractEmails(payload.to);
  const matchedContactIds = explicitContactId
    ? []
    : await findContactIdsFromAddresses(
      recipientAddresses.length ? recipientAddresses : [payload.to]
    );
  const contactId =
    explicitContactId ??
    (matchedContactIds.length === 1 ? matchedContactIds[0] : null);
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

  const outboundContactIds = explicitContactId
    ? [explicitContactId]
    : matchedContactIds.length === 1
      ? matchedContactIds
      : [];
  for (const matchedId of outboundContactIds) {
    await updateContactAfterOutbound(matchedId, now);
  }

  return NextResponse.json({ ok: true, messageId: info.messageId });
}
