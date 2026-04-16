import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import {
  KEEP_IN_TOUCH_MONTHS,
  KEEP_IN_TOUCH_NOTE,
  isKeepInTouchNote,
  getAutomaticFollowUpStage,
  AUTO_FOLLOW_UP_2_NOTE,
  SECOND_FOLLOW_UP_DAYS,
  DEAD_CONTACT_DAYS,
  DEAD_CONTACT_CHECK_NOTE,
  isDeadContactCheckNote,
  buildAutoFollowUpEmail1,
  buildAutoFollowUpEmail2,
  buildMaintainRapportEmail,
  isMaintainRapportNote,
  buildMaintainRapportNote,
  type FollowUpLanguage,
} from "@/lib/followUp";
import { detectLanguageFromEmail, stripHtml } from "@/lib/languageDetection";
import { buildOutboundAttachments, buildOutboundHtml } from "@/lib/outboundEmail";
import { resolveEmailAccount, type EmailProvider } from "@/lib/server/emailAccounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const REMINDER_RECIPIENT = "pietromontanticomposer@gmail.com";

type DueContact = {
  id: string;
  owner_id: string | null;
  name: string | null;
  email: string | null;
  company: string | null;
  role: string | null;
  status: string | null;
  next_action_at: string | null;
  next_action_note: string | null;
};

type SendContext = {
  transport: ReturnType<typeof nodemailer.createTransport>;
  fromAddress: string;
  emailAccountId: string | null;
  provider: EmailProvider | "gmail" | null;
};

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

const buildLegacySendContext = (): SendContext => {
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

  return {
    transport,
    fromAddress:
      getOptionalEnv("MAIL_FROM") ||
      getOptionalEnv("GMAIL_USER") ||
      "crm@local.test",
    emailAccountId: null,
    provider: "gmail",
  };
};

const getDefaultEmailAccountId = async (
  supabase: ReturnType<typeof getSupabase>,
  ownerId: string
) => {
  const { data, error } = await supabase
    .from("email_accounts")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("sync_enabled", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return typeof data?.id === "string" ? data.id : null;
};

const buildOwnerSendContext = async (
  supabase: ReturnType<typeof getSupabase>,
  ownerId: string
): Promise<SendContext | null> => {
  const accountId = await getDefaultEmailAccountId(supabase, ownerId);
  if (!accountId) return null;

  const account = await resolveEmailAccount(supabase, accountId, ownerId, false);
  if (!account.smtpHost || !account.smtpPort) return null;

  return {
    transport: nodemailer.createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure ?? account.smtpPort === 465,
      auth: { user: account.username, pass: account.password },
    }),
    fromAddress: account.email,
    emailAccountId: account.id,
    provider: account.provider,
  };
};

const getOwnerNotificationEmail = async () => {
  return REMINDER_RECIPIENT;
};

const sendNotificationEmail = async (
  transport: ReturnType<typeof nodemailer.createTransport>,
  from: string,
  to: string,
  title: string,
  body?: string | null
) => {
  await transport.sendMail({
    from,
    to,
    subject: `CRM: ${title}`,
    text: [title, body ? `Dettaglio: ${body}` : null]
      .filter(Boolean)
      .join("\n\n"),
  });
};

const updateContactForOwner = (
  supabase: ReturnType<typeof getSupabase>,
  contact: Pick<DueContact, "id" | "owner_id">,
  payload: Record<string, unknown>
) => {
  const query = supabase.from("contacts").update(payload).eq("id", contact.id);
  return contact.owner_id
    ? query.eq("owner_id", contact.owner_id)
    : query.is("owner_id", null);
};

type InboundEmailRow = {
  contact_id: string | null;
  received_at: string | null;
  created_at: string | null;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
};

