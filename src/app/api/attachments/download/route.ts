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

const pickAttachments = (raw: Record<string, unknown>) => {
  if (Array.isArray(raw.Attachments)) {
    return raw.Attachments as unknown[];
  }
  if (Array.isArray(raw.attachments)) {
    return raw.attachments as unknown[];
  }
  return [];
};

const parseStoragePathFromUrl = (url: string, bucket: string) => {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const bucketIndex = parts.findIndex((part) => part === bucket);
    if (bucketIndex === -1) return null;
    const path = parts.slice(bucketIndex + 1).join("/");
    return path || null;
  } catch {
    return null;
  }
};

const downloadFromStorage = async (
  bucket: string,
  path: string
): Promise<Buffer | null> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    console.error("Storage download error", error);
    return null;
  }
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

const downloadFromUrl = async (url: string): Promise<Buffer | null> => {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error("Fetch download error", error);
    return null;
  }
};

const downloadFromGmail = async (
  gmailUid: number,
  index: number
): Promise<{
  buffer: Buffer | null;
  filename: string | null;
  contentType: string | null;
  inline: boolean;
}> => {
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
        return { buffer: null, filename: null, contentType: null, inline: false };
      }

      const parsed = await simpleParser(messageSource);
      const attachments = parsed.attachments ?? [];
      if (!attachments.length || !attachments[index]) {
        return { buffer: null, filename: null, contentType: null, inline: false };
      }

      const attachment = attachments[index];
      const content =
        attachment.content && Buffer.isBuffer(attachment.content)
          ? attachment.content
          : attachment.content
            ? Buffer.from(attachment.content)
            : null;

      return {
        buffer: content,
        filename: attachment.filename ?? null,
        contentType: attachment.contentType ?? null,
        inline:
          Boolean(normalizeCid(attachment.cid ?? null)) ||
          attachment.contentDisposition === "inline",
      };
    } finally {
      lock.release();
    }
  } catch (error) {
    console.error("Gmail attachment download error", error);
    return { buffer: null, filename: null, contentType: null, inline: false };
  } finally {
    await client.logout().catch(() => undefined);
  }
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const emailId = searchParams.get("emailId")?.trim();
  const indexRaw = searchParams.get("index");
  const inlineParam = searchParams.get("inline") === "1";
  const index = indexRaw ? Number(indexRaw) : NaN;

  if (!emailId || !Number.isFinite(index) || index < 0) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: emailRow, error } = await supabase
    .from("emails")
    .select("id, raw, gmail_uid")
    .eq("id", emailId)
    .maybeSingle();

  if (error || !emailRow) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const raw =
    emailRow.raw && typeof emailRow.raw === "object"
      ? (emailRow.raw as Record<string, unknown>)
      : {};
  const items = pickAttachments(raw);
  const attachment = items[index];

  if (!attachment || typeof attachment !== "object") {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const value = attachment as Record<string, unknown>;
  const filename = sanitizeFilename(
    (value.filename as string) ||
      (value.Name as string) ||
      (value.FileName as string) ||
      (value.Filename as string) ||
      "allegato"
  );
  const contentType =
    (value.ContentType as string) ||
    (value.MimeType as string) ||
    (value.contentType as string) ||
    "application/octet-stream";
  const cid = normalizeCid(
    (value.cid as string) ||
      (value.ContentID as string) ||
      (value.ContentId as string) ||
      (value.contentId as string) ||
      null
  );
  const contentDisposition =
    (value.ContentDisposition as string) ||
    (value.contentDisposition as string) ||
    null;
  const inline =
    inlineParam || contentDisposition === "inline" || Boolean(cid);

  const base64 =
    (value.Content as string) || (value.content as string) || null;
  const url =
    (value.url as string) ||
    (value.Url as string) ||
    (value.publicUrl as string) ||
    null;

  let buffer: Buffer | null = null;

  if (base64) {
    buffer = Buffer.from(base64, "base64");
  } else if (url) {
    buffer = await downloadFromUrl(url);
    if (!buffer) {
      const bucket =
        process.env.EMAIL_ATTACHMENTS_BUCKET?.trim() || "email-attachments";
      const path = parseStoragePathFromUrl(url, bucket);
      if (path) {
        buffer = await downloadFromStorage(bucket, path);
      }
    }
  }

  if (!buffer && emailRow.gmail_uid) {
    const gmailResult = await downloadFromGmail(
      Number(emailRow.gmail_uid),
      index
    );
    buffer = gmailResult.buffer;
  }

  if (!buffer) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const disposition = inline ? "inline" : "attachment";
  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Content-Disposition", `${disposition}; filename="${filename}"`);
  headers.set("Cache-Control", "private, max-age=300");

  const body = new Uint8Array(buffer);
  return new Response(body, { status: 200, headers });
}
