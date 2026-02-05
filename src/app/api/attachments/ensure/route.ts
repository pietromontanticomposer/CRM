import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getEnv = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var ${key}`);
  return value;
};

const getSupabase = () =>
  createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

const sanitizeFilename = (value?: string | null) => {
  if (!value) return "allegato";
  return value.replace(/[^\w.\-]+/g, "_");
};

const normalizeCid = (value?: string | null) => {
  if (!value) return null;
  return value.replace(/^<|>$/g, "");
};

const parseNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const pickAttachments = (raw: Record<string, unknown>) => {
  if (Array.isArray(raw.Attachments)) {
    return { key: "Attachments" as const, items: raw.Attachments as unknown[] };
  }
  if (Array.isArray(raw.attachments)) {
    return { key: "attachments" as const, items: raw.attachments as unknown[] };
  }
  return null;
};

const uploadBuffer = async (
  bucket: string,
  path: string,
  buffer: Buffer,
  contentType: string | null
) => {
  const supabase = getSupabase();
  const { error } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType: contentType ?? undefined,
    upsert: true,
  });
  if (error) {
    console.error("Attachment upload error", error);
    return null;
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
};

const ensurePostmarkAttachments = async (
  rawAttachments: unknown[],
  messageId: string
) => {
  const bucket =
    process.env.EMAIL_ATTACHMENTS_BUCKET?.trim() || "email-attachments";
  let changed = false;

  const results = await Promise.all(
    rawAttachments.map(async (attachment, index) => {
      if (!attachment || typeof attachment !== "object") {
        return null;
      }
      const value = attachment as Record<string, unknown>;
      const filename = sanitizeFilename(
        (value.Name as string) ||
          (value.FileName as string) ||
          (value.Filename as string) ||
          (value.filename as string) ||
          null
      );
      const contentType =
        (value.ContentType as string) ||
        (value.MimeType as string) ||
        (value.contentType as string) ||
        null;
      const size = parseNumber(
        value.ContentLength ?? value.Length ?? value.Size ?? value.size
      );
      const cid = normalizeCid(
        (value.ContentID as string) ||
          (value.ContentId as string) ||
          (value.contentId as string) ||
          (value.cid as string) ||
          null
      );
      const contentDisposition =
        (value.ContentDisposition as string) ||
        (value.contentDisposition as string) ||
        null;
      const inline = contentDisposition === "inline" || Boolean(cid);
      const existingUrl =
        (value.url as string) ||
        (value.Url as string) ||
        (value.publicUrl as string) ||
        null;
      const contentBase64 =
        (value.Content as string) || (value.content as string) || null;

      if (!contentBase64) {
        return {
          filename,
          contentType,
          size,
          cid,
          inline,
          url: existingUrl,
        };
      }

      changed = true;
      const buffer = Buffer.from(contentBase64, "base64");
      const path = `postmark/${messageId}/${index}-${Date.now()}-${filename}`;
      const url = await uploadBuffer(bucket, path, buffer, contentType);
      return {
        filename,
        contentType,
        size,
        cid,
        inline,
        url,
      };
    })
  );

  const sanitized = results.filter(Boolean) as Array<{
    filename: string;
    contentType: string | null;
    size: number | null;
    cid: string | null;
    inline: boolean;
    url: string | null;
  }>;

  if (!changed) {
    const missingUrl = sanitized.some((item) => !item.url);
    changed = missingUrl;
  }

  return { attachments: sanitized, changed };
};

const ensureGmailAttachments = async (gmailUid: number) => {
  const bucket =
    process.env.EMAIL_ATTACHMENTS_BUCKET?.trim() || "email-attachments";
  const user = getEnv("GMAIL_USER");
  const pass = getEnv("GMAIL_APP_PASSWORD");

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
  });

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
      let messageSource: Buffer | null = null;
      for await (const message of client.fetch(
        [gmailUid],
        { uid: true, source: true },
        { uid: true }
      )) {
        if (message.source) {
          messageSource = Buffer.isBuffer(message.source)
            ? message.source
            : Buffer.from(message.source);
        }
      }
      if (!messageSource) {
        return { attachments: [], changed: false };
      }

      const parsed = await simpleParser(messageSource);
      const attachments = parsed.attachments ?? [];
      if (!attachments.length) {
        return { attachments: [], changed: false };
      }

      const results: Array<{
        filename: string;
        contentType: string | null;
        size: number | null;
        cid: string | null;
        inline: boolean;
        url: string | null;
      }> = [];

      for (let i = 0; i < attachments.length; i += 1) {
        const attachment = attachments[i];
        const filename = sanitizeFilename(attachment.filename ?? null);
        const contentType = attachment.contentType ?? null;
        const size = attachment.size ?? null;
        const cid = normalizeCid(attachment.cid ?? null);
        const inline =
          Boolean(cid) || attachment.contentDisposition === "inline";
        const content =
          attachment.content && Buffer.isBuffer(attachment.content)
            ? attachment.content
            : attachment.content
              ? Buffer.from(attachment.content)
              : null;

        if (!content) {
          results.push({ filename, contentType, size, cid, inline, url: null });
          continue;
        }

        const path = `gmail/${gmailUid}/${i}-${Date.now()}-${filename}`;
        const url = await uploadBuffer(bucket, path, content, contentType);
        results.push({ filename, contentType, size, cid, inline, url });
      }

      return { attachments: results, changed: true };
    } finally {
      lock.release();
    }
  } catch (error) {
    console.error("Gmail attachment ensure error", error);
    return { attachments: [], changed: false };
  } finally {
    await client.logout().catch(() => undefined);
  }
};

export async function POST(request: Request) {
  let body: { emailId?: string } = {};
  try {
    body = (await request.json()) as { emailId?: string };
  } catch {
    body = {};
  }

  const emailId = body.emailId?.trim();
  if (!emailId) {
    return NextResponse.json(
      { ok: false, error: "Missing emailId" },
      { status: 400 }
    );
  }

  const supabase = getSupabase();
  const { data: emailRow, error } = await supabase
    .from("emails")
    .select("id, raw, gmail_uid, message_id_header")
    .eq("id", emailId)
    .maybeSingle();

  if (error || !emailRow) {
    return NextResponse.json(
      { ok: false, error: "Email not found" },
      { status: 404 }
    );
  }

  const raw =
    emailRow.raw && typeof emailRow.raw === "object"
      ? (emailRow.raw as Record<string, unknown>)
      : {};
  const attachmentInfo = pickAttachments(raw);
  const messageId =
    (raw.MessageID as string) ||
    (raw.messageId as string) ||
    emailRow.message_id_header ||
    emailRow.id;

  let updated = false;
  let source: "postmark" | "gmail" | "none" = "none";
  let nextRaw = raw;

  if (attachmentInfo?.items?.length) {
    const { attachments, changed } = await ensurePostmarkAttachments(
      attachmentInfo.items,
      messageId
    );
    if (changed) {
      nextRaw = {
        ...raw,
        [attachmentInfo.key]: attachments,
      };
      updated = true;
      source = attachmentInfo.key === "Attachments" ? "postmark" : "gmail";
    }
  }

  if (!updated && emailRow.gmail_uid) {
    const { attachments, changed } = await ensureGmailAttachments(
      Number(emailRow.gmail_uid)
    );
    if (changed) {
      nextRaw = { ...raw, attachments };
      updated = true;
      source = "gmail";
    }
  }

  if (updated) {
    const { error: updateError } = await supabase
      .from("emails")
      .update({ raw: nextRaw })
      .eq("id", emailRow.id);

    if (updateError) {
      console.error("Ensure attachment update error", updateError);
      return NextResponse.json({ ok: false }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, updated, source });
}
