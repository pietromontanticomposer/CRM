import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import {
  SECOND_FOLLOW_UP_DAYS,
  buildAutomaticFollowUpNote,
  getAutomaticFollowUpStage,
  isKeepInTouchNote,
  toFollowUpDateOnly,
} from "@/lib/followUp";
import { buildOutboundAttachments, buildOutboundHtml } from "@/lib/outboundEmail";
import { resolveEmailAccount } from "@/lib/server/emailAccounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getEnv = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var ${key}`);
  return value;
};

const getOptionalEnv = (key: string) => {
  const value = process.env[key];
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const getSupabase = () =>
  createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

const getCronSecretFromRequest = (request: Request) => {
  const headerSecret = request.headers.get("x-cron-secret");
  if (headerSecret && headerSecret.trim().length > 0) return headerSecret.trim();
  const authHeader = request.headers.get("authorization");
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, "").trim();
  }
  return null;
};

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

const getSmtpConfig = () => {
  const host = getOptionalEnv("MAILDEV_HOST") || getOptionalEnv("SMTP_HOST") || null;
  const portValue = getOptionalEnv("MAILDEV_PORT") || getOptionalEnv("SMTP_PORT");
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

const parseDateValue = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const shouldSkipFollowUp = (status?: string | null) =>
  status === "Non interessato" || status === "Collaborazione stabilita";

type ScheduledRow = {
  id: string;
  owner_id: string;
  contact_id: string | null;
  email_account_id: string | null;
  to_email: string;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  reply_to_email_id: string | null;
  notification_kind: string | null;
  send_at: string;
};

const getHeaderValue = (raw: unknown, names: string[]) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
};

const buildReferencesHeader = (references?: string | null, messageId?: string) => {
  const parts = [references, messageId].filter(Boolean) as string[];
  if (!parts.length) return null;
  const unique = Array.from(new Set(parts.join(" ").split(/\s+/)));
  return unique.join(" ");
};

