"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";

const STATUS_OPTIONS = [
  "Da contattare",
  "Interessato",
  "Non interessato",
  "Chiuso",
] as const;

type Status = (typeof STATUS_OPTIONS)[number];

type Contact = {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  status: Status;
  last_action_at: string | null;
  last_action_note: string | null;
  next_action_at: string | null;
  next_action_note: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type DraftContact = Omit<Contact, "created_at" | "updated_at">;

type NewContact = {
  name: string;
  email: string;
  company: string;
  role: string;
};

type EmailDirection = "inbound" | "outbound";

type EmailRow = {
  id: string;
  contact_id: string | null;
  direction: EmailDirection;
  gmail_uid: number | null;
  message_id_header: string | null;
  from_email: string | null;
  from_name: string | null;
  to_email: string | null;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  received_at: string | null;
  created_at: string | null;
  raw: Record<string, unknown> | null;
};

type SummaryPayload = {
  one_liner?: string;
  highlights?: string[];
  open_questions?: string[];
  next_actions?: string[];
  last_inbound?: string;
  last_outbound?: string;
};

type SummaryState = {
  raw: string;
  parsed: SummaryPayload | null;
  updatedAt?: string | null;
  lastEmailAt?: string | null;
  model?: string | null;
  rateLimited?: boolean;
};

const emptyNewContact: NewContact = {
  name: "",
  email: "",
  company: "",
  role: "",
};

const statusStyles: Record<Status, string> = {
  "Da contattare": "bg-amber-500/15 text-amber-200 border-amber-400/30",
  "Interessato": "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
  "Non interessato": "bg-rose-500/15 text-rose-200 border-rose-400/30",
  "Chiuso": "bg-zinc-500/20 text-zinc-200 border-zinc-400/30",
};

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "short",
  });
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const toDateInputValue = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getTodayDateInputValue = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const extractEmails = (value?: string | null) => {
  if (!value) return [];
  const matches = value.match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
  );
  if (!matches) return [];
  const unique = new Set(matches.map((item) => item.toLowerCase()));
  return Array.from(unique);
};

const escapeIlike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

type AttachmentMeta = {
  filename: string;
  contentType?: string | null;
  size?: number | null;
  cid?: string | null;
  url?: string | null;
  inline?: boolean;
  index: number;
};

const parseNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatBytes = (value?: number | null) => {
  if (!value || value <= 0) return null;
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
};

const normalizeCid = (value?: string | null) => {
  if (!value) return null;
  return value.replace(/^<|>$/g, "");
};

const extractAttachments = (raw?: Record<string, unknown> | null) => {
  if (!raw || typeof raw !== "object") return [];
  const payload = raw as Record<string, unknown>;
  const candidates =
    (Array.isArray(payload.attachments) && payload.attachments) ||
    (Array.isArray(payload.Attachments) && payload.Attachments) ||
    [];

  const normalized = candidates
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const value = item as Record<string, unknown>;
      const filename =
        (value.filename as string) ||
        (value.Name as string) ||
        (value.FileName as string) ||
        (value.Filename as string) ||
        "Allegato";
      const contentType =
        (value.contentType as string) ||
        (value.ContentType as string) ||
        (value.MimeType as string) ||
        null;
      const size = parseNumber(
        value.size ?? value.ContentLength ?? value.Length ?? value.Size
      );
      const cid = normalizeCid(
        (value.cid as string) ||
          (value.ContentID as string) ||
          (value.ContentId as string) ||
          null
      );
      const url =
        (value.url as string) ||
        (value.Url as string) ||
        (value.publicUrl as string) ||
        null;
      const inline =
        Boolean(value.inline) || Boolean(value.IsInline) || Boolean(cid);
      return {
        filename: String(filename),
        contentType,
        size,
        cid,
        url,
        inline,
        index,
      } satisfies AttachmentMeta;
    })
    .filter(Boolean) as AttachmentMeta[];

  return normalized.filter((item) => Boolean(item.filename));
};

const getRawAttachmentItems = (raw?: Record<string, unknown> | null) => {
  if (!raw || typeof raw !== "object") return [];
  const payload = raw as Record<string, unknown>;
  const candidates =
    (Array.isArray(payload.attachments) && payload.attachments) ||
    (Array.isArray(payload.Attachments) && payload.Attachments) ||
    [];
  return Array.isArray(candidates) ? candidates : [];
};

const hasBase64Attachments = (raw?: Record<string, unknown> | null) => {
  const items = getRawAttachmentItems(raw);
  return items.some((item) => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return (
      typeof value.Content === "string" ||
      typeof value.content === "string"
    );
  });
};

const hasMultipartHeaders = (raw?: Record<string, unknown> | null) => {
  if (!raw || typeof raw !== "object") return false;
  const payload = raw as Record<string, unknown>;
  const headers = payload.headers;
  if (!Array.isArray(headers)) return false;
  return headers.some((header) => {
    if (!header || typeof header !== "object") return false;
    const value = header as { name?: string; value?: string };
    if (!value.name || !value.value) return false;
    if (value.name.toLowerCase() !== "content-type") return false;
    return /multipart\/(mixed|related)/i.test(value.value);
  });
};

const shouldEnsureAttachments = (
  email: EmailRow | null,
  attachments: AttachmentMeta[]
) => {
  if (!email) return false;
  const raw = email.raw ?? null;
  const hasBase64 = hasBase64Attachments(raw);
  const hasMissingUrl = attachments.length
    ? attachments.some((attachment) => !attachment.url)
    : false;
  const htmlHasCid = Boolean(email.html_body?.includes("cid:"));
  const multipartHint = hasMultipartHeaders(raw);

  if (hasBase64 || hasMissingUrl) return true;
  if (email.gmail_uid) {
    if (!attachments.length && (htmlHasCid || multipartHint)) return true;
  }
  return false;
};

