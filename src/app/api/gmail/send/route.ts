import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { getAiOutreachSendBlockReason } from "@/lib/aiOutreach";
import {
  SECOND_FOLLOW_UP_DAYS,
  buildAutomaticFollowUpNote,
  getAutomaticFollowUpStage,
  isKeepInTouchNote,
  toFollowUpDateOnly,
} from "@/lib/followUp";
import { buildOutboundAttachments, buildOutboundHtml } from "@/lib/outboundEmail";
import { getOwnerFilter, isUnauthorizedError, requireCurrentUser } from "@/lib/server/currentUser";
import { resolveEmailAccount } from "@/lib/server/emailAccounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CRM_NOTIFICATION_EMAIL = "pietromontanticomposer@gmail.com";

type SendPayload = {
  contactId?: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  replyToEmailId?: string;
  emailAccountId?: string;
  notificationKind?: string;
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
  addresses: Array<string | null | undefined>,
  ownerId?: string | null,
  includeLegacy = false
) => {
  const candidates = uniqueEmails(addresses);
  if (!candidates.length) return [];

  const supabase = getSupabase();
  const found = new Set<string>();
  const chunkSize = 25;
  const ownerModes =
    ownerId && includeLegacy ? ["owner", "legacy"] : ownerId ? ["owner"] : ["all"];

  for (let index = 0; index < candidates.length; index += chunkSize) {
    const chunk = candidates.slice(index, index + chunkSize);
    const filter = chunk
      .map((email) => `email.ilike.%${escapeIlike(email)}%`)
      .join(",");
    for (const ownerMode of ownerModes) {
      let query = supabase
        .from("contacts")
        .select("id")
        .or(filter)
        .limit(2000);

      if (ownerMode === "owner" && ownerId) {
        query = query.eq("owner_id", ownerId);
      } else if (ownerMode === "legacy") {
        query = query.is("owner_id", null);
      }

      const { data } = await query;
      data?.forEach((row) => {
        if (row.id) found.add(row.id);
      });
    }
  }

  return Array.from(found);
};

const buildReferencesHeader = (references?: string | null, messageId?: string) => {
  const parts = [references, messageId].filter(Boolean) as string[];
  if (!parts.length) return null;
  const unique = Array.from(new Set(parts.join(" ").split(/\s+/)));
  return unique.join(" ");
};

const getRecord = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const getOptionalString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const getHeaderValue = (raw: unknown, names: string[]) => {
  const record = getRecord(raw);
  if (!record) return null;

  for (const name of names) {
    const direct = getOptionalString(record[name]);
    if (direct) return direct;
  }

  const headers = Array.isArray(record.Headers)
    ? record.Headers
    : Array.isArray(record.headers)
      ? record.headers
      : [];

  for (const header of headers) {
    const headerRecord = getRecord(header);
    if (!headerRecord) continue;
    const headerName = getOptionalString(headerRecord.Name ?? headerRecord.name);
    if (!headerName) continue;
    if (!names.some((name) => headerName.toLowerCase() === name.toLowerCase())) {
      continue;
    }
    const value = getOptionalString(headerRecord.Value ?? headerRecord.value);
    if (value) return value;
  }

  return null;
};

