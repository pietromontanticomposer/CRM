import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_BACKFILL = 150;
const MAX_BACKFILL = 400;

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

const uploadAttachments = async (
  attachments: Array<{
    filename?: string | null;
    contentType?: string | null;
    size?: number | null;
    cid?: string | null;
    contentDisposition?: string | null;
    content?: Buffer | null;
  }>,
  gmailUid: number
) => {
  if (!attachments.length) return [];
  const bucket =
    process.env.EMAIL_ATTACHMENTS_BUCKET?.trim() || "email-attachments";
  const supabase = getSupabase();

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
    const inline = Boolean(cid) || attachment.contentDisposition === "inline";
    const content = attachment.content ?? null;

    if (!content) {
      results.push({ filename, contentType, size, cid, inline, url: null });
      continue;
    }

    const path = `gmail/${gmailUid}/${i}-${Date.now()}-${filename}`;
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, content, {
        contentType: contentType ?? undefined,
        upsert: true,
      });

    if (error) {
      console.error("Attachment upload error", error);
      results.push({ filename, contentType, size, cid, inline, url: null });
      continue;
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    results.push({
      filename,
      contentType,
      size,
      cid,
      inline,
      url: data.publicUrl,
    });
  }

  return results;
};

const parseCount = async (request: Request) => {
  try {
    const body = (await request.json()) as { count?: number };
    if (typeof body?.count === "number" && Number.isFinite(body.count)) {
      return Math.max(1, Math.min(MAX_BACKFILL, Math.floor(body.count)));
    }
  } catch {
    // ignore
  }
  return DEFAULT_BACKFILL;
};

export async function POST(request: Request) {
  const cronSecret = request.headers.get("x-cron-secret");
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const count = await parseCount(request);
  const user = getEnv("GMAIL_USER");
  const pass = getEnv("GMAIL_APP_PASSWORD");

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
  });

  let updated = 0;
  let processed = 0;

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
      const status = await client.status(mailboxPath, { uidNext: true });
      const uidNext = Number(status.uidNext ?? 1);
      const endUid = Math.max(1, uidNext - 1);
      const startUid = Math.max(1, endUid - count + 1);
      const uids = await client.search(
        { uid: `${startUid}:${endUid}` },
        { uid: true }
      );
      let uidList = Array.isArray(uids) ? uids : [];
      if (!uidList.length) {
        const allUids = await client.search({ all: true }, { uid: true });
        uidList = Array.isArray(allUids) ? allUids.slice(-count) : [];
      }

      if (!uidList.length) {
        return NextResponse.json({
          ok: true,
          processed: 0,
          updated: 0,
          range: null,
        });
      }

      for await (const message of client.fetch(
        uidList,
        { uid: true, source: true },
        { uid: true }
      )) {
        if (!message.uid || !message.source) continue;
        processed += 1;

        const buffer = Buffer.isBuffer(message.source)
          ? message.source
          : Buffer.from(message.source);
        const parsed = await simpleParser(buffer);
        const attachments = parsed.attachments ?? [];
        if (!attachments.length) continue;

        const supabase = getSupabase();
        const { data: existing } = await supabase
          .from("emails")
          .select("raw")
          .eq("gmail_uid", message.uid)
          .maybeSingle();

        const currentRaw =
          existing?.raw && typeof existing.raw === "object"
            ? (existing.raw as Record<string, unknown>)
            : {};
        const existingAttachments = Array.isArray(
          (currentRaw as { attachments?: unknown }).attachments
        )
          ? ((currentRaw as { attachments?: unknown[] })
              .attachments as unknown[])
          : [];
        const hasUrls =
          existingAttachments.length > 0 &&
          existingAttachments.every((item) =>
            Boolean((item as { url?: string | null })?.url)
          );
        if (hasUrls) continue;

        const attachmentsMeta = await uploadAttachments(
          attachments.map((attachment) => ({
            filename: attachment.filename ?? null,
            contentType: attachment.contentType ?? null,
            size: attachment.size ?? null,
            cid: attachment.cid ?? null,
            contentDisposition: attachment.contentDisposition ?? null,
            content:
              attachment.content && Buffer.isBuffer(attachment.content)
                ? attachment.content
                : attachment.content
                  ? Buffer.from(attachment.content)
                  : null,
          })),
          message.uid
        );

        if (!attachmentsMeta.length) continue;

        const nextRaw = { ...currentRaw, attachments: attachmentsMeta };
        const { error: updateError } = await supabase
          .from("emails")
          .update({ raw: nextRaw })
          .eq("gmail_uid", message.uid);

        if (updateError) {
          console.error("Backfill update error", updateError);
          continue;
        }
        updated += 1;
      }

      return NextResponse.json({
        ok: true,
        processed,
        updated,
        range: { start: startUid, end: endUid },
      });
    } finally {
      lock.release();
    }
  } catch (error) {
    console.error("Backfill error", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  } finally {
    await client.logout().catch(() => undefined);
  }
}
