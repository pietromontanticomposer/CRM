import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { ImapFlow, type SearchObject } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import { createClient } from "@supabase/supabase-js";
import {
  buildKnownContactAddresses,
  extractMessageIds,
  normalizeEmail,
  uniqueEmails,
} from "@/lib/server/emailMatching";
import { resolveEmailAccount } from "@/lib/server/emailAccounts";
import { getOwnerFilter, isUnauthorizedError, requireCurrentUser } from "@/lib/server/currentUser";
import {
  SECOND_FOLLOW_UP_DAYS,
  buildAutomaticFollowUpNote,
  getAutomaticFollowUpStage,
  isKeepInTouchNote,
  toFollowUpDateOnly,
} from "@/lib/followUp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 30;
const SYNC_STATE_TTL_MS = 10 * 60 * 1000;

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

const shouldLinkContact = ({
  contactId,
  fromEmail,
  recipients,
  requestedAddresses,
}: {
  contactId: string | null;
  fromEmail: string | null;
  recipients: string[];
  requestedAddresses: Set<string>;
}) => {
  if (!contactId) return false;

  return uniqueEmails([fromEmail, ...recipients]).some((address) =>
    requestedAddresses.has(address)
  );
};

const buildMessageIdVariants = (values: Array<string | null | undefined>) =>
  Array.from(
    new Set(
      values
        .flatMap((value) => extractMessageIds(value))
        .flatMap((id) => [id, `<${id}>`])
    )
  );

const findThreadContactIds = async (
  messageIdValues: Array<string | null | undefined>,
  ownerFilter?: string | null
) => {
  const messageIds = buildMessageIdVariants(messageIdValues);
  if (!messageIds.length) return [];

  const supabase = getSupabase();
  const found = new Set<string>();
  const chunkSize = 50;

  for (let index = 0; index < messageIds.length; index += chunkSize) {
    const chunk = messageIds.slice(index, index + chunkSize);
    let query = supabase
      .from("emails")
      .select("contact_id")
      .in("message_id_header", chunk)
      .not("contact_id", "is", null)
      .limit(2000);

    if (ownerFilter) {
      query = query.or(ownerFilter);
    }

    const { data } = await query;

    data?.forEach((row) => {
      if (row.contact_id) found.add(row.contact_id);
    });
  }

  return Array.from(found);
};

const getKnownSearchAddresses = async (
  contactId: string | null,
  seedAddresses: string[],
  accountEmail: string,
  ownerFilter?: string | null
) => {
  if (!contactId) return seedAddresses;

  const supabase = getSupabase();
  let query = supabase
    .from("emails")
    .select("direction, from_email, to_email, raw")
    .eq("contact_id", contactId)
    .order("received_at", { ascending: false })
    .limit(80);

  if (ownerFilter) {
    query = query.or(ownerFilter);
  }

  const { data } = await query;

  return buildKnownContactAddresses(
    seedAddresses,
    ((data ?? []) as unknown) as Array<{
      direction: "inbound" | "outbound" | null;
      from_email: string | null;
      to_email: string | null;
      raw: Record<string, unknown> | null;
    }>,
    accountEmail
  ).slice(0, 5);
};