const buildAttachmentDownloadUrl = (
  emailId: string,
  index: number,
  inline = false
) => {
  const params = new URLSearchParams({
    emailId,
    index: String(index),
  });
  if (inline) params.set("inline", "1");
  return `/api/attachments/download?${params.toString()}`;
};

const replaceCidSources = (
  html: string,
  attachments: AttachmentMeta[],
  emailId: string
) => {
  if (!attachments.length) return html;
  const cidMap = new Map(
    attachments
      .filter((attachment) => attachment.cid)
      .map((attachment) => [
        normalizeCid(attachment.cid),
        buildAttachmentDownloadUrl(emailId, attachment.index, true),
      ])
  );
  if (!cidMap.size) return html;
  return html.replace(/cid:([^"'>\s)]+)/gi, (match, cid) => {
    const normalized = normalizeCid(cid);
    const url = normalized ? cidMap.get(normalized) : null;
    return url || match;
  });
};

const sanitizeHtml = (html: string) => {
  if (typeof window === "undefined" || !html.trim()) return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const blockedTags = ["script", "style", "iframe", "object", "embed", "link", "meta"];
  blockedTags.forEach((tag) => {
    doc.querySelectorAll(tag).forEach((node) => node.remove());
  });

  doc.querySelectorAll("*").forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith("on")) {
        node.removeAttribute(attr.name);
      }
      if ((name === "href" || name === "src") &&
          value.trim().toLowerCase().startsWith("javascript:")) {
        node.removeAttribute(attr.name);
      }
    });
  });

  doc.querySelectorAll("a").forEach((anchor) => {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noreferrer");
  });

  return doc.body.innerHTML;
};

const getTimestamp = (value?: string | null) => {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const getEmailTimestamp = (
  email: Pick<EmailRow, "received_at" | "created_at">
) => getTimestamp(email.received_at ?? email.created_at ?? null);

const normalizeThreadSubject = (subject?: string | null) => {
  const fallback = "Senza oggetto";
  if (!subject) return fallback;
  let normalized = subject.trim();
  if (!normalized) return fallback;
  normalized = normalized.replace(/^(re|fw|fwd|ris)\s*:\s*/gi, "");
  while (/^(re|fw|fwd|ris)\s*:\s*/i.test(normalized)) {
    normalized = normalized.replace(/^(re|fw|fwd|ris)\s*:\s*/gi, "");
  }
  return normalized.trim() || fallback;
};

const getInitials = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase()).join("");
};

const getDisplayName = (contact: Pick<Contact, "name" | "company" | "email">) =>
  contact.name?.trim() ||
  contact.company?.trim() ||
  contact.email?.trim() ||
  "Senza nome";

const buildDraft = (contact: Contact): DraftContact => ({
  id: contact.id,
  name: contact.name,
  email: contact.email,
  company: contact.company,
  role: contact.role,
  status: contact.status,
  last_action_at: toDateInputValue(contact.last_action_at),
  last_action_note: contact.last_action_note,
  next_action_at: toDateInputValue(contact.next_action_at),
  next_action_note: contact.next_action_note,
  notes: contact.notes,
});

const normalizeString = (value: unknown, maxLen = 0) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!maxLen || trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen).trimEnd()}…`;
};

const normalizeSummary = (value: unknown): SummaryPayload | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as SummaryPayload;
  const normalized = {
    one_liner: normalizeString(source.one_liner, 380),
    highlights: [],
    open_questions: [],
    next_actions: [],
    last_inbound: normalizeString(source.last_inbound, 160),
    last_outbound: normalizeString(source.last_outbound, 160),
  };
  const hasContent = Boolean(
    normalized.one_liner ||
      normalized.last_inbound ||
      normalized.last_outbound
  );
  return hasContent ? normalized : null;
};

const stripJsonWrapper = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith("```")) {
    const firstBreak = trimmed.indexOf("\n");
    const lastFence = trimmed.lastIndexOf("```");
    if (firstBreak !== -1 && lastFence > firstBreak) {
      return trimmed.slice(firstBreak + 1, lastFence).trim();
    }
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }
  return trimmed;
};

const parseSummary = (value?: string | null) => {
  if (!value) return null;
  try {
    return normalizeSummary(JSON.parse(stripJsonWrapper(value)));
  } catch {
    return null;
  }
};

