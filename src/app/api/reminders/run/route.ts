import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import path from "path";
import {
  KEEP_IN_TOUCH_MONTHS,
  KEEP_IN_TOUCH_NOTE,
  isKeepInTouchNote,
  getAutomaticFollowUpStage,
  AUTO_FOLLOW_UP_1_NOTE,
  AUTO_FOLLOW_UP_2_NOTE,
  SECOND_FOLLOW_UP_DAYS,
  buildAutoFollowUpEmail1,
  buildAutoFollowUpEmail2,
  buildMaintainRapportEmail,
  isMaintainRapportNote,
  buildMaintainRapportNote,
  toFollowUpDateOnly,
} from "@/lib/followUp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const REMINDER_RECIPIENT = "pietromontanticomposer@gmail.com";

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

const addDaysToDateOnly = (dateOnly: string, days: number) => {
  const parsed = new Date(`${dateOnly}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateOnly;
  parsed.setDate(parsed.getDate() + days);
  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
  const day = `${parsed.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
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

const handleReminderRun = async (request: Request) => {
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
  const signatureHtml = getOptionalEnv("EMAIL_SIGNATURE_HTML");

  for (const contact of dueContacts) {
    const stage = getAutomaticFollowUpStage(contact.next_action_note);

    if (stage && contact.email) {
      // Automatic Follow-up
      const emailContent =
        stage === 1
          ? buildAutoFollowUpEmail1(contact.name, signatureHtml)
          : buildAutoFollowUpEmail2(contact.name, signatureHtml);

      // Try to find the last email for threading
      const { data: lastEmail } = await supabase
        .from("emails")
        .select("message_id_header, references, subject")
        .eq("contact_id", contact.id)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const headers: Record<string, string> = {};
      let subject = emailContent.subject;

      if (lastEmail?.message_id_header) {
        headers["In-Reply-To"] = lastEmail.message_id_header;
        const refs = [lastEmail.references, lastEmail.message_id_header]
          .filter(Boolean)
          .join(" ");
        headers["References"] = refs;
        if (lastEmail.subject) {
          subject = /^re:/i.test(lastEmail.subject)
            ? lastEmail.subject
            : `Re: ${lastEmail.subject}`;
        }
      }

      const sigAttach1 = emailContent.html?.includes("cid:firma_pietro")
        ? [{
            filename: "firma_pietro.png",
            path: path.join(process.cwd(), "public", "firma_pietro.png"),
            cid: "firma_pietro",
          }]
        : [];

      const info = await transport.sendMail({
        from: fromAddress,
        to: contact.email,
        subject,
        text: emailContent.body,
        html: emailContent.html,
        headers,
        attachments: sigAttach1,
      });

      // Save the sent email
      const { data: insertedFollowUp } = await supabase.from("emails").insert({
        contact_id: contact.id,
        direction: "outbound",
        message_id_header: info.messageId,
        in_reply_to: lastEmail?.message_id_header || null,
        references: headers["References"] || null,
        from_email: fromAddress,
        from_name: "Pietro Montanti",
        to_email: contact.email,
        subject,
        text_body: emailContent.body,
        html_body: emailContent.html,
        received_at: new Date().toISOString(),
      }).select("id").single();

      // Update contact state
      if (stage === 1) {
        await supabase
          .from("contacts")
          .update({
            next_action_at: addDaysToDateOnly(today, SECOND_FOLLOW_UP_DAYS),
            next_action_note: AUTO_FOLLOW_UP_2_NOTE,
            last_action_at: today,
            last_action_note: "Follow-up automatico 1/2 inviato",
          })
          .eq("id", contact.id);
      } else {
        await supabase
          .from("contacts")
          .update({
            next_action_at: null,
            next_action_note: null,
            last_action_at: today,
            last_action_note: "Follow-up automatico 2/2 inviato (fine)",
          })
          .eq("id", contact.id);
      }

      await supabase.from("notifications").insert({
        type: "email_sent",
        contact_id: contact.id,
        email_id: insertedFollowUp?.id ?? null,
        title: `Follow-up automatico inviato a ${contact.name}`,
        body: emailContent.body.slice(0, 100) + "...",
      });
    } else if (isMaintainRapportNote(contact.next_action_note) && contact.email) {
      // Mantenimento rapporto schedulato
      const emailContent = buildMaintainRapportEmail(contact.name, signatureHtml);

      const { data: lastEmail } = await supabase
        .from("emails")
        .select("message_id_header, references, subject")
        .eq("contact_id", contact.id)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const headers: Record<string, string> = {};
      let subject = emailContent.subject;

      if (lastEmail?.message_id_header) {
        headers["In-Reply-To"] = lastEmail.message_id_header;
        const refs = [lastEmail.references, lastEmail.message_id_header]
          .filter(Boolean)
          .join(" ");
        headers["References"] = refs;
        if (lastEmail.subject) {
          subject = /^re:/i.test(lastEmail.subject)
            ? lastEmail.subject
            : `Re: ${lastEmail.subject}`;
        }
      }

      const sigAttach2 = emailContent.html?.includes("cid:firma_pietro")
        ? [{
            filename: "firma_pietro.png",
            path: path.join(process.cwd(), "public", "firma_pietro.png"),
            cid: "firma_pietro",
          }]
        : [];

      const info = await transport.sendMail({
        from: fromAddress,
        to: contact.email,
        subject,
        text: emailContent.body,
        html: emailContent.html,
        headers,
        attachments: sigAttach2,
      });

      const { data: insertedMR } = await supabase.from("emails").insert({
        contact_id: contact.id,
        direction: "outbound",
        message_id_header: info.messageId,
        in_reply_to: lastEmail?.message_id_header || null,
        references: headers["References"] || null,
        from_email: fromAddress,
        from_name: "Pietro Montanti",
        to_email: contact.email,
        subject,
        text_body: emailContent.body,
        html_body: emailContent.html,
        received_at: new Date().toISOString(),
      }).select("id").single();

      await supabase
        .from("contacts")
        .update({
          next_action_at: null,
          next_action_note: buildMaintainRapportNote(0),
          last_action_at: today,
          last_action_note: "Mantenimento rapporto inviato",
          status: "Mantenimento rapporto",
        })
        .eq("id", contact.id);

      await supabase.from("notifications").insert({
        type: "email_sent",
        contact_id: contact.id,
        email_id: insertedMR?.id ?? null,
        title: `Mantenimento rapporto inviato a ${contact.name}`,
        body: emailContent.body.slice(0, 100) + "...",
      });
    } else {
      // Manual Reminder to Pietro
      const body = buildBody(today, {
        name: contact.name,
        email: contact.email,
        company: contact.company,
        role: contact.role,
        note: contact.next_action_note,
      });
      const subjectLabel = contact.name || contact.email || "Contatto";
      await transport.sendMail({
        from: fromAddress,
        to: reminderEmail,
        subject: `Follow-up da fare: ${subjectLabel}`,
        text: body,
      });
    }
    sent += 1;
  }

  // Handle Keep in Touch separately if needed (though they are usually in dueContacts)
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
};

export async function GET(request: Request) {
  return handleReminderRun(request);
}

export async function POST(request: Request) {
  return handleReminderRun(request);
}