const getTimestamp = (value?: string | null) => {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const loadContactLanguageMap = async (
  supabase: ReturnType<typeof getSupabase>,
  contactIds: string[]
) => {
  const map = new Map<string, FollowUpLanguage | null>();
  if (!contactIds.length) return map;

  const { data: inboundRows, error } = await supabase
    .from("emails")
    .select("contact_id, received_at, created_at, subject, text_body, html_body")
    .eq("direction", "inbound")
    .in("contact_id", contactIds);

  if (error) {
    throw error;
  }

  const latestByContact = new Map<string, { ts: number; text: string }>();
  (inboundRows as InboundEmailRow[] | null)?.forEach((row) => {
    if (!row.contact_id) return;
    const candidateTs = getTimestamp(row.received_at ?? row.created_at);
    const current = latestByContact.get(row.contact_id);
    if (current && current.ts >= candidateTs) return;
    latestByContact.set(row.contact_id, {
      ts: candidateTs,
      text: [row.text_body, stripHtml(row.html_body), row.subject]
        .filter(Boolean)
        .join(" "),
    });
  });

  latestByContact.forEach((value, contactId) => {
    map.set(contactId, detectLanguageFromEmail(value.text));
  });

  return map;
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

const getContactLabel = (item: { name: string | null; email: string | null }) =>
  item.name || item.email || "Contatto";

const BATCH_LIMIT = 10;

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
      "id, owner_id, name, email, company, role, status, next_action_at, next_action_note"
    )
    .lte("next_action_at", today)
    .neq("status", "Non interessato")
    .neq("status", "Collaborazione stabilita")
    .neq("status", "Contatto morto")
    .order("next_action_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Failed to fetch follow-ups" },
      { status: 500 }
    );
  }

  if (!dueContacts || dueContacts.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, remaining: 0 });
  }

  const allContacts = (dueContacts ?? []) as DueContact[];
  const contacts = allContacts.slice(0, BATCH_LIMIT);
  const remaining = Math.max(allContacts.length - BATCH_LIMIT, 0);
  const contactLanguageMap = await loadContactLanguageMap(
    supabase,
    contacts.map((contact) => contact.id)
  );

  const legacySendContext = buildLegacySendContext();
  const ownerSendContextCache = new Map<string, SendContext | null>();
  const notificationRecipients = new Map<string, string>();

  let sent = 0;
  const signatureHtml = getOptionalEnv("EMAIL_SIGNATURE_HTML");

  const getSendContext = async (contact: DueContact) => {
    if (!contact.owner_id) return legacySendContext;
    if (!ownerSendContextCache.has(contact.owner_id)) {
      ownerSendContextCache.set(
        contact.owner_id,
        await buildOwnerSendContext(supabase, contact.owner_id)
      );
    }
    return ownerSendContextCache.get(contact.owner_id) ?? null;
  };

  const getNotificationRecipient = async (contact: DueContact) => {
    const key = contact.owner_id || "legacy";
    if (!notificationRecipients.has(key)) {
      notificationRecipients.set(
        key,
        await getOwnerNotificationEmail()
      );
    }
    return notificationRecipients.get(key) ?? REMINDER_RECIPIENT;
  };

  const insertNotificationAndSendEmail = async (
    contact: DueContact,
    emailId: string | null | undefined,
    title: string,
    body: string | null
  ) => {
    await supabase.from("notifications").insert({
      type: "email_sent",
      owner_id: contact.owner_id ?? null,
      contact_id: contact.id,
      email_id: emailId ?? null,
      title,
      body,
    });

    const recipient = await getNotificationRecipient(contact);
    await sendNotificationEmail(
      legacySendContext.transport,
      legacySendContext.fromAddress,
      recipient,
      title,
      body
    ).catch((error) => {
      console.error("Reminder notification email failed", error);
    });
  };

  for (const contact of contacts) {
    const stage = getAutomaticFollowUpStage(contact.next_action_note);
    const language = contactLanguageMap.get(contact.id) ?? "it";
    const ownerFilter = contact.owner_id
      ? `owner_id.eq.${contact.owner_id}`
      : "owner_id.is.null";
    const sendContext = await getSendContext(contact);

    if (stage && contact.email) {
      if (!sendContext) {
        console.error(
          `No email account available for automatic follow-up contact ${contact.id}`
        );
        continue;
      }
      // Automatic Follow-up
      const contactLabel = getContactLabel(contact);
      const emailContent =
        stage === 1
          ? buildAutoFollowUpEmail1(
              contact.name ?? "",
              signatureHtml,
              language,
              contact.role
            )
          : buildAutoFollowUpEmail2(
              contact.name ?? "",
              signatureHtml,
              language,
              contact.role
            );

      // Try to find the last email for threading
      const { data: lastEmail } = await supabase
        .from("emails")
        .select("message_id_header, references, subject")
        .eq("contact_id", contact.id)
        .or(ownerFilter)
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

      const htmlBody = buildOutboundHtml(emailContent.html, emailContent.body);
      const outboundAttachments = buildOutboundAttachments(htmlBody);

      const info = await sendContext.transport.sendMail({
        from: sendContext.fromAddress,
        to: contact.email,
        subject,
        text: emailContent.body,
        html: htmlBody,
        headers,
        attachments: outboundAttachments,
      });

      // Save the sent email
      const { data: insertedFollowUp } = await supabase.from("emails").insert({
        contact_id: contact.id,
        owner_id: contact.owner_id ?? null,
        direction: "outbound",
        email_account_id: sendContext.emailAccountId,
        provider: sendContext.provider,
        message_id_header: info.messageId,
        in_reply_to: lastEmail?.message_id_header || null,
        references: headers["References"] || null,
        from_email: sendContext.fromAddress,
        from_name: "Pietro Montanti",
        to_email: contact.email,
        subject,
        text_body: emailContent.body,
        html_body: htmlBody ?? null,
        received_at: new Date().toISOString(),
      }).select("id").single();

      // Update contact state
      if (stage === 1) {
        await updateContactForOwner(supabase, contact, {
            next_action_at: addDaysToDateOnly(today, SECOND_FOLLOW_UP_DAYS),
            next_action_note: AUTO_FOLLOW_UP_2_NOTE,
            last_action_at: today,
            last_action_note: "Follow-up automatico 1/2 inviato",
          });
      } else {
        await updateContactForOwner(supabase, contact, {
            next_action_at: addDaysToDateOnly(today, DEAD_CONTACT_DAYS),
            next_action_note: DEAD_CONTACT_CHECK_NOTE,
            last_action_at: today,
            last_action_note: "Follow-up automatico 2/2 inviato (fine)",
          });
      }

      await insertNotificationAndSendEmail(
        contact,
        insertedFollowUp?.id,
        `Follow-up automatico inviato a ${contactLabel}`,
        emailContent.body.slice(0, 100) + "..."
      );
    } else if (isMaintainRapportNote(contact.next_action_note) && contact.email) {
      if (!sendContext) {
        console.error(
          `No email account available for maintain rapport contact ${contact.id}`
        );
        continue;
      }
      // Mantenimento rapporto schedulato
      const contactLabel = getContactLabel(contact);
      const emailContent = buildMaintainRapportEmail(
        contact.name ?? "",
        signatureHtml,
        language,
        contact.role
      );

      const { data: lastEmail } = await supabase
        .from("emails")
        .select("message_id_header, references, subject")
        .eq("contact_id", contact.id)
        .or(ownerFilter)
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

      const htmlBody = buildOutboundHtml(emailContent.html, emailContent.body);
      const outboundAttachments = buildOutboundAttachments(htmlBody);

      const info = await sendContext.transport.sendMail({
        from: sendContext.fromAddress,
        to: contact.email,
        subject,
        text: emailContent.body,
        html: htmlBody,
        headers,
        attachments: outboundAttachments,
      });

      const { data: insertedMR } = await supabase.from("emails").insert({
        contact_id: contact.id,
        owner_id: contact.owner_id ?? null,
        direction: "outbound",
        email_account_id: sendContext.emailAccountId,
        provider: sendContext.provider,
        message_id_header: info.messageId,
        in_reply_to: lastEmail?.message_id_header || null,
        references: headers["References"] || null,
        from_email: sendContext.fromAddress,
        from_name: "Pietro Montanti",
        to_email: contact.email,
        subject,
        text_body: emailContent.body,
        html_body: htmlBody ?? null,
        received_at: new Date().toISOString(),
      }).select("id").single();

      await updateContactForOwner(supabase, contact, {
          next_action_at: null,
          next_action_note: buildMaintainRapportNote(0),
          last_action_at: today,
          last_action_note: "Mantenimento rapporto inviato",
          status: "Mantenimento rapporto",
      });

      await insertNotificationAndSendEmail(
        contact,
        insertedMR?.id,
        `Mantenimento rapporto inviato a ${contactLabel}`,
        emailContent.body.slice(0, 100) + "..."
      );
    } else if (isDeadContactCheckNote(contact.next_action_note)) {
      // 30 giorni dopo il 2° follow-up senza risposta → contatto morto
      const contactLabel = getContactLabel(contact);
      await updateContactForOwner(supabase, contact, {
        next_action_at: null,
        next_action_note: null,
        status: "Contatto morto",
      });

      await supabase.from("notifications").insert({
        type: "email_sent",
        owner_id: contact.owner_id ?? null,
        contact_id: contact.id,
        email_id: null,
        title: `Contatto morto: ${contactLabel}`,
        body: "Nessuna risposta dopo 30 giorni dal secondo follow-up.",
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
      const recipient = await getNotificationRecipient(contact);
      await legacySendContext.transport.sendMail({
        from: legacySendContext.fromAddress,
        to: recipient || reminderEmail,
        subject: `Follow-up da fare: ${subjectLabel}`,
        text: body,
      });
    }
    sent += 1;
  }

  // Handle Keep in Touch separately if needed (though they are usually in dueContacts)
  const keepInTouchContacts = contacts.filter((contact) =>
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
      await updateContactForOwner(supabase, contact, {
          next_action_at: nextDate,
          next_action_note: KEEP_IN_TOUCH_NOTE,
        });
    }
  }

  return NextResponse.json({ ok: true, sent, remaining });
};

export async function GET(request: Request) {
  return handleReminderRun(request);
}

export async function POST(request: Request) {
  return handleReminderRun(request);
}