export default function CrmApp() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newContact, setNewContact] = useState<NewContact>(emptyNewContact);
  const [draft, setDraft] = useState<DraftContact | null>(null);
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailsError, setEmailsError] = useState<string | null>(null);
  const [emailReadById, setEmailReadById] = useState<Record<string, boolean>>(
    {}
  );
  const [openThreads, setOpenThreads] = useState<Record<string, boolean>>({});
  const [summary, setSummary] = useState<SummaryState | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [openContactGroups, setOpenContactGroups] = useState<
    Record<Status, boolean>
  >(() =>
    STATUS_OPTIONS.reduce(
      (acc, status) => ({ ...acc, [status]: false }),
      {} as Record<Status, boolean>
    )
  );
  const [ensuredAttachments, setEnsuredAttachments] = useState<
    Record<string, "pending" | "done">
  >({});
  const [backfillByContact, setBackfillByContact] = useState<
    Record<string, "pending" | "done">
  >({});
  const [aiCategoryByContact, setAiCategoryByContact] = useState<
    Record<string, "pending" | "done">
  >({});

  const selected = contacts.find((contact) => contact.id === selectedId) || null;
  const selectedEmail =
    emails.find((email) => email.id === selectedEmailId) || null;
  const selectedEmailAttachments = useMemo(
    () => (selectedEmail ? extractAttachments(selectedEmail.raw) : []),
    [selectedEmail]
  );
  const selectedEmailHtml = useMemo(() => {
    if (!selectedEmail?.html_body || !selectedEmail?.id) return null;
    const withInline = replaceCidSources(
      selectedEmail.html_body,
      selectedEmailAttachments,
      selectedEmail.id
    );
    return sanitizeHtml(withInline);
  }, [selectedEmail?.html_body, selectedEmailAttachments, selectedEmail?.id]);

  useEffect(() => {
    if (!selected || !selectedEmail) return;
    const emailId = selectedEmail.id;
    if (ensuredAttachments[emailId]) return;

    if (!shouldEnsureAttachments(selectedEmail, selectedEmailAttachments)) {
      setEnsuredAttachments((prev) => ({ ...prev, [emailId]: "done" }));
      return;
    }

    setEnsuredAttachments((prev) => ({ ...prev, [emailId]: "pending" }));

    const run = async () => {
      try {
        const response = await fetch("/api/attachments/ensure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emailId }),
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { updated?: boolean };
        if (payload?.updated) {
          await loadEmails(selected.id, selected.email);
        }
      } catch (error) {
        console.error(error);
      } finally {
        setEnsuredAttachments((prev) => ({ ...prev, [emailId]: "done" }));
      }
    };

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmail?.id, selectedEmailAttachments, selected?.id]);

  const counts = useMemo(() => {
    return STATUS_OPTIONS.reduce(
      (acc, status) => {
        acc[status] = contacts.filter((contact) => contact.status === status)
          .length;
        return acc;
      },
      {} as Record<Status, number>
    );
  }, [contacts]);

  const contactsByStatus = useMemo(() => {
    return STATUS_OPTIONS.reduce((acc, status) => {
      acc[status] = contacts.filter((contact) => contact.status === status);
      return acc;
    }, {} as Record<Status, Contact[]>);
  }, [contacts]);

  const emailThreads = useMemo(() => {
    if (!emails.length) return [];
    const grouped = new Map<
      string,
      { key: string; subject: string; messages: EmailRow[] }
    >();

    emails.forEach((email) => {
      const subject = normalizeThreadSubject(email.subject);
      const key = subject.toLowerCase();
      if (!grouped.has(key)) {
        grouped.set(key, { key, subject, messages: [] });
      }
      grouped.get(key)!.messages.push(email);
    });

    const threads = Array.from(grouped.values()).map((thread) => {
      thread.messages.sort(
        (a, b) => getEmailTimestamp(b) - getEmailTimestamp(a)
      );
      const latest = thread.messages[0] ?? null;
      const unreadCount = thread.messages.reduce((acc, message) => {
        if (
          message.direction === "inbound" &&
          !(emailReadById[message.id] ?? true)
        ) {
          return acc + 1;
        }
        return acc;
      }, 0);
      return {
        ...thread,
        latestAt: latest?.received_at ?? latest?.created_at ?? null,
        unreadCount,
        total: thread.messages.length,
      };
    });

    threads.sort(
      (a, b) => getTimestamp(b.latestAt) - getTimestamp(a.latestAt)
    );

    return threads;
  }, [emails, emailReadById]);

  const summaryMeta = useMemo(() => {
    if (!emails.length) return null;
    const sorted = [...emails].sort(
      (a, b) => getEmailTimestamp(b) - getEmailTimestamp(a)
    );
    const lastActivity =
      sorted[0]?.received_at ?? sorted[0]?.created_at ?? null;
    const unreadCount = sorted.reduce((acc, email) => {
      if (
        email.direction === "inbound" &&
        !(emailReadById[email.id] ?? true)
      ) {
        return acc + 1;
      }
      return acc;
    }, 0);

    return {
      lastActivity,
      unreadCount,
      threadCount: emailThreads.length,
    };
  }, [emails, emailReadById, emailThreads.length]);

  useEffect(() => {
    if (!emailThreads.length) {
      if (Object.keys(openThreads).length) {
        setOpenThreads({});
      }
      return;
    }
  }, [emailThreads, openThreads]);

  const loadContacts = async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("contacts")
      .select("*")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError("Impossibile caricare i contatti. Controlla il database.");
      setLoading(false);
      return;
    }

    setContacts((data as Contact[]) || []);
    setLoading(false);
  };

  const loadEmails = async (contactId: string | null, email?: string | null) => {
    if (!contactId) {
      setEmails([]);
      setSelectedEmailId(null);
      setEmailReadById({});
      setSummary(null);
      setSummaryError(null);
      return;
    }

    setEmailsLoading(true);
    setEmailsError(null);
    setSummary(null);
    setSummaryError(null);
    const query = supabase
      .from("emails")
      .select(
        "id, contact_id, direction, gmail_uid, message_id_header, from_email, from_name, to_email, subject, text_body, html_body, received_at, created_at, raw"
      )
      .order("received_at", { ascending: false });

    const emailList = extractEmails(email);
    const emailFilters = [`contact_id.eq.${contactId}`];
    emailList.forEach((address) => {
      const safe = escapeIlike(address);
      emailFilters.push(`from_email.ilike.%${safe}%`);
      emailFilters.push(`to_email.ilike.%${safe}%`);
    });

    const { data, error: fetchError } =
      emailFilters.length > 1
        ? await query.or(emailFilters.join(","))
        : await query.eq("contact_id", contactId);

    if (fetchError) {
      setEmailsError("Impossibile caricare le email.");
      setEmailsLoading(false);
      return;
    }

    const emailRows = (data as EmailRow[]) || [];
    const readMap: Record<string, boolean> = {};
    emailRows.forEach((row) => {
      readMap[row.id] = true;
    });

    const inboundIds = emailRows
      .filter((row) => row.direction === "inbound")
      .map((row) => row.id);

    if (inboundIds.length) {
      const { data: notifications, error: notificationsError } =
        await supabase
          .from("notifications")
          .select("email_id, is_read")
          .in("email_id", inboundIds)
          .eq("type", "email_received");

      if (!notificationsError && notifications) {
        notifications.forEach((notification) => {
          if (!notification.email_id) return;
          const isRead = Boolean(notification.is_read);
          if (readMap[notification.email_id] === undefined) {
            readMap[notification.email_id] = isRead;
          } else {
            readMap[notification.email_id] =
              readMap[notification.email_id] && isRead;
          }
        });
      }
    }

    setEmails(emailRows);
    setEmailReadById(readMap);
    await refreshSummary(contactId, false);
    setEmailsLoading(false);
  };

  const refreshSummary = async (contactId: string, force = false) => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const response = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, force }),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        setSummaryError(
          errorPayload?.error ||
            "Impossibile generare il riassunto. Riprova."
        );
        setSummaryLoading(false);
        return;
      }

      const payload = (await response.json()) as {
        summary?: string;
        updated_at?: string | null;
        last_email_at?: string | null;
        model?: string | null;
        rate_limited?: boolean;
      };

      const raw = payload.summary ?? "";
      setSummary({
        raw,
        parsed: parseSummary(raw),
        updatedAt: payload.updated_at ?? null,
        lastEmailAt: payload.last_email_at ?? null,
        model: payload.model ?? null,
        rateLimited: payload.rate_limited ?? false,
      });
      setSummaryLoading(false);
    } catch (error) {
      console.error(error);
      setSummaryError("Impossibile generare il riassunto. Riprova.");
      setSummaryLoading(false);
    }
  };

  const handleSelectContact = (contact: Contact) => {
    setSelectedId(contact.id);
    setDraft(buildDraft(contact));
    setSelectedEmailId(null);
    setOpenThreads({});
    setOpenContactGroups((prev) => ({ ...prev, [contact.status]: true }));
    loadEmails(contact.id, contact.email);
  };

  const handleSelectEmail = async (emailId: string) => {
    setSelectedEmailId(emailId);
    setEmailReadById((prev) => ({ ...prev, [emailId]: true }));
    const selectedRow = emails.find((email) => email.id === emailId);
    if (selectedRow?.direction !== "inbound") return;
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("email_id", emailId)
      .eq("type", "email_received");
  };

  const getReplyTarget = () => {
    if (selectedEmail?.direction === "inbound") return selectedEmail;
    return emails.find((email) => email.direction === "inbound") || null;
  };

  const handleSendEmail = async () => {
    if (!selected?.email?.trim()) {
      setEmailsError("Aggiungi un'email al contatto per poter rispondere.");
      return;
    }

    if (!emailSubject.trim() && !emailBody.trim()) {
      setEmailsError("Scrivi almeno un oggetto o un messaggio.");
      return;
    }

    setSendingEmail(true);
    setEmailsError(null);
    const replyTarget = getReplyTarget();

    const response = await fetch("/api/gmail/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: selected.email.trim(),
        subject: emailSubject.trim() || undefined,
        text: emailBody.trim() || undefined,
        replyToEmailId: replyTarget?.id ?? undefined,
      }),
    });

    if (!response.ok) {
      setEmailsError("Invio email fallito. Riprova.");
      setSendingEmail(false);
      return;
    }

    setEmailSubject("");
    setEmailBody("");
    await loadEmails(selected.id, selected.email);
    setSendingEmail(false);
  };

  const handleSyncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage(null);

    const response = await fetch("/api/gmail/sync-now", { method: "POST" });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setSyncMessage(payload?.error || "Sync fallita. Riprova.");
      setSyncing(false);
      return;
    }

    setLastSyncAt(new Date());
    if (typeof payload?.processed === "number") {
      setSyncMessage(
        payload.processed > 0
          ? `Sync completata (${payload.processed} nuove).`
          : "Sync completata (nessuna nuova)."
      );
    } else {
      setSyncMessage("Sync completata.");
    }
    if (selected) {
      await loadEmails(selected.id, selected.email);
    }
    setSyncing(false);
  };

  useEffect(() => {
    loadContacts();
  }, []);

  useEffect(() => {
    handleSyncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected || emailsLoading) return;
    if (emails.length === 0) return;
    if (aiCategoryByContact[selected.id]) return;

    setAiCategoryByContact((prev) => ({ ...prev, [selected.id]: "pending" }));

    const run = async () => {
      try {
        const response = await fetch("/api/ai/category", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId: selected.id }),
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          applied_status?: Status;
        };
        if (payload?.applied_status) {
          setContacts((prev) =>
            prev.map((contact) =>
              contact.id === selected.id
                ? { ...contact, status: payload.applied_status as Status }
                : contact
            )
          );
          setDraft((prev) =>
            prev ? { ...prev, status: payload.applied_status as Status } : prev
          );
        }
      } catch (error) {
        console.error(error);
      } finally {
        setAiCategoryByContact((prev) => ({ ...prev, [selected.id]: "done" }));
      }
    };

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, emailsLoading, emails.length]);

  useEffect(() => {
    if (!selected || emailsLoading) return;
    if (emails.length > 0) return;
    const emailList = extractEmails(selected.email);
    if (!emailList.length) return;
    if (backfillByContact[selected.id]) return;

    setBackfillByContact((prev) => ({ ...prev, [selected.id]: "pending" }));

    const run = async () => {
      try {
        const response = await fetch("/api/gmail/backfill-contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            emails: emailList,
            contactId: selected.id,
            limit: 200,
          }),
        });
        if (!response.ok) return;
        await loadEmails(selected.id, selected.email);
      } catch (error) {
        console.error(error);
      } finally {
        setBackfillByContact((prev) => ({ ...prev, [selected.id]: "done" }));
      }
    };

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.email, emailsLoading, emails.length]);

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    const name = newContact.name.trim();
    const company = newContact.company.trim();
    if (!name && !company) {
      setAddError("Inserisci nome oppure produzione.");
      return;
    }

    setAdding(true);
    setError(null);
    setAddError(null);
    const today = getTodayDateInputValue();

    const { data, error: insertError } = await supabase
      .from("contacts")
      .insert({
        name,
        email: newContact.email.trim() || null,
        company: company || null,
        role: newContact.role.trim() || null,
        status: "Da contattare",
        last_action_at: today,
      })
      .select("*")
      .single();

    if (insertError) {
      setError("Impossibile salvare. Controlla le policy del database.");
      setAdding(false);
      return;
    }

    const created = data as Contact;
    setContacts((prev) => [created, ...prev]);
    handleSelectContact(created);
    setNewContact(emptyNewContact);
    setAdding(false);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);

    const { id, ...updates } = draft;
    const { data, error: updateError } = await supabase
      .from("contacts")
      .update({
        ...updates,
        name: updates.name.trim(),
        email: updates.email?.trim() || null,
        company: updates.company?.trim() || null,
        role: updates.role?.trim() || null,
        last_action_at: updates.last_action_at || null,
        last_action_note: updates.last_action_note?.trim() || null,
        next_action_at: updates.next_action_at || null,
        next_action_note: updates.next_action_note?.trim() || null,
        notes: updates.notes?.trim() || null,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) {
      setError("Impossibile aggiornare. Riprova.");
      setSaving(false);
      return;
    }

    const updated = data as Contact;
    setContacts((prev) =>
      prev.map((contact) => (contact.id === id ? updated : contact))
    );
    setDraft(buildDraft(updated));
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!selected) return;
    setDeleting(true);
    setError(null);

    const { error: deleteError } = await supabase
      .from("contacts")
      .delete()
      .eq("id", selected.id);

    if (deleteError) {
      setError("Impossibile eliminare. Riprova.");
      setDeleting(false);
      return;
    }

    setContacts((prev) => prev.filter((contact) => contact.id !== selected.id));
    setSelectedId(null);
    setDraft(null);
    setEmails([]);
    setSelectedEmailId(null);
    setDeleting(false);
  };

  const renderContactDetails = (contactId: string) => {
    if (!selected || !draft || selected.id !== contactId) return null;

    return (
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-strong)] p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--muted)]">
              Scheda
            </p>
            <h3 className="text-base font-semibold text-[var(--ink)]">
              Dettagli contatto
            </h3>
          </div>
          <div className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-[11px] text-[var(--muted)]">
            Creato il {formatDate(selected.created_at)}
          </div>
        </div>

        <div className="mt-4 grid gap-5">
          {draft.status === "Chiuso" && (
            <div className="rounded-2xl border border-rose-400/40 bg-rose-500/15 px-4 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-rose-100 shadow-sm">
              Contattare solo via telefono
            </div>
          )}
          {draft.status === "Non interessato" && (
            <div className="rounded-2xl border border-amber-400/40 bg-amber-500/15 px-4 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-amber-100 shadow-sm">
              Non interessato · non ricontattare
            </div>
          )}
          <div className="grid gap-3">
            <div className="grid gap-2">
              <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Nome
              </label>
              <input
                value={draft.name}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev ? { ...prev, name: event.target.value } : prev
                  )
                }
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Email
              </label>
              <input
                type="email"
                value={draft.email ?? ""}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev ? { ...prev, email: event.target.value } : prev
                  )
                }
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Produzione
              </label>
              <input
                value={draft.company ?? ""}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev ? { ...prev, company: event.target.value } : prev
                  )
                }
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Ruolo
              </label>
              <select
                value={draft.role ?? ""}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev ? { ...prev, role: event.target.value } : prev
                  )
                }
              >
                <option value="">Ruolo</option>
                <option value="Regista">Regista</option>
                <option value="Produzione">Produzione</option>
                <option value="Regista e Produzione">
                  Regista e Produzione
                </option>
              </select>
            </div>
          </div>

          <div className="grid gap-3">
            <div className="grid gap-2">
              <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Stato
              </label>
              <select
                value={draft.status}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          status: event.target.value as Status,
                          ...(event.target.value === "Chiuso" ||
                          event.target.value === "Non interessato"
                            ? {
                                next_action_at: "",
                                next_action_note: "",
                              }
                            : {}),
                        }
                      : prev
                  )
                }
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Ultimo contatto
              </label>
              <input
                type="date"
                value={draft.last_action_at ?? ""}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? { ...prev, last_action_at: event.target.value }
                      : prev
                  )
                }
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Nota ultimo contatto
              </label>
              <input
                value={draft.last_action_note ?? ""}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? { ...prev, last_action_note: event.target.value }
                      : prev
                  )
                }
                placeholder="Email inviata, call, follow-up..."
              />
            </div>
          </div>

          <div className="grid gap-3">
            <div className="grid gap-2">
              <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Prossima azione
              </label>
              <input
                type="date"
                value={draft.next_action_at ?? ""}
                disabled={
                  draft.status === "Chiuso" ||
                  draft.status === "Non interessato"
                }
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? { ...prev, next_action_at: event.target.value }
                      : prev
                  )
                }
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Nota prossima azione
              </label>
              <input
                value={draft.next_action_note ?? ""}
                disabled={
                  draft.status === "Chiuso" ||
                  draft.status === "Non interessato"
                }
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? { ...prev, next_action_note: event.target.value }
                      : prev
                  )
                }
                placeholder="Follow-up tra 7 giorni"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              Note libere
            </label>
            <textarea
              rows={4}
              value={draft.notes ?? ""}
              onChange={(event) =>
                setDraft((prev) =>
                  prev ? { ...prev, notes: event.target.value } : prev
                )
              }
              placeholder="Mood della conversazione, preferenze, referenze, ecc."
            />
          </div>

          {error && (
            <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
            >
              {saving ? "Salvo..." : "Salva modifiche"}
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-full border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-200 transition hover:border-red-400/70 hover:bg-red-500/10 disabled:opacity-60"
            >
              {deleting ? "Elimino..." : "Elimina contatto"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderConversation = () => {
    if (!selected) return null;

    return (
      <div className="perf-block grid gap-4 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              Email
            </div>
            <div className="text-sm font-semibold">Storico conversazioni</div>
          </div>
          <button
            type="button"
            onClick={() => loadEmails(selected.id, selected.email)}
            className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-semibold text-[var(--muted)]"
          >
            Aggiorna
          </button>
        </div>

        {emailsLoading && (
          <div className="rounded-xl border border-dashed border-[var(--line)] p-3 text-sm text-[var(--muted)]">
            Caricamento email...
          </div>
        )}

        {!emailsLoading && emails.length === 0 && (
          <div className="rounded-xl border border-dashed border-[var(--line)] p-3 text-sm text-[var(--muted)]">
            Nessuna email per questo contatto.
          </div>
        )}

        {!emailsLoading && summaryMeta && (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                  Riassunto conversazione (AI)
                </div>
                <div className="text-sm font-semibold text-[var(--ink)]">
                  Ultima attivita {formatDateTime(summaryMeta.lastActivity)}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-2 py-0.5 font-semibold text-[var(--muted)]">
                  {summaryMeta.threadCount} thread
                </span>
                {summaryMeta.unreadCount > 0 && (
                  <span className="rounded-full border border-[var(--accent)] bg-[var(--panel-strong)] px-2 py-0.5 font-semibold text-[var(--accent)]">
                    {summaryMeta.unreadCount} non letti
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => refreshSummary(selected.id, true)}
                  disabled={summaryLoading}
                  className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-xs font-semibold text-[var(--muted)] transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--panel-strong)] disabled:opacity-60"
                >
                  {summaryLoading ? "Riassumo..." : "Aggiorna riassunto"}
                </button>
              </div>
            </div>

            {summaryError && (
              <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {summaryError}
              </div>
            )}

            {!summary && !summaryLoading && (
              <div className="mt-3 text-sm text-[var(--muted)]">
                Nessun riassunto disponibile. Premi “Aggiorna riassunto”.
              </div>
            )}

            {summary && (
              <div className="mt-3 grid gap-3 text-sm text-[var(--ink)]">
                {summary.parsed ? (
                  <div className="grid gap-2">
                    {summary.parsed.one_liner && (
                      <div className="text-base font-semibold text-[var(--ink)]">
                        {summary.parsed.one_liner}
                      </div>
                    )}
                    {summary.rateLimited && (
                      <div className="rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200">
                        Quota AI esaurita · mostrato ultimo riassunto disponibile
                      </div>
                    )}
                  </div>
                ) : (
                  summary.raw && (
                    <div className="whitespace-pre-wrap text-[var(--muted)]">
                      {summary.raw}
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        )}

        <div className="grid gap-3">
          {emailThreads.map((thread) => (
            <details
              key={thread.key}
              className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] shadow-sm"
              open={openThreads[thread.key] ?? false}
              onToggle={(event) => {
                const isOpen = (event.currentTarget as HTMLDetailsElement).open;
                setOpenThreads((prev) => ({
                  ...prev,
                  [thread.key]: isOpen,
                }));
                if (!isOpen && selectedEmailId) {
                  const isSelectedInThread = thread.messages.some(
                    (message) => message.id === selectedEmailId
                  );
                  if (isSelectedInThread) {
                    setSelectedEmailId(null);
                  }
                }
              }}
            >
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--ink)]">
                      {thread.subject}
                    </div>
                    <div className="mt-1 text-xs text-[var(--muted)]">
                      Ultima attivita {formatDateTime(thread.latestAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-2 py-0.5 font-semibold text-[var(--muted)]">
                      {thread.total} messaggi
                    </span>
                    {thread.unreadCount > 0 && (
                      <span className="rounded-full border border-[var(--accent)] bg-[var(--panel-strong)] px-2 py-0.5 font-semibold text-[var(--accent)]">
                        {thread.unreadCount} non letti
                      </span>
                    )}
                  </div>
                </div>
              </summary>
              <div className="border-t border-[var(--line)] px-4 py-3">
                <div className="grid gap-2">
                  {thread.messages.map((email) => {
                    const address =
                      email.direction === "inbound"
                        ? email.from_email
                        : email.to_email;
                    const preview =
                      email.subject ||
                      email.text_body?.replace(/\s+/g, " ").trim() ||
                      "Senza oggetto";
                    const isRead = emailReadById[email.id] ?? true;
                    const directionLabel =
                      email.direction === "inbound" ? "Ricevuta" : "Inviata";
                    const directionStyle =
                      email.direction === "inbound"
                        ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                        : "border-amber-400/40 bg-amber-500/10 text-amber-200";
                    return (
                      <button
                        key={email.id}
                        type="button"
                        onClick={() => handleSelectEmail(email.id)}
                        className={`perf-card rounded-xl border px-3 py-2 text-left transition ${
                          email.id === selectedEmailId
                            ? "border-[var(--accent)] bg-[var(--panel-strong)]"
                            : isRead
                              ? "border-[var(--line)] bg-[var(--panel)]"
                              : "border-[var(--accent)] bg-[var(--panel-strong)]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
                          <span className="flex items-center gap-2">
                            {!isRead && (
                              <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                            )}
                            <span>
                              {email.direction === "inbound" ? "Da" : "A"}{" "}
                              {address || "—"}
                            </span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${directionStyle}`}
                            >
                              {directionLabel}
                            </span>
                            <span>
                              {formatDateTime(
                                email.received_at ?? email.created_at
                              )}
                            </span>
                          </span>
                        </div>
                        <div
                          className={`mt-1 text-sm text-[var(--ink)] ${
                            isRead ? "font-semibold" : "font-bold"
                          }`}
                        >
                          {preview.length > 120
                            ? `${preview.slice(0, 120)}…`
                            : preview}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </details>
          ))}
        </div>

        {selectedEmail &&
          openThreads[
            normalizeThreadSubject(selectedEmail.subject).toLowerCase()
          ] && (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Dettaglio email
              </div>
              <div className="mt-2 text-sm font-semibold">
                {selectedEmail.subject || "Senza oggetto"}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    selectedEmail.direction === "inbound"
                      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                      : "border-amber-400/40 bg-amber-500/10 text-amber-200"
                  }`}
                >
                  {selectedEmail.direction === "inbound" ? "Ricevuta" : "Inviata"}
                </span>
                <span>
                  {selectedEmail.direction === "inbound" ? "Da" : "A"}{" "}
                  {selectedEmail.direction === "inbound"
                    ? selectedEmail.from_email
                    : selectedEmail.to_email}
                </span>
                <span>·</span>
                <span>
                  {formatDateTime(
                    selectedEmail.received_at ?? selectedEmail.created_at
                  )}
                </span>
              </div>
              <div className="mt-3 text-sm text-[var(--ink)]">
                {selectedEmailHtml ? (
                  <div
                    className="email-html"
                    dangerouslySetInnerHTML={{ __html: selectedEmailHtml }}
                  />
                ) : (
                  <div className="whitespace-pre-wrap">
                    {selectedEmail.text_body ||
                      "Nessun testo disponibile per questa email."}
                  </div>
                )}
              </div>
              {selectedEmailAttachments.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    Allegati ({selectedEmailAttachments.length})
                  </div>
                  <div className="mt-2 grid gap-2">
                    {selectedEmailAttachments.map((attachment, index) => {
                      const meta = [
                        attachment.contentType,
                        formatBytes(attachment.size),
                        attachment.inline ? "inline" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      const downloadUrl = selectedEmail?.id
                        ? buildAttachmentDownloadUrl(
                            selectedEmail.id,
                            attachment.index,
                            false
                          )
                        : null;
                      return (
                        <div
                          key={`${attachment.filename}-${index}`}
                          className="rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-[var(--ink)]">
                              {attachment.filename}
                            </div>
                            {downloadUrl ? (
                              <a
                                href={downloadUrl}
                                download
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-full border border-[var(--accent)] bg-[var(--accent)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-[var(--accent-strong)]"
                              >
                                Scarica
                              </a>
                            ) : (
                              <span className="text-xs text-[var(--muted)]">
                                Non disponibile
                              </span>
                            )}
                          </div>
                          {meta && (
                            <div className="text-xs text-[var(--muted)]">
                              {meta}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

        <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3">
          <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            Rispondi
          </div>
          <div className="mt-2 text-xs text-[var(--muted)]">
            A: {selected.email || "—"}
          </div>
          <input
            className="mt-3 w-full"
            placeholder="Oggetto"
            value={emailSubject}
            onChange={(event) => setEmailSubject(event.target.value)}
          />
          <textarea
            className="mt-3 w-full"
            rows={4}
            placeholder="Scrivi il messaggio..."
            value={emailBody}
            onChange={(event) => setEmailBody(event.target.value)}
          />
          {emailsError && (
            <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {emailsError}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSendEmail}
              disabled={sendingEmail}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
            >
              {sendingEmail ? "Invio..." : "Invia email"}
            </button>
            {getReplyTarget() && (
              <span className="text-xs text-[var(--muted)]">
                Risposta collegata al thread esistente.
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="relative min-h-screen overflow-hidden px-6 pb-16 pt-10 sm:px-10">
      <header className="relative mx-auto mb-10 flex w-full max-w-7xl flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
              CRM personale
            </p>
            <h1 className="text-3xl font-semibold text-[var(--ink)] sm:text-4xl">
              Contatti registi e produzioni
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm text-[var(--muted)] shadow-sm">
              Ultimo sync:{" "}
              {lastSyncAt
                ? lastSyncAt.toLocaleTimeString("it-IT", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "mai"}
            </div>
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={syncing}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_30px_-18px_rgba(37,99,235,0.9)] transition hover:-translate-y-0.5 hover:bg-[var(--accent-strong)] disabled:opacity-60"
            >
              {syncing ? "Sync..." : "Sync ora"}
            </button>
          </div>
        </div>
        {syncMessage && (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-xs text-[var(--muted)] shadow-sm">
            {syncMessage}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((status) => (
            <div
              key={status}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${statusStyles[status]}`}
            >
              <span>{status}</span>
              <span className="rounded-full bg-[var(--panel-strong)] px-2 py-0.5 text-[11px]">
                {counts[status] ?? 0}
              </span>
            </div>
          ))}
        </div>
      </header>

      <main className="relative mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[340px_1fr]">
        <section className="rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-lg">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Nuovo contatto
          </h2>
          <form onSubmit={handleAdd} className="mt-4 grid gap-3">
            <input
              placeholder="Nome e cognome"
              value={newContact.name}
              onChange={(event) =>
                setNewContact((prev) => ({ ...prev, name: event.target.value }))
              }
            />
            <input
              placeholder="Email"
              type="email"
              value={newContact.email}
              onChange={(event) =>
                setNewContact((prev) => ({ ...prev, email: event.target.value }))
              }
            />
            <input
              placeholder="Produzione / Studio"
              value={newContact.company}
              onChange={(event) =>
                setNewContact((prev) => ({
                  ...prev,
                  company: event.target.value,
                }))
              }
            />
            <select
              value={newContact.role}
              onChange={(event) =>
                setNewContact((prev) => ({ ...prev, role: event.target.value }))
              }
            >
              <option value="">Ruolo</option>
              <option value="Regista">Regista</option>
              <option value="Produzione">Produzione</option>
              <option value="Regista e Produzione">Regista e Produzione</option>
            </select>
            <button
              type="submit"
              disabled={adding}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_30px_-18px_rgba(37,99,235,0.9)] transition hover:-translate-y-0.5 hover:bg-[var(--accent-strong)] disabled:opacity-60"
            >
              {adding ? "Salvo..." : "+ Aggiungi"}
            </button>
          </form>
          {addError && (
            <div className="mt-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs text-red-200">
              {addError}
            </div>
          )}

          <div className="mt-8 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            <span>Contatti</span>
            <span>{contacts.length}</span>
          </div>

          <div className="mt-4 grid gap-3">
            {loading && (
              <div className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
                Caricamento...
              </div>
            )}
            {!loading && contacts.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
                Nessun contatto ancora. Aggiungi il primo.
              </div>
            )}
            {!loading &&
              contacts.length > 0 &&
              STATUS_OPTIONS.map((status) => {
                const group = contactsByStatus[status] ?? [];
                return (
                  <details
                    key={status}
                    open={openContactGroups[status]}
                    onToggle={(event) => {
                      const isOpen = (event.target as HTMLDetailsElement).open;
                      setOpenContactGroups((prev) => ({
                        ...prev,
                        [status]: isOpen,
                      }));
                    }}
                    className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-3"
                  >
                    <summary className="flex cursor-pointer items-center justify-between gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                      <span>{status}</span>
                      <span className="rounded-full bg-[var(--panel-strong)] px-2 py-0.5 text-[11px]">
                        {group.length}
                      </span>
                    </summary>
                    <div className="mt-3 grid gap-3">
                      {group.length === 0 && (
                        <div className="rounded-xl border border-dashed border-[var(--line)] p-3 text-xs text-[var(--muted)]">
                          Nessun contatto in questa cartella.
                        </div>
                      )}
                      {group.map((contact) => {
                        const isSelected = contact.id === selectedId;
                        return (
                          <div key={contact.id} className="grid gap-3">
                            <button
                              onClick={() => handleSelectContact(contact)}
                              className={`perf-card flex w-full flex-col gap-3 rounded-2xl border px-4 py-3 text-left transition hover:-translate-y-1 hover:shadow-[0_18px_40px_-30px_rgba(15,23,42,0.5)] ${
                                isSelected
                                  ? "border-[var(--accent)] bg-[var(--panel-strong)]"
                                  : "border-[var(--line)] bg-[var(--panel)]"
                              } ${
                                contact.status === "Chiuso"
                                  ? "opacity-70 hover:opacity-100"
                                  : ""
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-3">
                                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)]/10 text-sm font-semibold text-[var(--accent)]">
                                    {getInitials(getDisplayName(contact))}
                                  </div>
                                  <div>
                                    <div className="text-sm font-semibold">
                                      {getDisplayName(contact)}
                                    </div>
                                    <div className="text-xs text-[var(--muted)]">
                                      {[contact.role, contact.company]
                                        .filter(Boolean)
                                        .join(" · ") || "—"}
                                    </div>
                                  </div>
                                </div>
                                <span
                                  className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${statusStyles[contact.status]}`}
                                >
                                  {contact.status}
                                </span>
                              </div>
                              <div className="text-xs text-[var(--muted)]">
                                {contact.status === "Chiuso" ? (
                                  <>Chiuso · contattare via telefono</>
                                ) : contact.status === "Non interessato" ? (
                                  <>Non interessato · non ricontattare</>
                                ) : (
                                  <>
                                    Prossima azione:{" "}
                                    {formatDate(contact.next_action_at)}
                                    {contact.next_action_note
                                      ? ` · ${contact.next_action_note}`
                                      : ""}
                                  </>
                                )}
                              </div>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                );
              })}
          </div>
        </section>

        <section className="rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-6 shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                {selected ? "Dettagli" : "Seleziona"}
              </p>
              <h2 className="text-2xl font-semibold">
                {selected ? getDisplayName(selected) : "Contatto"}
              </h2>
            </div>
            {selected && (
              <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusStyles[selected.status]}`}>
                {selected.status}
              </div>
            )}
          </div>

          {!selected && (
            <div className="mt-10 rounded-2xl border border-dashed border-[var(--line)] p-6 text-sm text-[var(--muted)]">
              Seleziona un contatto per vedere i dettagli.
            </div>
          )}

          {selected && (
            <div className="mt-6 grid gap-6">
              {renderContactDetails(selected.id)}
              {renderConversation()}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
