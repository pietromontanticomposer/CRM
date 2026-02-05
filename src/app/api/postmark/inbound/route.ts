import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

type PostmarkAddress = {
  Email?: string;
  Name?: string;
  MailboxHash?: string;
};

type PostmarkInboundPayload = {
  MessageID?: string;
  FromFull?: PostmarkAddress;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
  Date?: string;
  Headers?: Array<{ Name?: string; Value?: string }>;
  Attachments?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

const getEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing env var ${key}`);
  }
  return value;
};

const getSupabase = () => {
  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

const isAuthorized = (request: Request) => {
  const expectedUser = process.env.POSTMARK_WEBHOOK_USER;
  const expectedPass = process.env.POSTMARK_WEBHOOK_PASS;
  if (!expectedUser || !expectedPass) return false;

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("basic ")) {
    return false;
  }

  const encoded = authHeader.slice(6).trim();
  let decoded = "";
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return false;
  }

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) return false;

  const user = decoded.slice(0, separatorIndex);
  const pass = decoded.slice(separatorIndex + 1);

  return user === expectedUser && pass === expectedPass;
};

const parseReceivedAt = (value?: string) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const sanitizeFilename = (value?: string | null) => {
  if (!value) return "allegato";
  return value.replace(/[^\w.\-]+/g, "_");
};

const parseNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const uploadPostmarkAttachments = async (
  attachments: Array<Record<string, unknown>>,
  messageId: string
) => {
  if (!attachments.length) return [];
  const bucket =
    process.env.EMAIL_ATTACHMENTS_BUCKET?.trim() || "email-attachments";
  const supabase = getSupabase();

  const results = await Promise.all(
    attachments.map(async (attachment, index) => {
      const filename = sanitizeFilename(
        (attachment.Name as string) ||
          (attachment.FileName as string) ||
          (attachment.Filename as string) ||
          (attachment.name as string) ||
          null
      );
      const contentType =
        (attachment.ContentType as string) ||
        (attachment.MimeType as string) ||
        (attachment.contentType as string) ||
        null;
      const size = parseNumber(
        attachment.ContentLength ?? attachment.Length ?? attachment.Size
      );
      const cid =
        (attachment.ContentID as string) ||
        (attachment.ContentId as string) ||
        (attachment.contentId as string) ||
        null;
      const contentDisposition =
        (attachment.ContentDisposition as string) ||
        (attachment.contentDisposition as string) ||
        null;
      const inline = contentDisposition === "inline" || Boolean(cid);
      const contentBase64 =
        (attachment.Content as string) ||
        (attachment.content as string) ||
        null;

      if (!contentBase64) {
        return {
          filename,
          contentType,
          size,
          cid,
          inline,
          url: null,
        };
      }

      const buffer = Buffer.from(contentBase64, "base64");
      const path = `postmark/${messageId}/${index}-${Date.now()}-${filename}`;

      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, buffer, {
          contentType: contentType ?? undefined,
          upsert: true,
        });

      if (error) {
        console.error("Postmark attachment upload error", error);
        return {
          filename,
          contentType,
          size,
          cid,
          inline,
          url: null,
        };
      }

      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      return {
        filename,
        contentType,
        size,
        cid,
        inline,
        url: data.publicUrl,
      };
    })
  );

  return results;
};

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: true });
  }

  let payload: PostmarkInboundPayload | null = null;
  try {
    payload = (await request.json()) as PostmarkInboundPayload;
  } catch {
    return NextResponse.json({ ok: true });
  }

  if (!payload) {
    return NextResponse.json({ ok: true });
  }

  const fromEmail = payload.FromFull?.Email?.trim() || null;
  const fromName = payload.FromFull?.Name?.trim() || null;
  const subject = payload.Subject?.trim() || null;
  const messageId = payload.MessageID || crypto.randomUUID();
  const receivedAt = parseReceivedAt(payload.Date);
  try {
    const supabase = getSupabase();

    let contactId: string | null = null;
    if (fromEmail) {
      const { data: contactData } = await supabase
        .from("contacts")
        .select("id")
        .ilike("email", fromEmail)
        .maybeSingle();
      contactId = contactData?.id ?? null;
    }

    const attachmentsMeta = payload.Attachments?.length
      ? await uploadPostmarkAttachments(payload.Attachments, messageId)
      : [];

    const rawPayload = {
      ...payload,
      Attachments: attachmentsMeta,
    };

    const emailRow = {
      contact_id: contactId,
      message_id: messageId,
      from_email: fromEmail,
      from_name: fromName,
      subject,
      text_body: payload.TextBody ?? null,
      html_body: payload.HtmlBody ?? null,
      stripped_text_reply: payload.StrippedTextReply ?? null,
      received_at: receivedAt,
      raw: rawPayload,
    };

    const { data: insertedEmail, error: emailError } = await supabase
      .from("emails")
      .upsert(emailRow, { onConflict: "message_id", ignoreDuplicates: true })
      .select("id, contact_id")
      .maybeSingle();

    if (emailError) {
      console.error("Postmark inbound: email insert failed", emailError);
      return NextResponse.json({ ok: true });
    }

    if (insertedEmail?.id) {
      const titleBase = fromName || fromEmail || "Mittente sconosciuto";
      const title = `Nuova email da ${titleBase}`;
      const body = subject || payload.TextBody?.slice(0, 140) || null;

      const { error: notificationError } = await supabase
        .from("notifications")
        .insert({
          type: "email_received",
          contact_id: insertedEmail.contact_id ?? null,
          email_id: insertedEmail.id,
          title,
          body,
        });

      if (notificationError) {
        console.error(
          "Postmark inbound: notification insert failed",
          notificationError
        );
      }
    }
  } catch (error) {
    console.error("Postmark inbound: unexpected error", error);
  }

  return NextResponse.json({ ok: true });
}