const buildReplySubject = (
  threadSubject?: string | null,
  requestedSubject?: string | null
) => {
  const base = threadSubject?.trim() || requestedSubject?.trim() || "";
  if (!base) return "";
  return /^re:/i.test(base) ? base : `Re: ${base}`;
};

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const cronSecret = getOptionalEnv("CRON_SECRET");
  if (cronSecret) {
    const provided = getCronSecretFromRequest(request);
    if (provided !== cronSecret) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  const supabase = getSupabase();
  const today = getTodayDate();

  const { data: dueEmails, error: fetchError } = await supabase
    .from("scheduled_emails")
    .select("*")
    .eq("status", "pending")
    .lte("send_at", today)
    .order("send_at", { ascending: true })
    .limit(50);

  if (fetchError) {
    return NextResponse.json(
      { ok: false, error: fetchError.message },
      { status: 500 }
    );
  }

  if (!dueEmails?.length) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const row of dueEmails as ScheduledRow[]) {
    try {
      // Build transport
      let transport: ReturnType<typeof nodemailer.createTransport>;
      let fromAddress: string;

      if (row.email_account_id) {
        const account = await resolveEmailAccount(
          supabase,
          row.email_account_id,
          row.owner_id,
          false
        );
        if (!account.smtpHost || !account.smtpPort) {
          throw new Error("SMTP non configurato per questa casella.");
        }
        transport = nodemailer.createTransport({
          host: account.smtpHost,
          port: account.smtpPort,
          secure: account.smtpSecure ?? account.smtpPort === 465,
          auth: { user: account.username, pass: account.password },
        });
        fromAddress = account.email;
      } else {
        const smtpConfig = getSmtpConfig();
        transport = smtpConfig
          ? nodemailer.createTransport(smtpConfig)
          : nodemailer.createTransport({
              service: "gmail",
              auth: {
                user: getEnv("GMAIL_USER"),
                pass: getEnv("GMAIL_APP_PASSWORD"),
              },
            });
        fromAddress =
          getOptionalEnv("MAIL_FROM") ||
          getOptionalEnv("GMAIL_USER") ||
          "crm@local.test";
      }

      // Resolve reply headers
      let replyMessageId: string | null = null;
      let replyReferences: string | null = null;
      let replySubject: string | null = null;
      const headers: Record<string, string> = {};

      if (row.reply_to_email_id) {
        const { data: replyEmail } = await supabase
          .from("emails")
          .select("message_id_header, references, subject, raw")
          .eq("id", row.reply_to_email_id)
          .maybeSingle();

        replyMessageId =
          replyEmail?.message_id_header ??
          getHeaderValue(replyEmail?.raw, ["Message-ID", "Message-Id"]) ??
          null;
        replyReferences = buildReferencesHeader(
          replyEmail?.references ??
            getHeaderValue(replyEmail?.raw, ["References", "references"]),
          replyMessageId ?? undefined
        );
        replySubject =
          replyEmail?.subject ??
          getHeaderValue(replyEmail?.raw, ["Subject", "subject"]);

        if (replyMessageId) headers["In-Reply-To"] = replyMessageId;
        if (replyReferences) headers["References"] = replyReferences;
      }

      const subject = row.reply_to_email_id
        ? buildReplySubject(replySubject, row.subject)
        : row.subject?.trim() || "";

      const htmlBody = buildOutboundHtml(row.html_body, row.text_body);
      const outboundAttachments = buildOutboundAttachments(htmlBody);

      const info = await transport.sendMail({
        from: fromAddress,
        to: row.to_email,
        subject: subject || undefined,
        text: row.text_body ?? undefined,
        html: htmlBody,
        headers,
        attachments: outboundAttachments,
      });

      const now = new Date().toISOString();

      // Store in emails table
      await supabase.from("emails").insert({
        contact_id: row.contact_id,
        owner_id: row.owner_id,
        direction: "outbound",
        gmail_uid: null,
        message_id_header: info.messageId ?? null,
        in_reply_to: replyMessageId,
        references: replyReferences,
        from_email: fromAddress,
        from_name: "Pietro Montanti",
        to_email: row.to_email,
        subject: subject || null,
        text_body: row.text_body ?? null,
        html_body: htmlBody ?? null,
        received_at: now,
        raw: { messageId: info.messageId ?? null, to: [row.to_email] },
      });

      // Create notification
      await supabase.from("notifications").insert({
        type: "email_sent",
        owner_id: row.owner_id,
        contact_id: row.contact_id,
        title: `Email programmata inviata a ${row.to_email}`,
        body: subject || null,
      });

      // Update contact follow-up state
      if (row.contact_id) {
        const { data: contact } = await supabase
          .from("contacts")
          .select("id, status, last_action_at, next_action_at, next_action_note")
          .eq("id", row.contact_id)
          .maybeSingle();

        if (contact && !shouldSkipFollowUp(contact.status)) {
          const sentDate = new Date();
          const sentDateOnly = toFollowUpDateOnly(sentDate);
          const followUpDays = getFollowUpDays();
          const lastActionDate = parseDateValue(contact.last_action_at);
          const nextActionDate = parseDateValue(contact.next_action_at);
          const nextActionDateOnly = nextActionDate
            ? toFollowUpDateOnly(nextActionDate)
            : null;
          const automaticFollowUpStage = getAutomaticFollowUpStage(
            contact.next_action_note
          );
          const keepInTouch = isKeepInTouchNote(contact.next_action_note);
          const shouldRefreshLastAction =
            !lastActionDate || toFollowUpDateOnly(lastActionDate) < sentDateOnly;

          const updatePayload: Record<string, unknown> = {};
          if (shouldRefreshLastAction) {
            updatePayload.last_action_at = sentDateOnly;
            updatePayload.last_action_note = "Email programmata inviata dal CRM";
            if (contact.status === "Attiva auto follow-up") {
              updatePayload.status = "In attesa";
            }
          }
          if (
            !keepInTouch &&
            automaticFollowUpStage === 1 &&
            nextActionDateOnly &&
            nextActionDateOnly <= sentDateOnly
          ) {
            updatePayload.next_action_at = toFollowUpDateOnly(
              addDays(sentDate, SECOND_FOLLOW_UP_DAYS)
            );
            updatePayload.next_action_note = buildAutomaticFollowUpNote(2);
          } else if (
            !keepInTouch &&
            automaticFollowUpStage === 2 &&
            nextActionDateOnly &&
            nextActionDateOnly <= sentDateOnly
          ) {
            updatePayload.next_action_at = null;
            updatePayload.next_action_note = null;
          } else if (
            !keepInTouch &&
            !automaticFollowUpStage &&
            !nextActionDateOnly
          ) {
            updatePayload.next_action_at = toFollowUpDateOnly(
              addDays(sentDate, followUpDays)
            );
            updatePayload.next_action_note = buildAutomaticFollowUpNote(1);
          }

          if (Object.keys(updatePayload).length) {
            await supabase
              .from("contacts")
              .update(updatePayload)
              .eq("id", row.contact_id);
          }
        }
      }

      // Mark as sent
      await supabase
        .from("scheduled_emails")
        .update({ status: "sent", sent_at: now })
        .eq("id", row.id);

      results.push({ id: row.id, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Errore sconosciuto";
      await supabase
        .from("scheduled_emails")
        .update({ status: "failed", error: message })
        .eq("id", row.id);
      results.push({ id: row.id, ok: false, error: message });
    }
  }

  return NextResponse.json({
    ok: true,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