const cleanGmailRawAddress = (value: string) =>
  value.replace(/[()"{}]/g, "").trim().toLowerCase();

const buildGmailRawQuery = (addresses: string[], sinceDays: number) => {
  const terms = addresses
    .slice(0, 5)
    .map(cleanGmailRawAddress)
    .filter(Boolean)
    .flatMap((address) => [
      `from:${address}`,
      `to:${address}`,
      `cc:${address}`,
      `bcc:${address}`,
    ]);
  if (!terms.length) return null;
  return `newer_than:${Math.max(1, Math.floor(sinceDays))}d (${terms.join(" OR ")})`;
};

const hashEmailList = (emails: string[]) =>
  crypto
    .createHash("sha256")
    .update([...emails].sort().join(","))
    .digest("hex");

const parsePayload = async (request: Request) => {
  try {
    const body = (await request.json()) as {
      emails?: string[];
      limit?: number;
      contactId?: string;
      beforeUid?: number;
      sinceDays?: number;
      emailAccountId?: string | null;
      force?: boolean;
    };
    const emails = Array.isArray(body?.emails) ? body.emails : [];
    const limit = Number(body?.limit ?? DEFAULT_LIMIT);
    const beforeUid = Number(body?.beforeUid ?? 0);
    const sinceDays = Number(body?.sinceDays ?? 60);
    return {
      emails,
      limit: Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(limit) ? limit : DEFAULT_LIMIT)),
      sinceDays: Math.max(
        1,
        Math.min(3650, Number.isFinite(sinceDays) ? Math.floor(sinceDays) : 60)
      ),
      contactId: body?.contactId ?? null,
      force: Boolean(body?.force),
      emailAccountId:
        typeof body?.emailAccountId === "string" && body.emailAccountId.trim()
          ? body.emailAccountId.trim()
          : null,
      beforeUid:
        Number.isFinite(beforeUid) && beforeUid > 0 ? beforeUid : null,
    };
  } catch {
    return {
      emails: [],
      limit: DEFAULT_LIMIT,
      sinceDays: 60,
      contactId: null,
      force: false,
      emailAccountId: null,
      beforeUid: null,
    };
  }
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

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
  status === "Non interessato" || status === "Collaborazione stabilita";

const updateContactAfterOutbound = async (
  contactId: string,
  sentAt?: string | null,
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
    updatePayload.last_action_note = "Email inviata (backfill Gmail)";
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

export async function POST(request: Request) {
  const startedAt = Date.now();
  const { emails, limit, sinceDays, contactId, beforeUid, emailAccountId, force } =
    await parsePayload(request);
  const cleaned = uniqueEmails(emails);
  if (!cleaned.length) {
    return NextResponse.json({ ok: false, error: "Missing emails" }, { status: 400 });
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
  if (!emailAccountId && !currentUser.canAccessLegacyData) {
    return NextResponse.json(
      { ok: false, error: "Collega una casella email prima del sync." },
      { status: 400 }
    );
  }

  const ownerFilter = getOwnerFilter(currentUser);
  const account = await resolveEmailAccount(
    supabase,
    emailAccountId,
    currentUser.id,
    currentUser.canAccessLegacyData
  );
  const user = account.email;
  const searchAddresses = await getKnownSearchAddresses(
    contactId,
    cleaned,
    account.email,
    ownerFilter
  );
  const requestedAddressSet = new Set(searchAddresses);
  const ownerKey = account.id ? currentUser.id : "legacy";
  const emailAccountKey = account.id || "legacy";
  const emailHash = hashEmailList(searchAddresses);

  const buildResponse = (payload: Record<string, unknown>, status?: number) =>
    NextResponse.json(
      { ...payload, durationMs: Date.now() - startedAt },
      status ? { status } : undefined
    );

  const touchSyncState = async (lastCursor?: number | null) => {
    if (!contactId) return;
    await supabase.from("contact_email_sync_state").upsert(
      {
        owner_key: ownerKey,
        contact_id: contactId,
        email_account_key: emailAccountKey,
        email_hash: emailHash,
        last_sync_at: new Date().toISOString(),
        last_cursor: lastCursor ?? null,
      },
      { onConflict: "owner_key,contact_id,email_account_key,email_hash" }
    );
  };

  if (!force && !beforeUid && contactId) {
    const { data: syncState } = await supabase
      .from("contact_email_sync_state")
      .select("last_sync_at,last_cursor")
      .eq("owner_key", ownerKey)
      .eq("contact_id", contactId)
      .eq("email_account_key", emailAccountKey)
      .eq("email_hash", emailHash)
      .maybeSingle();

    const lastSyncAt = syncState?.last_sync_at
      ? new Date(syncState.last_sync_at).getTime()
      : 0;
    if (lastSyncAt && Date.now() - lastSyncAt < SYNC_STATE_TTL_MS) {
      return buildResponse({
        ok: true,
        skipped: true,
        processed: 0,
        inserted: 0,
        updated: 0,
        nextCursor: syncState?.last_cursor ?? null,
      });
    }
  }

  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: { user: account.username, pass: account.password },
  });

  let processed = 0;
  let inserted = 0;
  let updated = 0;

  try {
    await client.connect();
    const mailboxes = await client.list();
    const allMail =
      mailboxes.find((box) => account.mailbox && box.path === account.mailbox) ||
      mailboxes.find((box) => box.specialUse === "\\All") ||
      mailboxes.find((box) =>
        box.path?.toLowerCase().includes("all mail")
      ) ||
      mailboxes.find((box) => box.specialUse === "\\Inbox");
    const mailboxPath = account.mailbox || allMail?.path || "INBOX";

    const lock = await client.getMailboxLock(mailboxPath);
    try {
      const orQueries = searchAddresses.flatMap((address) => [
        { from: address },
        { to: address },
        { cc: address },
        { bcc: address },
      ]);
      const addressQuery: SearchObject =
        orQueries.length === 1 ? orQueries[0] : { or: orQueries };
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
      const query: SearchObject = beforeUid
        ? addressQuery
        : { ...addressQuery, since };

      const gmailRawQuery =
        account.provider === "gmail" && !beforeUid
          ? buildGmailRawQuery(searchAddresses, sinceDays)
          : null;
      const searchQuery: SearchObject = gmailRawQuery
        ? { gmailraw: gmailRawQuery }
        : query;
      const allUids = await client
        .search(searchQuery, { uid: true })
        .catch((error) => {
          if (!gmailRawQuery) throw error;
          return client.search(query, { uid: true });
        });
      const uidList = (Array.isArray(allUids) ? allUids : []).filter(
        (uid) => !beforeUid || uid < beforeUid
      );
      if (!uidList.length) {
        await touchSyncState(null);
        return buildResponse({
          ok: true,
          processed: 0,
          inserted: 0,
          updated: 0,
          nextCursor: null,
        });
      }

      const slice = uidList.slice(-limit);
      const nextCursor = uidList.length > slice.length ? slice[0] : null;
      let existingUidQuery = supabase
        .from("emails")
        .select(account.id ? "provider_uid, contact_id" : "gmail_uid, contact_id")
        .or(ownerFilter)
        .limit(slice.length);
      if (account.id) {
        existingUidQuery = existingUidQuery
          .eq("email_account_id", account.id)
          .in(
            "provider_uid",
            slice.map((uid) => String(uid))
          );
      } else {
        existingUidQuery = existingUidQuery
          .is("email_account_id", null)
          .in("gmail_uid", slice);
      }

      const { data: existingUidRows } = await existingUidQuery;
      const alreadyLinkedUids = new Set(
        (existingUidRows ?? [])
          .filter((row) => Boolean(row.contact_id))
          .map((row) =>
            account.id
              ? String((row as { provider_uid?: string | null }).provider_uid)
              : String((row as { gmail_uid?: number | null }).gmail_uid)
          )
      );
      const fetchSlice = slice.filter(
        (uid) => !alreadyLinkedUids.has(String(uid))
      );

      if (!fetchSlice.length) {
        await touchSyncState(nextCursor);
        return buildResponse({
          ok: true,
          processed: 0,
          inserted: 0,
          updated: 0,
          nextCursor,
        });
      }

      for await (const message of client.fetch(
        fetchSlice,
        { uid: true, source: true },
        { uid: true }
      )) {
        if (!message.uid || !message.source) continue;
        processed += 1;

        let existingQuery = supabase
          .from("emails")
          .select("id, contact_id, from_email, to_email, raw")
          .limit(1);
        if (ownerFilter) {
          existingQuery = existingQuery.or(ownerFilter);
        }

        const { data: existing } = account.id
          ? await existingQuery
              .eq("email_account_id", account.id)
              .eq("provider_uid", String(message.uid))
              .maybeSingle()
          : await existingQuery
              .is("email_account_id", null)
              .eq("gmail_uid", message.uid)
              .maybeSingle();

        const parsed = await parseEmail(message.source as Buffer | Uint8Array);
        const attachmentsMeta: Array<{
          filename: string;
          contentType: string | null;
          size: number | null;
          cid: string | null;
          inline: boolean;
          url: string | null;
        }> = [];
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
        const directlyLinked = shouldLinkContact({
          contactId,
          fromEmail,
          recipients,
          requestedAddresses: requestedAddressSet,
        });
        const threadContactIds =
          directlyLinked || !contactId || (!parsed.inReplyTo && !parsed.references)
            ? []
            : await findThreadContactIds(
                [parsed.inReplyTo, parsed.references],
                ownerFilter
              );
        const linkedContactId =
          contactId && (directlyLinked || threadContactIds.includes(contactId))
            ? contactId
            : null;

        if (existing) {
          const shouldUpdateContact =
            !existing.contact_id && Boolean(linkedContactId);
          const shouldUpdateFrom = !existing.from_email && Boolean(fromEmail);
          const shouldUpdateTo =
            Boolean(recipientsDisplay) &&
            existing.to_email !== recipientsDisplay;
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
                  ? linkedContactId
                  : existing.contact_id,
                from_email: shouldUpdateFrom ? fromEmail : existing.from_email,
                to_email: shouldUpdateTo ? recipientsDisplay : existing.to_email,
                owner_id: currentUser.id,
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
          if (direction === "outbound" && linkedContactId) {
            await updateContactAfterOutbound(
              linkedContactId,
              parsed.date,
              ownerFilter
            );
          }
          continue;
        }

        const { error } = await supabase.from("emails").insert({
          contact_id: linkedContactId,
          owner_id: currentUser.id,
          direction,
          email_account_id: account.id,
          provider: account.provider,
          provider_uid: String(message.uid),
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
        if (direction === "outbound" && linkedContactId) {
          await updateContactAfterOutbound(
            linkedContactId,
            parsed.date,
            ownerFilter
          );
        }
        inserted += 1;
      }

      await touchSyncState(nextCursor);
      return buildResponse({
        ok: true,
        processed,
        inserted,
        updated,
        nextCursor,
      });
    } finally {
      lock.release();
    }
  } catch (error) {
    console.error("Backfill contact error", error);
    return buildResponse({ ok: false }, 500);
  } finally {
    await client.logout().catch(() => undefined);
  }

  return buildResponse({
    ok: true,
    processed,
    inserted,
    updated,
    nextCursor: null,
  });
}