const buildReplySubject = (
  threadSubject?: string | null,
  requestedSubject?: string | null
) => {
  const base = threadSubject?.trim() || requestedSubject?.trim() || "";
  if (!base) return "";
  return /^re:/i.test(base) ? base : `Re: ${base}`;
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

const updateContactAfterOutbound = async (
  contactId: string,
  sentAt: string,
  ownerFilter?: string | null
) => {
  const supabase = getSupabase();
  let contactQuery = supabase
    .from("contacts")
    .select("id, status, last_action_at, next_action_at, next_action_note")
    .eq("id", contactId);

  if (ownerFilter) {
    contactQuery = contactQuery.or(ownerFilter);
  }

  const { data: contact } = await contactQuery.maybeSingle();

  if (!contact || shouldSkipFollowUp(contact.status)) return;

  const sentDate = parseDateValue(sentAt) ?? new Date();
  const sentDateOnly = toFollowUpDateOnly(sentDate);

  const followUpDays = getFollowUpDays();
  const lastActionDate = parseDateValue(contact.last_action_at);
  const nextActionDate = parseDateValue(contact.next_action_at);
  const nextActionDateOnly = nextActionDate
    ? toFollowUpDateOnly(nextActionDate)
    : null;
  const automaticFollowUpStage = getAutomaticFollowUpStage(contact.next_action_note);
  const keepInTouch = isKeepInTouchNote(contact.next_action_note);
  const shouldRefreshLastAction =
    !lastActionDate || toFollowUpDateOnly(lastActionDate) < sentDateOnly;

  const updatePayload: Record<string, unknown> = {};
  if (shouldRefreshLastAction) {
    updatePayload.last_action_at = sentDateOnly;
    updatePayload.last_action_note = "Email inviata dal CRM";
    
    // Se lo stato è quello iniziale, lo mettiamo in "In attesa"
    if (contact.status === "Attiva auto follow-up") {
      updatePayload.status = "In attesa";
    }
  }
  if (!keepInTouch && automaticFollowUpStage === 1 && nextActionDateOnly) {
    if (nextActionDateOnly <= sentDateOnly) {
      updatePayload.next_action_at = toFollowUpDateOnly(
        addDays(sentDate, SECOND_FOLLOW_UP_DAYS)
      );
      updatePayload.next_action_note = buildAutomaticFollowUpNote(2);
    }
  } else if (!keepInTouch && automaticFollowUpStage === 2 && nextActionDateOnly) {
    if (nextActionDateOnly <= sentDateOnly) {
      updatePayload.next_action_at = null;
      updatePayload.next_action_note = null;
    }
  } else if (!keepInTouch && !automaticFollowUpStage && !nextActionDateOnly) {
    updatePayload.next_action_at = toFollowUpDateOnly(
      addDays(sentDate, followUpDays)
    );
    updatePayload.next_action_note = buildAutomaticFollowUpNote(1);
  }

  if (!Object.keys(updatePayload).length) {
    return;
  }

  let updateQuery = supabase
    .from("contacts")
    .update(updatePayload)
    .eq("id", contactId);

  if (ownerFilter) {
    updateQuery = updateQuery.or(ownerFilter);
  }

  await updateQuery;
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

const buildSentNotificationTitle = (payload: SendPayload) => {
  const to = payload.to?.trim() || "contatto";
  if (payload.notificationKind === "maintain") {
    return `Mantenimento rapporto inviato a ${to}`;
  }
  if (payload.notificationKind === "follow_up") {
    return `Follow-up inviato a ${to}`;
  }
  return `Email inviata a ${to}`;
};

const shouldEmailNotification = (payload: SendPayload) =>
  payload.notificationKind === "maintain" ||
  payload.notificationKind === "follow_up";

const buildCrmNotificationSendContext = () => {
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

  return {
    transport,
    fromAddress:
      getOptionalEnv("MAIL_FROM") ||
      getOptionalEnv("GMAIL_USER") ||
      "crm@local.test",
  };
};

const sendCrmNotificationEmail = async ({
  transport,
  from,
  to,
  title,
  body,
}: {
  transport: ReturnType<typeof nodemailer.createTransport>;
  from: string;
  to: string;
  title: string;
  body: string | null;
}) => {
  await transport.sendMail({
    from,
    to,
    subject: `CRM: ${title}`,
    text: [title, body ? `Oggetto: ${body}` : null]
      .filter(Boolean)
      .join("\n\n"),
  });
};

const normalizeId = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
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
  return data?.id ?? null;
};

export async function POST(request: Request) {
  let payload: SendPayload;
  let notificationEmailSent = false;
  let notificationEmailError: string | null = null;
  try {
    payload = (await request.json()) as SendPayload;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!payload?.to) {
    return NextResponse.json({ ok: false, error: "Missing to" }, { status: 400 });
  }

  const supabase = getSupabase();
  let currentUser: Awaited<ReturnType<typeof requireCurrentUser>>;
  try {
    currentUser = await requireCurrentUser(supabase);
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }
  const ownerFilter = getOwnerFilter(currentUser);
  const explicitContactId =
    typeof payload.contactId === "string" && payload.contactId.trim().length > 0
      ? payload.contactId.trim()
      : null;
  const recipientAddresses = extractEmails(payload.to);
  const matchedContactIds = explicitContactId
    ? []
    : await findContactIdsFromAddresses(
        recipientAddresses.length ? recipientAddresses : [payload.to],
        currentUser.id,
        currentUser.canAccessLegacyData
      );
  const contactId =
    explicitContactId ??
    (matchedContactIds.length === 1 ? matchedContactIds[0] : null);

  if (contactId) {
    const { data: contact } = await supabase
      .from("contacts")
      .select(
        "id, email, ai_batch_id, ai_status, ai_email_subject, ai_email_body, ai_validation_status"
      )
      .eq("id", contactId)
      .or(ownerFilter)
      .maybeSingle();

    if (!contact) {
      return NextResponse.json(
        { ok: false, error: "Contatto non trovato." },
        { status: 404 }
      );
    }

    const outreachBlock = getAiOutreachSendBlockReason(contact);
    if (outreachBlock) {
      return NextResponse.json(
        { ok: false, error: outreachBlock },
        { status: 409 }
      );
    }
  } else if (!explicitContactId && matchedContactIds.length > 1) {
    const { data: ambiguousMatches } = await supabase
      .from("contacts")
      .select(
        "id, email, ai_batch_id, ai_status, ai_email_subject, ai_email_body, ai_validation_status"
      )
      .in("id", matchedContactIds);

    for (const candidate of ambiguousMatches ?? []) {
      if (getAiOutreachSendBlockReason(candidate)) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Più contatti corrispondono al destinatario e almeno uno è un outreach AI non approvato. Specifica contactId per disambiguare.",
          },
          { status: 409 }
        );
      }
    }
  }

  let replyMessageId: string | null = null;
  let replyReferences: string | null = null;
  let replySubject: string | null = null;

  if (payload.replyToEmailId) {
    const { data } = await supabase
      .from("emails")
      .select("message_id_header, references, subject, raw")
      .eq("id", payload.replyToEmailId)
      .or(ownerFilter)
      .maybeSingle();

    replyMessageId =
      data?.message_id_header ??
      getHeaderValue(data?.raw, [
        "Message-ID",
        "Message-Id",
        "MessageID",
        "messageId",
      ]) ??
      null;
    replyReferences = buildReferencesHeader(
      data?.references ?? getHeaderValue(data?.raw, ["References", "references"]),
      replyMessageId ?? undefined
    );
    replySubject =
      data?.subject ?? getHeaderValue(data?.raw, ["Subject", "subject"]);
  }

  const subject = payload.replyToEmailId
    ? buildReplySubject(replySubject, payload.subject)
    : payload.subject?.trim() || "";

  const smtpConfig = getSmtpConfig();
  const requestedEmailAccountId = normalizeId(payload.emailAccountId);
  const emailAccountId =
    requestedEmailAccountId ||
    (!currentUser.canAccessLegacyData
      ? await getDefaultEmailAccountId(supabase, currentUser.id)
      : null);

  let transport: ReturnType<typeof nodemailer.createTransport>;
  let fromAddress: string;

  if (emailAccountId) {
    const account = await resolveEmailAccount(
      supabase,
      emailAccountId,
      currentUser.id,
      currentUser.canAccessLegacyData
    );
    if (!account.smtpHost || !account.smtpPort) {
      return NextResponse.json(
        { ok: false, error: "SMTP non configurato per questa casella." },
        { status: 400 }
      );
    }
    transport = nodemailer.createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure ?? account.smtpPort === 465,
      auth: { user: account.username, pass: account.password },
    });
    fromAddress = account.email;
  } else if (currentUser.canAccessLegacyData) {
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
  } else {
    return NextResponse.json(
      { ok: false, error: "Collega una casella email prima di inviare." },
      { status: 400 }
    );
  }

  const headers: Record<string, string> = {};
  if (replyMessageId) headers["In-Reply-To"] = replyMessageId;
  if (replyReferences) headers["References"] = replyReferences;

  const htmlBody = buildOutboundHtml(payload.html, payload.text);
  const outboundAttachments = buildOutboundAttachments(htmlBody);

  const info = await transport.sendMail({
    from: fromAddress,
    to: payload.to,
    subject: subject || undefined,
    text: payload.text,
    html: htmlBody,
    headers,
    attachments: outboundAttachments,
  });

  const now = new Date().toISOString();

  const { data: insertedEmail, error: insertedEmailError } = await supabase
    .from("emails")
    .insert({
      contact_id: contactId,
      owner_id: currentUser.id,
      direction: "outbound",
      gmail_uid: null,
      message_id_header: info.messageId ?? null,
      in_reply_to: replyMessageId,
      references: replyReferences,
      from_email: fromAddress,
      from_name: "Pietro Montanti",
      to_email: payload.to,
      subject: subject || null,
      text_body: payload.text ?? null,
      html_body: htmlBody ?? null,
      received_at: now,
      raw: {
        messageId: info.messageId ?? null,
        to: extractEmails(payload.to),
      },
    })
    .select("id")
    .single();

  if (insertedEmailError) {
    console.error("POST /api/gmail/send insert failed", insertedEmailError);
    return NextResponse.json(
      { ok: false, error: "Impossibile salvare l'email inviata." },
      { status: 500 }
    );
  }

  if (insertedEmail?.id) {
    const notificationTitle = buildSentNotificationTitle(payload);
    const notificationBody = subject || null;
    const { error: notificationError } = await supabase.from("notifications").insert({
      type: "email_sent",
      owner_id: currentUser.id,
      contact_id: contactId,
      email_id: insertedEmail.id,
      title: notificationTitle,
      body: notificationBody,
    });

    if (notificationError) {
      console.error("POST /api/gmail/send notification insert failed", notificationError);
    }

    if (!notificationError && shouldEmailNotification(payload)) {
      const notificationContext = buildCrmNotificationSendContext();
      await sendCrmNotificationEmail({
        transport: notificationContext.transport,
        from: notificationContext.fromAddress,
        to: CRM_NOTIFICATION_EMAIL,
        title: notificationTitle,
        body: notificationBody,
      }).then(() => {
        notificationEmailSent = true;
      }).catch((error) => {
        notificationEmailError =
          error instanceof Error ? error.message : "Invio notifica email fallito.";
        console.error("POST /api/gmail/send notification email failed", error);
      });
    }
  }

  const outboundContactIds = explicitContactId
    ? [explicitContactId]
    : matchedContactIds.length === 1
      ? matchedContactIds
      : [];
  for (const matchedId of outboundContactIds) {
    await updateContactAfterOutbound(matchedId, now, ownerFilter);
  }

  return NextResponse.json({
    ok: true,
    messageId: info.messageId,
    notificationEmailSent,
    notificationEmailError,
  });
}
