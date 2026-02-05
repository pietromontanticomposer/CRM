import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 400;

type ParsedAddress = {
  address?: string;
  name?: string;
};

type ParsedEmail = {
  from: ParsedAddress | null;
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

const getSupabase = () =>
  createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

const normalizeEmail = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
};

const uniqueEmails = (values: string[]) => {
  const unique = new Set<string>();
  values.forEach((value) => {
    const normalized = normalizeEmail(value);
    if (normalized) unique.add(normalized);
  });
  return Array.from(unique);
};

const parseAddressArray = (list?: AddressObject | AddressObject[]) => {
  if (!list) return [];
  const addressObjects = Array.isArray(list) ? list : [list];
  return addressObjects
    .flatMap((entry) => entry.value ?? [])
    .map((entry) => entry.address)
    .filter(Boolean) as string[];
};

const parseReferences = (value?: string | string[] | null) => {
  if (!value) return null;
  if (Array.isArray(value)) return value.join(" ");
  return value;
};

const parseEmail = async (source: Buffer | Uint8Array): Promise<ParsedEmail> => {
  const buffer = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const parsed = await simpleParser(buffer);
  const from = parsed.from?.value?.[0] ?? null;
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
    toList: parseAddressArray(parsed.to),
    ccList: parseAddressArray(parsed.cc),
    bccList: parseAddressArray(parsed.bcc),
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

const parsePayload = async (request: Request) => {
  try {
    const body = (await request.json()) as {
      emails?: string[];
      limit?: number;
      contactId?: string;
    };
    const emails = Array.isArray(body?.emails) ? body.emails : [];
    const limit = Number(body?.limit ?? DEFAULT_LIMIT);
    return {
      emails,
      limit: Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(limit) ? limit : DEFAULT_LIMIT)),
      contactId: body?.contactId ?? null,
    };
  } catch {
    return { emails: [], limit: DEFAULT_LIMIT, contactId: null };
  }
};

export async function POST(request: Request) {
  const { emails, limit, contactId } = await parsePayload(request);
  const cleaned = uniqueEmails(emails);
  if (!cleaned.length) {
    return NextResponse.json({ ok: false, error: "Missing emails" }, { status: 400 });
  }

  const user = getEnv("GMAIL_USER");
  const pass = getEnv("GMAIL_APP_PASSWORD");
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
  });

  let processed = 0;
  let inserted = 0;
  let updated = 0;

  try {
    await client.connect();
    const mailboxes = await client.list();
    const allMail =
      mailboxes.find((box) => box.specialUse === "\\All") ||
      mailboxes.find((box) =>
        box.path?.toLowerCase().includes("all mail")
      ) ||
      mailboxes.find((box) => box.specialUse === "\\Inbox");
    const mailboxPath = allMail?.path || "INBOX";

    const lock = await client.getMailboxLock(mailboxPath);
    try {
      const orQueries = cleaned.flatMap((address) => [
        { from: address },
        { to: address },
        { cc: address },
        { bcc: address },
      ]);
      const query =
        orQueries.length === 1 ? orQueries[0] : { or: orQueries };

      const allUids = await client.search(query, { uid: true });
      const uidList = Array.isArray(allUids) ? allUids : [];
      if (!uidList.length) {
        return NextResponse.json({ ok: true, processed: 0, inserted: 0, updated: 0 });
      }

      const slice = uidList.slice(-limit);

      for await (const message of client.fetch(
        slice,
        { uid: true, source: true },
        { uid: true }
      )) {
        if (!message.uid || !message.source) continue;
        processed += 1;

        const supabase = getSupabase();
        const { data: existing } = await supabase
          .from("emails")
          .select("id, contact_id, raw")
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
        const direction = isOutbound ? "outbound" : "inbound";

        if (existing) {
          const shouldUpdateContact =
            !existing.contact_id && Boolean(contactId);
          const existingRaw =
            existing.raw && typeof existing.raw === "object"
              ? (existing.raw as Record<string, unknown>)
              : {};
          const existingAttachments = Array.isArray(
            (existingRaw as { attachments?: unknown }).attachments
          )
            ? ((existingRaw as { attachments?: unknown[] })
                .attachments as unknown[])
            : [];
          const hasUrls =
            existingAttachments.length > 0 &&
            existingAttachments.every((item) =>
              Boolean((item as { url?: string | null })?.url)
            );
          const shouldUpdateAttachments =
            attachmentsMeta.length > 0 && !hasUrls;

          if (shouldUpdateContact || shouldUpdateAttachments) {
            await supabase
              .from("emails")
              .update({
                contact_id: shouldUpdateContact
                  ? contactId
                  : existing.contact_id,
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
            updated += 1;
          }
          continue;
        }

        const { error } = await supabase.from("emails").insert({
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
          if (error.code === "23505") continue;
          console.error("Backfill insert error", error);
          continue;
        }
        inserted += 1;
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    console.error("Backfill contact error", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  } finally {
    await client.logout().catch(() => undefined);
  }

  return NextResponse.json({ ok: true, processed, inserted, updated });
}
