import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import { createClient } from "@supabase/supabase-js";

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
  subject: string | null;
  text: string | null;
  html: string | null;
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
    subject: parsed.subject?.trim() || null,
    text: parsed.text || null,
    html: parsed.html || null,
    messageId: parsed.messageId || null,
    inReplyTo: parseReferences(parsed.inReplyTo as string | string[] | null),
    references: parseReferences(parsed.references as string | string[] | null),
    date: parsed.date ? parsed.date.toISOString() : null,
    raw: {
      headers: rawHeaders,
      attachments: parsed.attachments?.map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
        cid: attachment.cid,
      })),
    },
  };
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

const findContactId = async (email?: string | null) => {
  if (!email) return null;
  const supabase = getSupabase();
  const { data } = await supabase
    .from("contacts")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  return data?.id ?? null;
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

const runSync = async (request: Request) => {
  const cronSecret = request.headers.get("x-cron-secret");
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
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
  let maxUid = 0;

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
      const lastUid = await getLastUid();
      maxUid = lastUid;
      const maxPerRun = Math.max(
        1,
        Number(process.env.GMAIL_SYNC_LIMIT ?? 50)
      );
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
          .select("id")
          .eq("gmail_uid", message.uid)
          .maybeSingle();

        if (existing) continue;

        const parsed = await parseEmail(message.source as Buffer | Uint8Array);
        const fromEmail = parsed.from?.address ?? null;
        const fromName = parsed.from?.name ?? null;
        const toPrimary = parsed.toList[0] ?? null;

        const isOutbound =
          fromEmail?.toLowerCase() === user.toLowerCase();
        const contactEmail = isOutbound ? toPrimary : fromEmail;
        const contactId = await findContactId(contactEmail);
        const direction = isOutbound ? "outbound" : "inbound";

        const { data: insertedEmail, error } = await insertEmail({
          contact_id: contactId,
          direction,
          gmail_uid: message.uid,
          message_id_header: parsed.messageId,
          in_reply_to: parsed.inReplyTo,
          references: parsed.references,
          from_email: fromEmail,
          from_name: fromName,
          to_email: parsed.to,
          subject: parsed.subject,
          text_body: parsed.text,
          html_body: parsed.html,
          received_at: parsed.date,
          raw: {
            uid: message.uid,
            ...parsed.raw,
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
    return NextResponse.json({ ok: false }, { status: 500 });
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
