import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import { createClient } from "@supabase/supabase-js";
import {
  extractEmails,
  extractMessageIds,
  normalizeEmail,
  rowMatchesAddresses,
  uniqueEmails,
} from "@/lib/server/emailMatching";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParsedAddress = {
  address?: string;
  name?: string;
};

type ParsedEmail = {
  from: ParsedAddress | null;
  to: string | null;
  toList: string[];
  ccList: string[];
  bccList: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  attachments: Array<{
    filename: string | null;
    contentType: string | null;
    size: number | null;
    cid: string | null;
    contentDisposition: string | null;
    content: Buffer | null;
  }>;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  date: string | null;
  raw: Record<string, unknown>;
};

const getEnv = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var ${key}`);
  return value;
};

const formatError = (error: unknown) => {
  if (!error) return "Unknown error";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const getSupabase = () =>
  createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

const normalizeText = (value?: string | null, max = 140) => {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
};

const parseReferences = (value?: string | string[] | null) => {
  if (!value) return null;
  if (Array.isArray(value)) return value.join(" ");
  return value;
};

const parseAddressList = (list?: AddressObject | AddressObject[]) => {
  if (!list) return null;
  const addressObjects = Array.isArray(list) ? list : [list];
  const addresses = addressObjects.flatMap((entry) => entry.value ?? []);
  if (!addresses.length) return null;
  return addresses.map((entry) => entry.address).filter(Boolean).join(", ");
};

const parseAddressArray = (list?: AddressObject | AddressObject[]) => {
  if (!list) return [];
  const addressObjects = Array.isArray(list) ? list : [list];
  return addressObjects
    .flatMap((entry) => entry.value ?? [])
    .map((entry) => entry.address)
    .filter(Boolean) as string[];
};

const parseEmail = async (source: Buffer | Uint8Array): Promise<ParsedEmail> => {
  const buffer = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const parsed = await simpleParser(buffer);
  const from = parsed.from?.value?.[0] ?? null;
  const toList = parseAddressArray(parsed.to);
  const ccList = parseAddressArray(parsed.cc);
  const bccList = parseAddressArray(parsed.bcc);
  const attachments =
    parsed.attachments?.map((attachment) => {
      const content =
        attachment.content && Buffer.isBuffer(attachment.content)
          ? attachment.content
          : attachment.content
            ? Buffer.from(attachment.content)
            : null;
      return {
        filename: attachment.filename ?? null,
        contentType: attachment.contentType ?? null,
        size: attachment.size ?? null,
        cid: attachment.cid ?? null,
        contentDisposition: attachment.contentDisposition ?? null,
        content,
      };
    }) ?? [];

  const rawHeaders = Array.from(parsed.headers.entries()).map(
    ([name, value]) => ({
      name,
      value: Array.isArray(value) ? value.join(", ") : String(value),
    })
  );

  return {
    from: from ? { address: from.address, name: from.name } : null,
    to: parseAddressList(parsed.to),
    toList,
    ccList,
    bccList,
    subject: parsed.subject?.trim() || null,
    text: parsed.text || null,
    html: parsed.html || null,
    attachments,
    messageId: parsed.messageId || null,
    inReplyTo: parseReferences(parsed.inReplyTo as string | string[] | null),
    references: parseReferences(parsed.references as string | string[] | null),
    date: parsed.date ? parsed.date.toISOString() : null,
    raw: {
      headers: rawHeaders,
    },
  };
};

const sanitizeFilename = (value?: string | null) => {
  if (!value) return "allegato";
  return value.replace(/[^\w.\-]+/g, "_");
};

const normalizeCid = (value?: string | null) => {
  if (!value) return null;
  return value.replace(/^<|>$/g, "");
};

const uploadAttachments = async (
  attachments: ParsedEmail["attachments"],
  gmailUid: number
) => {
  if (!attachments.length) return [];
  const bucket =
    process.env.EMAIL_ATTACHMENTS_BUCKET?.trim() || "email-attachments";
  const supabase = getSupabase();

  const results = await Promise.all(
    attachments.map(async (attachment, index) => {
      const filename = sanitizeFilename(attachment.filename);
      const safeCid = normalizeCid(attachment.cid);
      if (!attachment.content) {
        return {
          filename,
          contentType: attachment.contentType,
          size: attachment.size,
          cid: safeCid,
          inline:
            Boolean(safeCid) || attachment.contentDisposition === "inline",
          url: null,
        };
      }

      const path = `gmail/${gmailUid}/${index}-${Date.now()}-${filename}`;
      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, attachment.content, {
          contentType: attachment.contentType ?? undefined,
          upsert: true,
        });

      if (error) {
        console.error("Attachment upload error", error);
        return {
          filename,
          contentType: attachment.contentType,
          size: attachment.size,
          cid: safeCid,
          inline:
            Boolean(safeCid) || attachment.contentDisposition === "inline",
          url: null,
        };
      }

      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      return {
        filename,
        contentType: attachment.contentType,
        size: attachment.size,
        cid: safeCid,
        inline:
          Boolean(safeCid) || attachment.contentDisposition === "inline",
        url: data.publicUrl,
      };
    })
  );

  return results;
};

const getLastUid = async () => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("gmail_state")
    .select("last_uid")
    .eq("id", 1)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    await supabase.from("gmail_state").insert({ id: 1, last_uid: 0 });
    return 0;
  }

  const lastUid = Number(data.last_uid ?? 0);
  return Number.isFinite(lastUid) ? lastUid : 0;
};

const setLastUid = async (uid: number) => {
  if (!Number.isFinite(uid) || uid <= 0) return;
  const supabase = getSupabase();
  await supabase.from("gmail_state").upsert({
    id: 1,
    last_uid: uid,
    updated_at: new Date().toISOString(),
  });
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

const parseDateValue = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getFollowUpDays = () => {
  const raw = Number(process.env.FOLLOWUP_DAYS ?? 10);
  if (!Number.isFinite(raw)) return 10;
  return Math.max(1, Math.floor(raw));
};

const shouldSkipFollowUp = (status?: string | null) =>
  status === "Chiuso" || status === "Non interessato";

const updateContactAfterOutbound = async (
  contactId: string,
  sentAt?: string | null
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
  const followUpDateOnly = toDateOnly(addDays(firstOutboundDate, followUpDays));
  const lastActionDate = parseDateValue(contact.last_action_at);
  const nextActionDate = parseDateValue(contact.next_action_at);
  const shouldRefreshLastAction =
    !lastActionDate || toDateOnly(lastActionDate) < sentDateOnly;
  const shouldRefreshFollowUp =
    (nextActionDate ? toDateOnly(nextActionDate) : null) !== followUpDateOnly;

  if (!shouldPromoteStatus && !shouldRefreshLastAction && !shouldRefreshFollowUp) {
    return;
  }

  const updatePayload: Record<string, unknown> = {};
  if (shouldPromoteStatus) {
    updatePayload.status = promotedStatus;
  }
  if (shouldRefreshLastAction) {
    updatePayload.last_action_at = sentDateOnly;
    updatePayload.last_action_note = "Email inviata (sync Gmail)";
  }
  if (shouldRefreshFollowUp) {
    updatePayload.next_action_at = followUpDateOnly;
    updatePayload.next_action_note = `Follow-up automatico (${followUpDays} giorni)`;
  }

  await supabase
    .from("contacts")
    .update(updatePayload)
    .eq("id", contactId);
};

const escapeIlike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const buildRecipientList = (
  toList: string[],
  ccList: string[],
  bccList: string[]
) => {
  const recipients: string[] = [];
  const seen = new Set<string>();
  const addAddress = (value: string) => {
    const normalized = normalizeEmail(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    recipients.push(value);
  };
  for (const address of [...toList, ...ccList, ...bccList]) {
    addAddress(address);
  }
  return recipients;
};

const findContactIdsFromAddresses = async (
  addresses: Array<string | null | undefined>
) => {
  const candidates = uniqueEmails(addresses);
  if (!candidates.length) return [];
  const supabase = getSupabase();
  const found = new Set<string>();
  const addressSet = new Set(candidates);
  const chunkSize = 25;

  for (let index = 0; index < candidates.length; index += chunkSize) {
    const chunk = candidates.slice(index, index + chunkSize);
    const contactFilter = chunk
      .map((email) => `email.ilike.%${escapeIlike(email)}%`)
      .join(",");
    const { data: contactRows } = await supabase
      .from("contacts")
      .select("id, email")
      .or(contactFilter)
      .limit(2000);

    contactRows?.forEach((row) => {
      const exactContactEmails = extractEmails(row.email);
      if (row.id && exactContactEmails.some((email) => addressSet.has(email))) {
        found.add(row.id);
      }
    });

    const emailFilter = chunk
      .flatMap((email) => [
        `from_email.ilike.%${escapeIlike(email)}%`,
        `to_email.ilike.%${escapeIlike(email)}%`,
      ])
      .join(",");
    const { data: linkedEmailRows } = await supabase
      .from("emails")
      .select("contact_id, direction, from_email, to_email, raw")
      .not("contact_id", "is", null)
      .or(emailFilter)
      .limit(2000);

    linkedEmailRows?.forEach((row) => {
      if (row.contact_id && rowMatchesAddresses(row, addressSet)) {
        found.add(row.contact_id);
      }
    });
  }

  return Array.from(found);
};

const buildMessageIdVariants = (values: Array<string | null | undefined>) =>
  Array.from(
    new Set(
      values
        .flatMap((value) => extractMessageIds(value))
        .flatMap((id) => [id, `<${id}>`])
    )
  );

const findContactIdsFromThread = async (
  values: Array<string | null | undefined>
) => {
  const messageIds = buildMessageIdVariants(values);
  if (!messageIds.length) return [];

  const supabase = getSupabase();
  const found = new Set<string>();
  const chunkSize = 50;

  for (let index = 0; index < messageIds.length; index += chunkSize) {
    const chunk = messageIds.slice(index, index + chunkSize);
    const { data } = await supabase
      .from("emails")
      .select("contact_id")
      .in("message_id_header", chunk)
      .not("contact_id", "is", null)
      .limit(2000);

    data?.forEach((row) => {
      if (row.contact_id) found.add(row.contact_id);
    });
  }

  return Array.from(found);
};

const insertEmail = async (payload: {
  contact_id: string | null;
  direction: "inbound" | "outbound";
  gmail_uid: number;
  message_id_header: string | null;
  in_reply_to: string | null;
  references: string | null;
  from_email: string | null;
  from_name: string | null;
  to_email: string | null;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  received_at: string | null;
  raw: Record<string, unknown>;
}) => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("emails")
    .insert(payload)
    .select("id, contact_id")
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
};

const insertNotification = async (payload: {
  type: "email_received" | "email_sent";
  contact_id: string | null;
  email_id: string;
  title: string;
  body: string | null;
}) => {
  const supabase = getSupabase();
  await supabase.from("notifications").insert(payload);
};

export const runSync = async (request: Request) => {
  const cronSecret = request.headers.get("x-cron-secret");
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    return NextResponse.json(
      { ok: false, error: "Missing GMAIL_USER or GMAIL_APP_PASSWORD" },
      { status: 500 }
    );
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
  });

  let processed = 0;
  let maxUid = 0;

  let step = "connect";

  try {
    await client.connect();
    step = "list mailboxes";
    const mailboxes = await client.list();
    const allMail =
      mailboxes.find((box) => box.specialUse === "\\All") ||
      mailboxes.find((box) =>
        box.path?.toLowerCase().includes("all mail")
      ) ||
      mailboxes.find((box) => box.specialUse === "\\Inbox");
    const mailboxPath = allMail?.path || "INBOX";

    step = "get mailbox lock";
    const lock = await client.getMailboxLock(mailboxPath);

    try {
      step = "get last uid";
      const lastUid = await getLastUid();
      maxUid = lastUid;
      const maxPerRun = Math.max(
        1,
        Number(process.env.GMAIL_SYNC_LIMIT ?? 50)
      );
      step = "search uids";
      const uids = await client.search(
        { uid: `${lastUid + 1}:*` },
        { uid: true }
      );

      if (!uids || uids.length === 0) {
        return NextResponse.json({
          ok: true,
          processed: 0,
          last_uid: maxUid,
          range: null,
        });
      }

      const batch = uids.slice(0, maxPerRun);
      const startUid = batch[0];
      const endUid = batch[batch.length - 1];

      step = "fetch messages";
      for await (const message of client.fetch(
        batch,
        { uid: true, source: true },
        { uid: true }
      )) {
        if (!message.uid || !message.source) continue;
        if (message.uid > maxUid) maxUid = message.uid;

        const supabase = getSupabase();
        const { data: existing } = await supabase
          .from("emails")
          .select("id, contact_id, from_email, to_email")
          .eq("gmail_uid", message.uid)
          .maybeSingle();

        const parsed = await parseEmail(message.source as Buffer | Uint8Array);
        const attachmentsMeta = await uploadAttachments(
          parsed.attachments,
          message.uid
        );
        const fromEmail = parsed.from?.address ?? null;
        const fromName = parsed.from?.name ?? null;
        const recipients = buildRecipientList(
          parsed.toList,
          parsed.ccList,
          parsed.bccList
        );
        const recipientsDisplay = recipients.length
          ? recipients.join(", ")
          : null;

        const isOutbound =
          normalizeEmail(fromEmail) === normalizeEmail(user);
        const threadMatchedContactIds = await findContactIdsFromThread([
          parsed.inReplyTo,
          parsed.references,
        ]);
        const addressMatchedContactIds = isOutbound
          ? await findContactIdsFromAddresses(
              recipients.filter(
                (address) => normalizeEmail(address) !== normalizeEmail(user)
              )
            )
          : await findContactIdsFromAddresses([fromEmail]);
        const matchedContactIds =
          threadMatchedContactIds.length === 1
            ? threadMatchedContactIds
            : addressMatchedContactIds.length === 1
              ? addressMatchedContactIds
              : [];
        const contactId =
          matchedContactIds.length === 1 ? (matchedContactIds[0] ?? null) : null;
        const direction = isOutbound ? "outbound" : "inbound";

        if (existing) {
          const shouldUpdateContact =
            !existing.contact_id && Boolean(contactId);
          const shouldUpdateFrom = !existing.from_email && Boolean(fromEmail);
          const shouldUpdateTo =
            Boolean(recipientsDisplay) &&
            existing.to_email !== recipientsDisplay;
          const shouldUpdateAttachments = attachmentsMeta.length > 0;

          if (
            shouldUpdateContact ||
            shouldUpdateFrom ||
            shouldUpdateTo ||
            shouldUpdateAttachments
          ) {
            await supabase
              .from("emails")
              .update({
                contact_id: shouldUpdateContact
                  ? contactId
                  : existing.contact_id,
                from_email: shouldUpdateFrom
                  ? fromEmail
                  : existing.from_email,
                to_email: shouldUpdateTo
                  ? recipientsDisplay
                  : existing.to_email,
                ...(shouldUpdateAttachments
                  ? {
                      raw: {
                        uid: message.uid,
                        cc: parsed.ccList,
                        bcc: parsed.bccList,
                        ...parsed.raw,
                        attachments: attachmentsMeta,
                      },
                    }
                  : {}),
              })
              .eq("id", existing.id);
          }
          if (direction === "outbound") {
            const outboundContactIds = new Set<string>();
            matchedContactIds.forEach((id) => outboundContactIds.add(id));
            if (existing.contact_id) {
              outboundContactIds.add(existing.contact_id);
            }
            for (const outboundContactId of outboundContactIds) {
              await updateContactAfterOutbound(outboundContactId, parsed.date);
            }
          }
          continue;
        }

        const { data: insertedEmail, error } = await insertEmail({
          contact_id: contactId,
          direction,
          gmail_uid: message.uid,
          message_id_header: parsed.messageId,
          in_reply_to: parsed.inReplyTo,
          references: parsed.references,
          from_email: fromEmail,
          from_name: fromName,
          to_email: recipientsDisplay,
          subject: parsed.subject,
          text_body: parsed.text,
          html_body: parsed.html,
          received_at: parsed.date,
          raw: {
            uid: message.uid,
            cc: parsed.ccList,
            bcc: parsed.bccList,
            ...parsed.raw,
            attachments: attachmentsMeta,
          },
        });

        if (error) {
          if (error.code === "23505") {
            continue;
          }
          console.error("Gmail sync insert error", error);
          continue;
        }

        if (insertedEmail) {
          const titleBase = fromName || fromEmail || "Mittente sconosciuto";
          await insertNotification({
            type: "email_received",
            contact_id: contactId,
            email_id: insertedEmail.id,
            title: `Nuova email da ${titleBase}`,
            body: parsed.subject || normalizeText(parsed.text),
          });
        }

        if (direction === "outbound") {
          const outboundContactIds = new Set<string>();
          matchedContactIds.forEach((id) => outboundContactIds.add(id));
          if (contactId) {
            outboundContactIds.add(contactId);
          }
          for (const outboundContactId of outboundContactIds) {
            await updateContactAfterOutbound(outboundContactId, parsed.date);
          }
        }

        processed += 1;
      }

      if (maxUid > lastUid) {
        await setLastUid(maxUid);
      }

      return NextResponse.json({
        ok: true,
        processed,
        last_uid: maxUid,
        range: { start: startUid, end: endUid },
      });
    } finally {
      lock.release();
    }
  } catch (error) {
    console.error("Gmail sync error", error);
    const code = (error as { code?: string | number })?.code;
    const message = formatError(error);
    const suffix = code ? ` (${code})` : "";
    return NextResponse.json(
      { ok: false, error: `Sync failed at ${step}: ${message}${suffix}` },
      { status: 500 }
    );
  } finally {
    await client.logout().catch(() => undefined);
  }

  return NextResponse.json({ ok: true, processed, last_uid: maxUid });
};

export async function GET(request: Request) {
  return runSync(request);
}

export async function POST(request: Request) {
  return runSync(request);
}
