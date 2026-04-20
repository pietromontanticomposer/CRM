"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  KEEP_IN_TOUCH_MONTHS,
  KEEP_IN_TOUCH_NOTE,
  SECOND_FOLLOW_UP_DAYS,
  buildAutomaticFollowUpNote,
  getAutomaticFollowUpStage,
  isKeepInTouchNote,
  AUTO_FOLLOW_UP_1_NOTE,
  AUTO_FOLLOW_UP_2_NOTE,
  isMaintainRapportNote,
  buildMaintainRapportNote,
  buildMaintainRapportEmail,
  extractFirstName,
  isManualRecontactNote,
  buildManualRecontactNote,
} from "@/lib/followUp";

const STATUS_OPTIONS = [
  "Attiva auto follow-up",
  "In attesa",
  "Azione richiesta",
  "Non interessato",
  "Mantenimento rapporto",
  "Call prenotata",
  "Contatto morto",
  "Collaborazione stabilita",
] as const;

type Status = (typeof STATUS_OPTIONS)[number];

const STATUS_GROUPS = {
  "In attesa di risposta": ["Attiva auto follow-up", "In attesa"],
  "Risposta ricevuta": [
    "Azione richiesta",
    "Non interessato",
    "Mantenimento rapporto",
    "Call prenotata",
    "Contatto morto",
    "Collaborazione stabilita",
  ],
} as const;

type MacroStatus = keyof typeof STATUS_GROUPS;
type ContactFolder = "Tutte" | Status | MacroStatus;

const NEW_CONTACT_STATUS_OPTIONS = ["Attiva auto follow-up", "In attesa"] as const;
type NewContactStatus = (typeof NEW_CONTACT_STATUS_OPTIONS)[number];

const emailProviderDefaults: Record<
  EmailProvider,
  Pick<EmailAccountDraft, "imapHost" | "imapPort">
> = {
  gmail: { imapHost: "imap.gmail.com", imapPort: "993" },
  outlook: { imapHost: "outlook.office365.com", imapPort: "993" },
  imap: { imapHost: "", imapPort: "993" },
};

const emptyEmailAccountDraft: EmailAccountDraft = {
  provider: "gmail",
  email: "",
  username: "",
  password: "",
  imapHost: emailProviderDefaults.gmail.imapHost,
  imapPort: emailProviderDefaults.gmail.imapPort,
  mailbox: "",
};

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
  last_inbound_email_at?: string | null;
  last_outbound_email_at?: string | null;
  activity_at?: string | null;
  language?: "it" | "en" | null;
};

type DraftContact = Omit<Contact, "created_at" | "updated_at">;

type NewContact = {
  name: string;
  email: string;
  company: string;
  role: string;
  status: NewContactStatus;
};

type ContactsApiResponse = {
  contacts?: Contact[];
  contact?: Contact;
  error?: string;
};

type EmailsApiResponse = {
  emails?: EmailRow[];
  readMap?: Record<string, boolean>;
  error?: string;
};

type EmailDirection = "inbound" | "outbound";

type EmailRow = {
  id: string;
  contact_id: string | null;
  direction: EmailDirection;
  gmail_uid: number | null;
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
  created_at: string | null;
  raw: Record<string, unknown> | null;
};

type EmailProvider = "gmail" | "outlook" | "imap";

type EmailAccount = {
  id: string;
  provider: EmailProvider;
  email: string;
  display_name: string | null;
  username: string | null;
  imap_host: string | null;
  imap_port: number | null;
  imap_secure: boolean | null;
  mailbox: string | null;
  sync_enabled: boolean | null;
  sync_status: string | null;
  last_sync_at: string | null;
  last_error: string | null;
};

type EmailAccountsApiResponse = {
  ok?: boolean;
  accounts?: EmailAccount[];
  account?: EmailAccount;
  error?: string;
};

type EmailAccountDraft = {
  provider: EmailProvider;
  email: string;
  username: string;
  password: string;
  imapHost: string;
  imapPort: string;
  mailbox: string;
};

type ComposePreset =
  | "custom"
  | "first_follow_up_tu"
  | "first_follow_up_lei";

export type CrmTheme = "light" | "dark";

const emptyNewContact: NewContact = {
  name: "",
  email: "",
  company: "",
  role: "",
  status: "Attiva auto follow-up",
};

const statusStylesByTheme: Record<CrmTheme, Record<Status, string>> = {
  dark: {
    "Attiva auto follow-up": "bg-indigo-500/15 text-indigo-200 border-indigo-400/30",
    "In attesa": "bg-sky-500/15 text-sky-200 border-sky-400/30",
    "Azione richiesta": "bg-amber-500/15 text-amber-200 border-amber-400/30",
    "Non interessato": "bg-rose-500/15 text-rose-200 border-rose-400/30",
    "Contatto morto": "bg-gray-500/15 text-gray-400 border-gray-500/30",
    "Mantenimento rapporto": "bg-teal-500/15 text-teal-200 border-teal-400/30",
    "Collaborazione stabilita": "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
    "Call prenotata": "bg-violet-500/15 text-violet-200 border-violet-400/30",
  },
  light: {
    "Attiva auto follow-up": "border-indigo-500 bg-indigo-100 text-indigo-900",
    "In attesa": "border-sky-500 bg-sky-100 text-sky-900",
    "Azione richiesta": "border-amber-500 bg-amber-100 text-amber-900",
    "Non interessato": "border-rose-500 bg-rose-100 text-rose-900",
    "Contatto morto": "border-gray-400 bg-gray-100 text-gray-500",
    "Mantenimento rapporto": "border-teal-500 bg-teal-100 text-teal-900",
    "Collaborazione stabilita": "border-emerald-500 bg-emerald-100 text-emerald-900",
    "Call prenotata": "border-violet-500 bg-violet-100 text-violet-900",
  },
};


const QUICK_RECONTACT_DAYS = [7, 10, 15, 30] as const;
const TWO_COLUMN_LAYOUT_MIN_WIDTH = 768;

const toneStylesByTheme = {
  dark: {
    error: "border-red-500/40 bg-red-500/10 text-red-200",
    warning: "border-amber-400/40 bg-amber-500/10 text-amber-200",
    success: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
    danger: "border-rose-400/40 bg-rose-500/10 text-rose-200",
    inbound: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
    outbound: "border-amber-400/40 bg-amber-500/10 text-amber-200",
    keepInTouch: "border-cyan-400/40 bg-cyan-500/10 text-cyan-100",
  },
  light: {
    error: "border-red-300 bg-red-50 text-red-700",
    warning: "border-amber-300 bg-amber-50 text-amber-800",
    success: "border-emerald-500 bg-emerald-50 text-emerald-900",
    danger: "border-rose-300 bg-rose-50 text-rose-800",
    inbound: "border-emerald-300 bg-emerald-50 text-emerald-800",
    outbound: "border-amber-300 bg-amber-50 text-amber-800",
    keepInTouch: "border-teal-500 bg-teal-50 text-teal-900",
  },
} as const;

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

const addMonthsToDateInputValue = (dateInput: string, months: number) => {
  const parsed = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateInput;
  parsed.setMonth(parsed.getMonth() + months);
  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
  const day = `${parsed.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDaysToDateInputValue = (dateInput: string, days: number) => {
  const parsed = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateInput;
  parsed.setDate(parsed.getDate() + days);
  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
  const day = `${parsed.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const buildRecontactReminderNote = (days: number) =>
  `Azione richiesta - ricontattare tra ${days} giorni`;

const AUTOMATION_RUN_HOUR = 10;
const MINUTE_MS = 60 * 1000;
const AUTO_SYNC_THROTTLE_MS = 5 * MINUTE_MS;
const OPEN_SYNC_CONCURRENCY = 2;

const toDateKey = (value?: string | null) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const isOpenFollowUpContact = (contact: Contact, today: string) => {
  if (
    contact.status === "Non interessato" ||
    contact.status === "Collaborazione stabilita"
  ) {
    return false;
  }
  const nextActionDate = toDateKey(contact.next_action_at);
  if (!nextActionDate) return false;
  return nextActionDate <= today;
};

const getAutomationTargetDate = (value?: string | null) => {
  const dateKey = toDateKey(value);
  if (!dateKey) return null;

  const target = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  target.setHours(AUTOMATION_RUN_HOUR, 0, 0, 0);
  return target;
};

const formatCountdownDuration = (milliseconds: number) => {
  const totalMinutes = Math.max(1, Math.ceil(Math.abs(milliseconds) / MINUTE_MS));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}g ${hours}h` : `${days}g`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
};

const formatAutomationTarget = (target: Date) =>
  target.toLocaleString("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const formatAutomationTime = (target: Date) =>
  target.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });

const getFollowUpSendStatus = (contact: Contact, nowMs: number) => {
  const today = getTodayDateInputValue();
  const lastActionToday = toDateKey(contact.last_action_at) === today;
  const lastOutboundToday = toDateKey(contact.last_outbound_email_at) === today;
  const lastActionNote = contact.last_action_note?.trim().toLowerCase() ?? "";
  const sentFollowUpToday =
    lastActionToday &&
    lastActionNote.includes("follow-up") &&
    lastActionNote.includes("inviato");

  if (sentFollowUpToday) {
    return { label: "Follow-up inviato oggi", sent: true };
  }

  const stage = getAutomaticFollowUpStage(contact.next_action_note);
  const target = getAutomationTargetDate(contact.next_action_at);

  if (stage && target && nowMs < target.getTime()) {
    return {
      label: `Non ancora inviato: parte alle ${formatAutomationTime(target)}`,
      sent: false,
    };
  }

  if (stage) {
    return {
      label: `Non risulta inviato - follow-up ${stage}/2`,
      sent: false,
    };
  }

  if (isManualRecontactNote(contact.next_action_note)) {
    return { label: "Promemoria manuale, non invia mail", sent: false };
  }

  if (lastOutboundToday) {
    return { label: "Email inviata oggi", sent: true };
  }

  return { label: "Da gestire, non risulta inviato", sent: false };
};

const getScheduledCountdown = (
  nextActionAt: string | null | undefined,
  nextActionNote: string | null | undefined,
  nowMs: number
) => {
  const stage = getAutomaticFollowUpStage(nextActionNote);
  const isMaintain = isMaintainRapportNote(nextActionNote);
  if (!stage && !isMaintain) return null;

  const target = getAutomationTargetDate(nextActionAt);
  if (!target) return null;

  const diff = target.getTime() - nowMs;
  const duration = formatCountdownDuration(diff);
  const isOverdue = diff < 0;

  return {
    kind: isMaintain ? "maintain" : "auto",
    title: isMaintain ? "Mantenimento rapporto" : `Follow-up automatico ${stage}/2`,
    label: isOverdue ? `In ritardo da ${duration}` : `Mancano ${duration}`,
    targetLabel: formatAutomationTarget(target),
    note: nextActionNote,
  };
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

const stripHtmlToText = (value?: string | null) => {
  if (!value) return "";
  if (typeof window !== "undefined") {
    const parser = new DOMParser();
    const doc = parser.parseFromString(value, "text/html");
    return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  }

  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
};

const getEmailExcerpt = (
  email: Pick<EmailRow, "text_body" | "html_body" | "subject">
) => {
  const textBody = email.text_body?.replace(/\s+/g, " ").trim();
  if (textBody) return textBody;

  const htmlText = stripHtmlToText(email.html_body);
  if (htmlText) return htmlText;

  const subject = email.subject?.replace(/\s+/g, " ").trim();
  return subject || "Nessun testo disponibile.";
};

const getRecipientSummary = (value?: string | null) => {
  const addresses = extractEmails(value);
  if (!addresses.length) return value?.trim() || "—";
  if (addresses.length === 1) return addresses[0];
  if (addresses.length === 2) return `${addresses[0]}, ${addresses[1]}`;
  return `${addresses[0]} +${addresses.length - 1} destinatari`;
};

const readApiError = async (response: Response, fallback: string) => {
  const payload = (await response.json().catch(() => null)) as
    | ContactsApiResponse
    | null;
  return payload?.error?.trim() || fallback;
};

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

  const sanitizeInlineStyle = (value: string) => {
    const cleaned = value
      .split(";")
      .map((rule) => rule.trim())
      .filter(Boolean)
      .filter((rule) => {
        const [property] = rule.split(":");
        const normalized = property?.trim().toLowerCase();
        if (!normalized) return false;
        return ![
          "color",
          "background",
          "background-color",
          "background-image",
        ].includes(normalized);
      });

    return cleaned.join("; ");
  };

  doc.querySelectorAll("*").forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith("on")) {
        node.removeAttribute(attr.name);
      }
      if (["bgcolor", "text", "color", "link", "vlink"].includes(name)) {
        node.removeAttribute(attr.name);
      }
      if (name === "style") {
        const sanitizedStyle = sanitizeInlineStyle(value);
        if (sanitizedStyle) {
          node.setAttribute("style", sanitizedStyle);
        } else {
          node.removeAttribute(attr.name);
        }
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

  doc.querySelectorAll("img").forEach((image) => {
    const src = image.getAttribute("src")?.trim() || "";
    if (!src) {
      image.remove();
      return;
    }

    image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");
    image.setAttribute("referrerpolicy", "no-referrer");
    image.removeAttribute("srcset");
    if (!image.getAttribute("alt")) {
      image.setAttribute("alt", "");
    }
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

const buildReplySubject = (subject?: string | null, fallback?: string | null) => {
  const base = subject?.trim() || fallback?.trim() || "";
  if (!base) return "";
  return /^re:/i.test(base) ? base : `Re: ${base}`;
};

const FIRST_FOLLOW_UP_SUBJECT = "Il tuo lavoro";

const buildFirstFollowUpGreeting = (contactName?: string | null) => {
  const name = contactName?.trim();
  return name ? `${name},` : null;
};

const buildFirstFollowUpBodyLei = (contactName?: string | null) => {
  const greeting = buildFirstFollowUpGreeting(contactName);
  return [
    greeting,
    "",
    "le scrivo per fare un follow-up al mio messaggio precedente riguardo a una possibile collaborazione.",
    "",
    "Sarebbe interessato a scambiare due parole per capire se potremmo essere un buon match creativo? Se sì, sono disponibile per una breve chiamata settimana prossima: lunedì, martedì o mercoledì alle 16:30.",
    "",
    "Se può essere utile per farsi un'idea sono disponibile a preparare uno sketch su una sua scena, senza nessun impegno.",
    "",
    "Un saluto,",
    "Pietro Montanti",
    "pietromontanti.com",
  ]
    .filter((line) => line !== null)
    .join("\n");
};

const buildFirstFollowUpBodyTu = (contactName?: string | null) => {
  const greeting = buildFirstFollowUpGreeting(contactName);
  return [
    greeting,
    "",
    "ti scrivo per fare un follow-up al mio messaggio precedente riguardo a una possibile collaborazione.",
    "",
    "Ti andrebbe di scambiare due parole per capire se potremmo essere un buon match creativo? Se sì, sono disponibile per una breve chiamata settimana prossima: lunedì, martedì o mercoledì alle 16:30.",
    "",
    "Se ti può essere utile per farti un'idea, posso preparare uno sketch su una tua scena, senza nessun impegno.",
    "",
    "Un saluto,",
    "Pietro Montanti",
    "pietromontanti.com",
  ]
    .filter((line) => line !== null)
    .join("\n");
};

const extractMessageIds = (value?: string | null) => {
  if (!value) return [];
  const bracketMatches = value.match(/<[^>]+>/g);
  const tokens =
    bracketMatches && bracketMatches.length > 0
      ? bracketMatches
      : value.split(/\s+/);
  const unique = new Set(
    tokens
      .map((token) => token.trim().replace(/^<|>$/g, "").toLowerCase())
      .filter(Boolean)
  );
  return Array.from(unique);
};

const getEmailThreadKey = (email: Pick<
  EmailRow,
  "subject" | "message_id_header" | "in_reply_to" | "references"
>) => {
  const references = extractMessageIds(email.references);
  if (references.length > 0) {
    return `msg:${references[0]}`;
  }

  const replyTo = extractMessageIds(email.in_reply_to);
  if (replyTo.length > 0) {
    return `msg:${replyTo[0]}`;
  }

  const messageIds = extractMessageIds(email.message_id_header);
  if (messageIds.length > 0) {
    return `msg:${messageIds[0]}`;
  }

  return `sub:${normalizeThreadSubject(email.subject).toLowerCase()}`;
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

const getStatusLabel = (status: string) =>
  status === "Attiva auto follow-up" ? "Auto follow-up attivato" : status;

const getLanguageFlag = (language?: Contact["language"]) => {
  if (language === "it") return "🇮🇹";
  if (language === "en") return "🇬🇧";
  return null;
};

const getContactActivityTimestamp = (contact: Contact) =>
  Math.max(
    getTimestamp(contact.activity_at ?? null),
    getTimestamp(contact.last_inbound_email_at ?? null),
    getTimestamp(contact.updated_at),
    getTimestamp(contact.created_at)
  );

const sortContacts = (contacts: Contact[]) =>
  [...contacts].sort((a, b) => {
    const aInbound = getTimestamp(a.last_inbound_email_at ?? null);
    const bInbound = getTimestamp(b.last_inbound_email_at ?? null);
    // Chi ha risposto va prima di chi non ha mai risposto
    const aHasReply = aInbound > 0 ? 1 : 0;
    const bHasReply = bInbound > 0 ? 1 : 0;
    if (aHasReply !== bHasReply) return bHasReply - aHasReply;
    // Tra chi ha risposto, ordina per risposta più recente
    if (aInbound !== bInbound) return bInbound - aInbound;
    // Fallback: attività generale
    const activityDiff =
      getContactActivityTimestamp(b) - getContactActivityTimestamp(a);
    if (activityDiff !== 0) return activityDiff;
    return getTimestamp(b.created_at) - getTimestamp(a.created_at);
  });

const getMostRecentlyCreatedContact = (contacts: Contact[]) => {
  if (!contacts.length) return null;
  return contacts.reduce((latest, current) =>
    getTimestamp(current.created_at) > getTimestamp(latest.created_at)
      ? current
      : latest
  );
};

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

const PULSE_DURATION_MS = 2000;
const notifyCrmNotificationsUpdated = () => {
  window.dispatchEvent(new Event("crm:notifications-updated"));
};

export default function CrmApp({ theme }: { theme: CrmTheme }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newContact, setNewContact] = useState<NewContact>(emptyNewContact);
  const [contactSearch, setContactSearch] = useState("");
  const [contactFolder, setContactFolder] = useState<ContactFolder>("Tutte");
  const [draft, setDraft] = useState<DraftContact | null>(null);
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailsError, setEmailsError] = useState<string | null>(null);
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [emailAccountsLoading, setEmailAccountsLoading] = useState(false);
  const [emailAccountsReady, setEmailAccountsReady] = useState(false);
  const [emailAccountsError, setEmailAccountsError] = useState<string | null>(null);
  const [selectedEmailAccountId, setSelectedEmailAccountId] = useState("");
  const [showEmailAccountForm, setShowEmailAccountForm] = useState(false);
  const [emailAccountDraft, setEmailAccountDraft] = useState<EmailAccountDraft>(
    emptyEmailAccountDraft
  );
  const [emailAccountSaving, setEmailAccountSaving] = useState(false);
  const [emailAccountTesting, setEmailAccountTesting] = useState(false);
  const [emailAccountMessage, setEmailAccountMessage] = useState<string | null>(null);
  const [emailReadById, setEmailReadById] = useState<Record<string, boolean>>(
    {}
  );
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [emailPreset, setEmailPreset] = useState<ComposePreset>("custom");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [scheduleSendDate, setScheduleSendDate] = useState("");
  const [schedulingEmail, setSchedulingEmail] = useState(false);
  const [scheduledEmails, setScheduledEmails] = useState<
    Array<{
      id: string;
      to_email: string;
      subject: string | null;
      text_body: string | null;
      send_at: string;
      contact_id: string | null;
    }>
  >([]);
  const [ensuredAttachments, setEnsuredAttachments] = useState<
    Record<string, "pending" | "done">
  >({});
  const [backfillByContact, setBackfillByContact] = useState<
    Record<string, "pending" | "done">
  >({});
  const [followUpActionByContact, setFollowUpActionByContact] = useState<
    Record<string, "recontacted" | "keepwarm">
  >({});
  const [followUpMessage, setFollowUpMessage] = useState<string | null>(null);
  const [maintainRapportPending, setMaintainRapportPending] = useState<string | null>(null);
  const [maintainRapportMessage, setMaintainRapportMessage] = useState<string | null>(null);
  const [showMaintainWorkflow, setShowMaintainWorkflow] = useState(false);
  const [desktopSidebarHeight, setDesktopSidebarHeight] = useState<number | null>(null);
  const contentSectionRef = useRef<HTMLElement | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const emailRequestIdRef = useRef(0);
  const backfillContactIdsRef = useRef<Set<string>>(new Set());
  const backfillCompletedAtRef = useRef<Record<string, number>>({});
  const emailAccountSelectionReadyRef = useRef(false);
  const openSyncStartedRef = useRef(false);
  const statusStyles = statusStylesByTheme[theme];
  const toneStyles = toneStylesByTheme[theme];
  const deleteButtonClass =
    theme === "light"
      ? "rounded-full border border-red-600 bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
      : "rounded-full border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-200 transition hover:border-red-400/70 hover:bg-red-500/10 disabled:opacity-60";
  const keepInTouchButtonClass =
    theme === "light"
      ? "rounded-full border border-teal-700 bg-teal-600 px-2 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-60"
      : "rounded-full border border-teal-300/60 bg-teal-500/20 px-2 py-1 text-[11px] font-semibold text-teal-100 transition hover:bg-teal-500/30 disabled:opacity-60";

  const selected = contacts.find((contact) => contact.id === selectedId) || null;
  const conversationRefreshing = Boolean(
    selected &&
      (emailsLoading || backfillByContact[selected.id] === "pending")
  );
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
  const activeEmailAccount =
    emailAccounts.find((account) => account.id === selectedEmailAccountId) ||
    null;
  const activeEmailAccountLabel = activeEmailAccount
    ? activeEmailAccount.display_name || activeEmailAccount.email
    : emailAccounts.length > 0
      ? "Tutte le caselle collegate"
      : "Gmail attuale";

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCountdownNow(Date.now());
    }, 30 * 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    let frameId = 0;

    const updatePulseClock = () => {
      const phase =
        ((Date.now() % PULSE_DURATION_MS) / PULSE_DURATION_MS) * Math.PI * 2;
      const strength = (1 - Math.cos(phase)) / 2;

      root.style.setProperty(
        "--crm-pulse-blur",
        `${(strength * 16).toFixed(2)}px`
      );
      root.style.setProperty(
        "--crm-pulse-spread",
        `${(strength * 6).toFixed(2)}px`
      );
      root.style.setProperty(
        "--crm-pulse-alpha",
        (0.5 - strength * 0.1).toFixed(3)
      );

      frameId = window.requestAnimationFrame(updatePulseClock);
    };

    updatePulseClock();

    return () => {
      window.cancelAnimationFrame(frameId);
      root.style.removeProperty("--crm-pulse-blur");
      root.style.removeProperty("--crm-pulse-spread");
      root.style.removeProperty("--crm-pulse-alpha");
    };
  }, []);

  useEffect(() => {
    if (!contacts.length || !emailAccountsReady) {
      return;
    }

    const selectedStillPresent = selectedId
      ? contacts.some((contact) => contact.id === selectedId)
      : false;

    if (selectedStillPresent) {
      return;
    }

    const defaultContact = getMostRecentlyCreatedContact(contacts);
    if (!defaultContact) {
      return;
    }

    selectedIdRef.current = defaultContact.id;
    setSelectedId(defaultContact.id);
    setDraft(buildDraft(defaultContact));
    void loadEmails(defaultContact.id, defaultContact.email, {
      resetConversation: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, selectedId, emailAccountsReady]);

  useEffect(() => {
    if (!emailAccountsReady || !contacts.length || openSyncStartedRef.current) {
      return;
    }

    openSyncStartedRef.current = true;
    void syncContactsOnOpen(contacts, emailAccounts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, emailAccounts, emailAccountsReady]);

  useEffect(() => {
    setShowMaintainWorkflow(false);
  }, [selectedId]);

  useEffect(() => {
    if (!emailAccountSelectionReadyRef.current) {
      emailAccountSelectionReadyRef.current = true;
      return;
    }
    if (!selected?.id) return;
    void loadEmails(selected.id, selected.email, {
      resetConversation: true,
      emailAccountId: selectedEmailAccountId || null,
      syncAllEmailAccounts: !selectedEmailAccountId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmailAccountId]);

  useEffect(() => {
    const updateSidebarHeight = () => {
      if (
        window.innerWidth < TWO_COLUMN_LAYOUT_MIN_WIDTH ||
        !contentSectionRef.current
      ) {
        setDesktopSidebarHeight(null);
        return;
      }

      const nextHeight = Math.round(
        contentSectionRef.current.getBoundingClientRect().height
      );

      setDesktopSidebarHeight((current) =>
        current === nextHeight ? current : nextHeight
      );
    };

    const frameId = window.requestAnimationFrame(updateSidebarHeight);
    window.addEventListener("resize", updateSidebarHeight);

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => updateSidebarHeight());

    if (observer && contentSectionRef.current) {
      observer.observe(contentSectionRef.current);
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateSidebarHeight);
      observer?.disconnect();
    };
  }, []);

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
          await loadEmails(selected.id, selected.email, {
            background: true,
            syncGmail: false,
          });
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
    const statusCounts = STATUS_OPTIONS.reduce(
      (acc, status) => {
        acc[status] = contacts.filter((contact) => contact.status === status)
          .length;
        return acc;
      },
      {} as Record<Status, number>
    );

    const groupCounts = (Object.keys(STATUS_GROUPS) as MacroStatus[]).reduce(
      (acc, group) => {
        acc[group] = STATUS_GROUPS[group].reduce(
          (sum, status) => sum + statusCounts[status],
          0
        );
        return acc;
      },
      {} as Record<MacroStatus, number>
    );

    return { ...statusCounts, ...groupCounts };
  }, [contacts]);

  const followUpCount = useMemo(() => {
    const today = getTodayDateInputValue();
    return contacts.filter((contact) => isOpenFollowUpContact(contact, today)).length;
  }, [contacts]);

  const searchedContacts = useMemo(() => {
    const query = contactSearch.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter((contact) => {
      const candidates = [
        contact.name,
        contact.email,
        contact.company,
        contact.role,
        contact.notes,
      ];
      return candidates.some((value) =>
        value?.toLowerCase().includes(query)
      );
    });
  }, [contacts, contactSearch]);

  const filteredContacts = useMemo(() => {
    if (contactFolder === "Tutte") return searchedContacts;
    
    // Se la cartella è un macrogruppo
    if (contactFolder in STATUS_GROUPS) {
      const allowedStatuses = STATUS_GROUPS[contactFolder as MacroStatus];
      return searchedContacts.filter((contact) =>
        (allowedStatuses as readonly string[]).includes(contact.status)
      );
    }

    // Altrimenti è uno stato singolo
    return searchedContacts.filter((contact) => contact.status === contactFolder);
  }, [searchedContacts, contactFolder]);


  const followUpSummary = useMemo(() => {
    const today = getTodayDateInputValue();
    const overdue: Contact[] = [];
    const dueToday: Contact[] = [];
    const sortByNextActionDate = (a: Contact, b: Contact) => {
      const aDate = toDateKey(a.next_action_at) ?? "9999-12-31";
      const bDate = toDateKey(b.next_action_at) ?? "9999-12-31";
      if (aDate !== bDate) return aDate.localeCompare(bDate);
      return getDisplayName(a).localeCompare(getDisplayName(b), "it");
    };

    contacts.forEach((contact) => {
      if (
        contact.status === "Non interessato" ||
        contact.status === "Mantenimento rapporto" ||
        contact.status === "Collaborazione stabilita"
      ) {
        return;
      }
      const nextActionDate = toDateKey(contact.next_action_at);
      if (!nextActionDate) return;
      if (nextActionDate < today) {
        overdue.push(contact);
        return;
      }
      if (nextActionDate === today) {
        dueToday.push(contact);
      }
    });

    overdue.sort(sortByNextActionDate);
    dueToday.sort(sortByNextActionDate);

    return {
      overdue,
      dueToday,
      totalOpen: overdue.length + dueToday.length,
    };
  }, [contacts]);

  const visibleEmails = useMemo(
    () =>
      [...emails].sort((a, b) => getEmailTimestamp(b) - getEmailTimestamp(a)),
    [emails]
  );

  const loadContacts = async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    const response = await fetch("/api/contacts", {
      method: "GET",
      cache: "no-store",
    }).catch(() => null);

    if (!response) {
      setError("Impossibile caricare i contatti. Il server non risponde.");
      if (!silent) {
        setLoading(false);
      }
      return [];
    }

    if (!response.ok) {
      setError(
        await readApiError(
          response,
          "Impossibile caricare i contatti. Controlla il database."
        )
      );
      if (!silent) {
        setLoading(false);
      }
      return [];
    }

    const payload = (await response.json()) as ContactsApiResponse;
    const nextContacts = payload.contacts || [];
    setContacts(nextContacts);
    if (!silent) {
      setLoading(false);
    }
    return nextContacts;
  };

  const loadEmailAccounts = async () => {
    setEmailAccountsReady(false);
    setEmailAccountsLoading(true);
    setEmailAccountsError(null);
    const response = await fetch("/api/email-accounts", {
      method: "GET",
      cache: "no-store",
    }).catch(() => null);

    if (!response) {
      setEmailAccountsError("Impossibile caricare gli account email.");
      setEmailAccountsLoading(false);
      setEmailAccountsReady(true);
      return [] as EmailAccount[];
    }

    if (!response.ok) {
      setEmailAccountsError(
        await readApiError(response, "Impossibile caricare gli account email.")
      );
      setEmailAccountsLoading(false);
      setEmailAccountsReady(true);
      return [] as EmailAccount[];
    }

    const payload = (await response.json()) as EmailAccountsApiResponse;
    const nextAccounts = payload.accounts || [];
    setEmailAccounts(nextAccounts);
    setSelectedEmailAccountId((prev) => {
      if (prev && nextAccounts.some((account) => account.id === prev)) {
        return prev;
      }
      return "";
    });
    setEmailAccountsLoading(false);
    setEmailAccountsReady(true);
    return nextAccounts;
  };

  const buildEmailAccountPayload = () => ({
    provider: emailAccountDraft.provider,
    email: emailAccountDraft.email,
    username: emailAccountDraft.username || emailAccountDraft.email,
    password: emailAccountDraft.password,
    imapHost: emailAccountDraft.imapHost,
    imapPort: Number(emailAccountDraft.imapPort || "993"),
    imapSecure: true,
    mailbox: emailAccountDraft.mailbox || null,
  });

  const handleEmailProviderChange = (provider: EmailProvider) => {
    const defaults = emailProviderDefaults[provider];
    setEmailAccountDraft((prev) => ({
      ...prev,
      provider,
      imapHost: defaults.imapHost,
      imapPort: defaults.imapPort,
    }));
    setEmailAccountMessage(null);
    setEmailAccountsError(null);
  };

  const handleTestEmailAccount = async () => {
    setEmailAccountTesting(true);
    setEmailAccountMessage(null);
    setEmailAccountsError(null);
    const response = await fetch("/api/email-accounts/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildEmailAccountPayload()),
    }).catch(() => null);

    if (!response) {
      setEmailAccountsError("Test connessione fallito.");
      setEmailAccountTesting(false);
      return false;
    }

    if (!response.ok) {
      setEmailAccountsError(
        await readApiError(response, "Test connessione fallito.")
      );
      setEmailAccountTesting(false);
      return false;
    }

    setEmailAccountMessage("Connessione email riuscita.");
    setEmailAccountTesting(false);
    return true;
  };

  const handleSaveEmailAccount = async () => {
    setEmailAccountSaving(true);
    setEmailAccountMessage(null);
    setEmailAccountsError(null);
    const response = await fetch("/api/email-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildEmailAccountPayload()),
    }).catch(() => null);

    if (!response) {
      setEmailAccountsError("Impossibile salvare account email.");
      setEmailAccountSaving(false);
      return;
    }

    if (!response.ok) {
      setEmailAccountsError(
        await readApiError(response, "Impossibile salvare account email.")
      );
      setEmailAccountSaving(false);
      return;
    }

    const payload = (await response.json()) as EmailAccountsApiResponse;
    const account = payload.account;
    if (account) {
      setEmailAccounts((prev) => [account, ...prev]);
      setSelectedEmailAccountId("");
      setEmailAccountDraft(emptyEmailAccountDraft);
      setShowEmailAccountForm(false);
      setEmailAccountMessage("Account email collegato.");
      void syncContactsOnOpen(contacts, [account]);
    }
    setEmailAccountSaving(false);
  };

  const loadEmails = async (
    contactId: string | null,
    email?: string | null,
    options?: {
      resetConversation?: boolean;
      background?: boolean;
      syncGmail?: boolean;
      emailAccountId?: string | null;
      syncAllEmailAccounts?: boolean;
      forceSync?: boolean;
    }
  ) => {
    const resetConversation = options?.resetConversation ?? false;
    const background = options?.background ?? false;
    const syncGmail = options?.syncGmail ?? true;
    const emailAccountId =
      options?.emailAccountId === undefined
        ? selectedEmailAccountId || null
        : options.emailAccountId || null;
    const syncAllEmailAccounts =
      options?.syncAllEmailAccounts ?? !emailAccountId;
    if (!contactId) {
      emailRequestIdRef.current += 1;
      setEmails([]);
      setSelectedEmailId(null);
      setEmailReadById({});
      setEmailsLoading(false);
      setEmailsError(null);
      return [] as EmailRow[];
    }

    const requestId = emailRequestIdRef.current + 1;
    emailRequestIdRef.current = requestId;

    if (resetConversation) {
      setEmails([]);
      setSelectedEmailId(null);
      setEmailReadById({});
    }

    if (!background) {
      setEmailsLoading(true);
      setEmailsError(null);
    }

    const query = new URLSearchParams();
    if (email?.trim()) {
      query.set("email", email);
    }
    query.set("limit", "150");

    const response = await fetch(
      `/api/contacts/${contactId}/emails${
        query.size ? `?${query.toString()}` : ""
      }`,
      {
        method: "GET",
        cache: "no-store",
      }
    ).catch(() => null);

    if (!response) {
      if (emailRequestIdRef.current !== requestId) return;
      if (!background) {
        setEmailsError("Impossibile caricare le email. Il server non risponde.");
      }
      setEmailsLoading(false);
      return [] as EmailRow[];
    }

    if (!response.ok) {
      if (emailRequestIdRef.current !== requestId) return;
      if (!background) {
        setEmailsError(
          await readApiError(response, "Impossibile caricare le email.")
        );
      }
      setEmailsLoading(false);
      return [] as EmailRow[];
    }

    const payload = (await response.json()) as EmailsApiResponse;
    if (emailRequestIdRef.current !== requestId) return;
    const emailRows = payload.emails || [];
    const readMap = payload.readMap || {};

    const seenIds = new Set();
    const uniqueRows = emailRows.filter((email) => {
      if (seenIds.has(email.id)) return false;
      seenIds.add(email.id);
      return true;
    });

    setEmails(uniqueRows);
    setEmailReadById(readMap);
    setEmailsLoading(false);

    if (syncGmail) {
      const accountIds = syncAllEmailAccounts
        ? emailAccounts.length > 0
          ? emailAccounts.map((account) => account.id)
          : [null]
        : [emailAccountId];

      void runBackfillForContact(contactId, email, accountIds, {
        force: options?.forceSync ?? false,
      }).then((synced) => {
        if (!synced) return;
        if (selectedIdRef.current === contactId) {
          void loadEmails(contactId, email, {
            background: true,
            syncGmail: false,
          });
        }
        void loadContacts({ silent: true });
      });
    }

    return uniqueRows;
  };

  const runBackfillForContact = async (
    contactId: string,
    email?: string | null,
    emailAccountIds?: Array<string | null>,
    options?: { force?: boolean; quiet?: boolean }
  ) => {
    const emailList = extractEmails(email);
    if (!emailList.length) return true;
    const accountIds =
      emailAccountIds && emailAccountIds.length > 0 ? emailAccountIds : [null];
    const uniqueAccountIds = Array.from(
      new Set(accountIds.map((accountId) => accountId || null))
    );
    const backfillKey = `${contactId}:${uniqueAccountIds
      .map((accountId) => accountId || "legacy")
      .join(",")}`;
    if (backfillContactIdsRef.current.has(backfillKey)) return false;
    if (!options?.force) {
      const lastCompletedAt = backfillCompletedAtRef.current[backfillKey] ?? 0;
      if (Date.now() - lastCompletedAt < AUTO_SYNC_THROTTLE_MS) {
        return false;
      }
    }

    backfillContactIdsRef.current.add(backfillKey);
    setBackfillByContact((prev) => ({ ...prev, [contactId]: "pending" }));
    if (!options?.quiet) {
      setEmailsError(null);
    }
    try {
      const syncAccount = async (accountId: string | null) => {
        let beforeUid: number | null = null;
        let batchCount = 0;

        while (batchCount < 1) {
          const response = await fetch("/api/gmail/backfill-contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              emails: emailList,
              contactId,
              limit: options?.force ? 20 : 6,
              sinceDays: options?.force ? 365 : 30,
              force: options?.force ?? false,
              beforeUid,
              emailAccountId: accountId || undefined,
            }),
          });
          if (!response.ok) {
            if (!options?.quiet) {
              setEmailsError(
                await readApiError(response, "Impossibile aggiornare le email.")
              );
            }
            return "failed" as const;
          }

          const payload = (await response.json()) as {
            inserted?: number;
            updated?: number;
            nextCursor?: number | null;
          };
          const changed =
            Number(payload?.inserted ?? 0) > 0 ||
            Number(payload?.updated ?? 0) > 0;
          const nextCursor =
            typeof payload?.nextCursor === "number" && payload.nextCursor > 0
              ? payload.nextCursor
              : null;

          batchCount += 1;
          if (!nextCursor) {
            return changed ? ("changed" as const) : ("unchanged" as const);
          }
          beforeUid = nextCursor;
        }
        return "unchanged" as const;
      };

      const results = await Promise.all(
        uniqueAccountIds.map((accountId) => syncAccount(accountId))
      );

      const ok = results.every((result) => result !== "failed");
      if (ok) {
        backfillCompletedAtRef.current[backfillKey] = Date.now();
      }
      return ok && results.some((result) => result === "changed");
    } catch (error) {
      console.error(error);
      if (!options?.quiet) {
        setEmailsError("Impossibile aggiornare le email da Gmail.");
      }
      return false;
    } finally {
      backfillContactIdsRef.current.delete(backfillKey);
      setBackfillByContact((prev) => {
        const next = { ...prev };
        delete next[contactId];
        return next;
      });
    }
  };

  const syncContactsOnOpen = async (
    contactsToSync: Contact[],
    accountsToSync: EmailAccount[]
  ) => {
    const targets = contactsToSync.filter(
      (contact) => contact.id && extractEmails(contact.email).length > 0
    );
    if (!targets.length) return;

    const accountIds =
      accountsToSync.length > 0
        ? accountsToSync.map((account) => account.id)
        : [null];
    let changed = false;
    let index = 0;

    const runWorker = async () => {
      while (index < targets.length) {
        const contact = targets[index];
        index += 1;
        if (!contact) continue;

        const synced = await runBackfillForContact(
          contact.id,
          contact.email,
          accountIds,
          { quiet: true }
        );
        if (!synced) continue;

        changed = true;
        if (selectedIdRef.current === contact.id) {
          void loadEmails(contact.id, contact.email, {
            background: true,
            syncGmail: false,
          });
        }
      }
    };

    const workerCount = Math.min(OPEN_SYNC_CONCURRENCY, targets.length);
    await Promise.all(
      Array.from({ length: workerCount }, () => runWorker())
    );

    if (changed) {
      await loadContacts({ silent: true });
      const selectedContact = contactsToSync.find(
        (contact) => contact.id === selectedIdRef.current
      );
      if (selectedContact) {
        await loadEmails(selectedContact.id, selectedContact.email, {
          background: true,
          syncGmail: false,
        });
      }
    }
  };

  const refreshContactEmailHistory = async (
    contactId: string,
    email?: string | null
  ) => {
    const backfilled = await runBackfillForContact(
      contactId,
      email,
      emailAccounts.length > 0
        ? emailAccounts.map((account) => account.id)
        : [null],
      { force: true }
    );

    if (selectedIdRef.current === contactId) {
      await loadEmails(contactId, email, {
        background: true,
        syncGmail: false,
      });
    }

    if (backfilled) {
      await loadContacts({ silent: true });
    }
  };

  const handleSelectContact = (contact: Contact) => {
    const scrollY = window.scrollY;
    const shouldResetConversation = selectedId !== contact.id;
    selectedIdRef.current = contact.id;
    setSelectedId(contact.id);
    setDraft(buildDraft(contact));
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
    void loadEmails(contact.id, contact.email, {
      resetConversation: shouldResetConversation,
    });
  };

  const applyContactUpdate = (updated: Contact) => {
    setContacts((prev) =>
      sortContacts(
        prev.map((contact) => (contact.id === updated.id ? updated : contact))
      )
    );
    if (selectedId === updated.id) {
      setDraft(buildDraft(updated));
    }
  };

  const markFollowUpRecontacted = async (contact: Contact) => {
    if (followUpActionByContact[contact.id]) return;
    setFollowUpMessage(null);
    setFollowUpActionByContact((prev) => ({
      ...prev,
      [contact.id]: "recontacted",
    }));

    const today = getTodayDateInputValue();
    const keepWarm = isKeepInTouchNote(contact.next_action_note);
    const automaticFollowUpStage = getAutomaticFollowUpStage(
      contact.next_action_note
    );
    const updatePayload: Record<string, unknown> = {
      last_action_at: today,
      last_action_note: keepWarm
        ? "Ricontattato (mantenimento attivo)"
        : automaticFollowUpStage === 1
          ? "Primo follow-up completato"
          : automaticFollowUpStage === 2
            ? "Secondo e ultimo follow-up completato"
            : "Ricontattato",
      next_action_at: keepWarm
        ? addMonthsToDateInputValue(today, KEEP_IN_TOUCH_MONTHS)
        : automaticFollowUpStage === 1
          ? addDaysToDateInputValue(today, SECOND_FOLLOW_UP_DAYS)
        : null,
      next_action_note: keepWarm
        ? KEEP_IN_TOUCH_NOTE
        : automaticFollowUpStage === 1
          ? buildAutomaticFollowUpNote(2)
          : null,
    };

    const response = await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...updatePayload,
        mark_followup_read: true,
      }),
    }).catch(() => null);

    if (!response) {
      setError("Impossibile aggiornare il follow-up. Il server non risponde.");
      setFollowUpActionByContact((prev) => {
        const next = { ...prev };
        delete next[contact.id];
        return next;
      });
      return;
    }

    if (!response.ok) {
      setError(
        await readApiError(response, "Impossibile aggiornare il follow-up.")
      );
      setFollowUpActionByContact((prev) => {
        const next = { ...prev };
        delete next[contact.id];
        return next;
      });
      return;
    }

    const payload = (await response.json()) as ContactsApiResponse;
    const updated = payload.contact as Contact;
    const sy = window.scrollY;
    applyContactUpdate(updated);
    requestAnimationFrame(() => window.scrollTo(0, sy));
    setFollowUpMessage(
      keepWarm
        ? `Ricontattato: prossimo promemoria tra ${KEEP_IN_TOUCH_MONTHS} mesi.`
        : automaticFollowUpStage === 1
          ? `Primo follow-up registrato: il secondo e ultimo tornera tra ${SECOND_FOLLOW_UP_DAYS} giorni.`
          : automaticFollowUpStage === 2
            ? "Secondo e ultimo follow-up registrato."
            : "Ricontattato registrato."
    );
    setFollowUpActionByContact((prev) => {
      const next = { ...prev };
      delete next[contact.id];
      return next;
    });
  };

  const enableKeepInTouch = async (contact: Contact) => {
    if (followUpActionByContact[contact.id]) return;
    setFollowUpMessage(null);
    setFollowUpActionByContact((prev) => ({ ...prev, [contact.id]: "keepwarm" }));

    const today = getTodayDateInputValue();

    const updatePayload: Record<string, unknown> = {
      status: "Mantenimento rapporto",
      last_action_at: today,
      last_action_note: `Mantenimento rapporto attivato`,
      next_action_at: null,
      next_action_note: null,
    };

    const response = await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...updatePayload,
        mark_followup_read: true,
      }),
    }).catch(() => null);

    if (!response) {
      setError(
        "Impossibile impostare il mantenimento contatto. Il server non risponde."
      );
      setFollowUpActionByContact((prev) => {
        const next = { ...prev };
        delete next[contact.id];
        return next;
      });
      return;
    }

    if (!response.ok) {
      setError(
        await readApiError(
          response,
          "Impossibile impostare il mantenimento contatto."
        )
      );
      setFollowUpActionByContact((prev) => {
        const next = { ...prev };
        delete next[contact.id];
        return next;
      });
      return;
    }

    const payload = (await response.json()) as ContactsApiResponse;
    const updated = payload.contact as Contact;
    const sy = window.scrollY;
    applyContactUpdate(updated);
    requestAnimationFrame(() => window.scrollTo(0, sy));
    setFollowUpMessage(
      `✓ Mantenimento rapporto attivato per ${contact.name ?? "contatto"}.`
    );
    setFollowUpActionByContact((prev) => {
      const next = { ...prev };
      delete next[contact.id];
      return next;
    });
  };

  const handleMaintainRapport = async (contact: Contact, days: number) => {
    if (maintainRapportPending) return;
    setMaintainRapportMessage(null);
    const pendingKey = days === 0 ? "now" : `schedule-${days}`;
    setMaintainRapportPending(pendingKey);

    try {
      if (days === 0) {
        // Invio immediato: costruisci email e invia via API
        const emailContent = buildMaintainRapportEmail(
          contact.name ?? "",
          undefined,
          contact.language ?? undefined,
          contact.role ?? undefined
        );

        // Trova l'ultima email per il threading (Re:)
        const lastEmail = emails
          .filter((e) => e.contact_id === contact.id)
          .sort((a, b) => (b.received_at ?? "").localeCompare(a.received_at ?? ""))[0];

        const sendPayload: Record<string, unknown> = {
          contactId: contact.id,
          to: contact.email,
          subject: emailContent.subject,
          text: emailContent.body,
          html: emailContent.html,
          emailAccountId: selectedEmailAccountId || undefined,
          notificationKind: "maintain",
        };
        if (lastEmail?.id) {
          sendPayload.replyToEmailId = lastEmail.id;
        }

        const sendRes = await fetch("/api/gmail/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sendPayload),
        });

        if (!sendRes.ok) {
          setError("Impossibile inviare l'email di mantenimento rapporto.");
          setMaintainRapportPending(null);
          return;
        }
        notifyCrmNotificationsUpdated();

        // Aggiorna contatto
        const today = getTodayDateInputValue();
        const patchRes = await fetch(`/api/contacts/${contact.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            last_action_at: today,
            last_action_note: "Mantenimento rapporto inviato",
            status: "Mantenimento rapporto",
          }),
        });

        if (patchRes.ok) {
          const payload = (await patchRes.json()) as ContactsApiResponse;
          applyContactUpdate(payload.contact as Contact);
        }

        setMaintainRapportMessage("✓ Email di mantenimento rapporto inviata!");
        if (contact.id && contact.email) {
          loadEmails(contact.id, contact.email, {
            background: true,
            syncGmail: false,
          });
        }
      } else {
        // Schedulazione: imposta next_action_at + note
        const today = getTodayDateInputValue();
        const scheduledDate = addDaysToDateInputValue(today, days);

        const patchRes = await fetch(`/api/contacts/${contact.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            next_action_at: scheduledDate,
            next_action_note: buildMaintainRapportNote(days),
            status: "Mantenimento rapporto",
          }),
        });

        if (!patchRes.ok) {
          setError("Impossibile programmare il mantenimento rapporto.");
          setMaintainRapportPending(null);
          return;
        }

        const payload = (await patchRes.json()) as ContactsApiResponse;
        applyContactUpdate(payload.contact as Contact);
        setDraft(payload.contact as Contact);
        setMaintainRapportMessage(`✓ Mantenimento rapporto programmato tra ${days} giorni.`);
      }
    } catch {
      setError("Errore durante il mantenimento rapporto.");
    }
    setMaintainRapportPending(null);
  };

  const handleSelectEmail = async (emailId: string) => {
    if (selectedEmailId === emailId) {
      setSelectedEmailId(null);
      return;
    }

    setSelectedEmailId(emailId);
    setEmailReadById((prev) => ({ ...prev, [emailId]: true }));
    const selectedRow = emails.find((email) => email.id === emailId);
    if (selectedRow?.direction !== "inbound") return;
    await fetch(`/api/emails/${emailId}/read`, {
      method: "POST",
    }).catch(() => null);
  };

  const selectedThreadKey = selectedEmail ? getEmailThreadKey(selectedEmail) : null;
  const renderSelectedEmailDetail = () => {
    if (!selectedEmail) return null;

    return (
      <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-3">
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
                ? toneStyles.inbound
                : toneStyles.outbound
            }`}
          >
            {selectedEmail.direction === "inbound" ? "Ricevuta" : "Inviata"}
          </span>
          <span className="break-all">
            {selectedEmail.direction === "inbound" ? "Da" : "A"}{" "}
            {selectedEmail.direction === "inbound"
              ? selectedEmail.from_email
              : getRecipientSummary(selectedEmail.to_email)}
          </span>
          <span>·</span>
          <span>
            {formatDateTime(
              selectedEmail.received_at ?? selectedEmail.created_at
            )}
          </span>
        </div>
        {selectedEmail.direction === "outbound" &&
          extractEmails(selectedEmail.to_email).length > 1 && (
            <details className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold text-[var(--muted)]">
                Mostra tutti i destinatari ({extractEmails(selectedEmail.to_email).length})
              </summary>
              <div className="mt-2 break-all text-xs text-[var(--muted)]">
                {extractEmails(selectedEmail.to_email).join(", ")}
              </div>
            </details>
          )}
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
                const downloadUrl = buildAttachmentDownloadUrl(
                  selectedEmail.id,
                  attachment.index,
                  false
                );
                return (
                  <div
                    key={`${attachment.filename}-${index}`}
                    className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2"
                  >
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 break-all text-sm font-semibold text-[var(--ink)]">
                        {attachment.filename}
                      </div>
                      <a
                        href={downloadUrl}
                        download
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-[var(--accent-strong)]"
                      >
                        Scarica
                      </a>
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
    );
  };

  const getReplyTarget = () => {
    if (selectedEmail?.direction === "inbound") return selectedEmail;
    if (selectedThreadKey) {
      return (
        emails
          .filter(
            (email) =>
              email.direction === "inbound" &&
              getEmailThreadKey(email) === selectedThreadKey
          )
          .sort((a, b) => getEmailTimestamp(b) - getEmailTimestamp(a))[0] || null
      );
    }
    return emails.find((email) => email.direction === "inbound") || null;
  };

  const handleComposePresetChange = (preset: ComposePreset) => {
    setEmailPreset(preset);
    if (preset === "custom") return;
    setEmailSubject(FIRST_FOLLOW_UP_SUBJECT);
    setEmailBody(
      preset === "first_follow_up_tu"
        ? buildFirstFollowUpBodyTu(selected?.name)
        : buildFirstFollowUpBodyLei(selected?.name)
    );
  };

  const handleSendEmail = async () => {
    if (!selected?.email?.trim()) {
      setEmailsError("Aggiungi un'email al contatto per poter rispondere.");
      return;
    }

    const replyTarget = getReplyTarget();
    const resolvedSubject = replyTarget
      ? buildReplySubject(replyTarget.subject, emailSubject)
      : emailSubject.trim();
    const resolvedBody = emailBody.trim();
    const looksLikeFollowUp = /follow[\s-]?up/i.test(
      `${resolvedSubject} ${resolvedBody}`
    );

    if (!resolvedSubject && !resolvedBody) {
      setEmailsError("Scrivi almeno un oggetto o un messaggio.");
      return;
    }

    setSendingEmail(true);
    setEmailsError(null);

    const response = await fetch("/api/gmail/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId: selected.id,
        to: selected.email.trim(),
        subject: resolvedSubject || undefined,
        text: resolvedBody || undefined,
        replyToEmailId: replyTarget?.id ?? undefined,
        emailAccountId: selectedEmailAccountId || undefined,
        notificationKind:
          emailPreset !== "custom" || looksLikeFollowUp
            ? "follow_up"
            : undefined,
      }),
    });

    if (!response.ok) {
      setEmailsError("Invio email fallito. Riprova.");
      setSendingEmail(false);
      return;
    }
    notifyCrmNotificationsUpdated();

    const responsePayload = (await response.json().catch(() => null)) as
      | { messageId?: string }
      | null;

    setEmailPreset("custom");
    setEmailSubject("");
    setEmailBody("");
    const refreshedEmails = await loadEmails(selected.id, selected.email, {
      syncGmail: false,
    });
    const sentEmail = responsePayload?.messageId
      ? refreshedEmails?.find(
          (email) => email.message_id_header === responsePayload.messageId
        )
      : null;
    if (sentEmail?.id) {
      setSelectedEmailId(sentEmail.id);
    }
    const refreshedContacts = await loadContacts({ silent: true });
    const refreshedSelected = refreshedContacts.find(
      (contact) => contact.id === selected.id
    );
    if (refreshedSelected) {
      setDraft(buildDraft(refreshedSelected));
    }
    setSendingEmail(false);
  };

  const loadScheduledEmails = async () => {
    try {
      const response = await fetch("/api/scheduled-emails");
      if (!response.ok) return;
      const data = await response.json();
      if (data?.items) setScheduledEmails(data.items);
    } catch {
      // silent
    }
  };

  const handleScheduleEmail = async () => {
    if (!selected?.email?.trim()) {
      setEmailsError("Aggiungi un'email al contatto per poter programmare.");
      return;
    }
    if (!scheduleSendDate) {
      setEmailsError("Seleziona una data di invio.");
      return;
    }

    const replyTarget = getReplyTarget();
    const resolvedSubject = replyTarget
      ? buildReplySubject(replyTarget.subject, emailSubject)
      : emailSubject.trim();
    const resolvedBody = emailBody.trim();

    if (!resolvedSubject && !resolvedBody) {
      setEmailsError("Scrivi almeno un oggetto o un messaggio.");
      return;
    }

    setSchedulingEmail(true);
    setEmailsError(null);

    const looksLikeFollowUp = /follow[\s-]?up/i.test(
      `${resolvedSubject} ${resolvedBody}`
    );

    const response = await fetch("/api/scheduled-emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId: selected.id,
        to: selected.email.trim(),
        subject: resolvedSubject || undefined,
        text: resolvedBody || undefined,
        replyToEmailId: replyTarget?.id ?? undefined,
        emailAccountId: selectedEmailAccountId || undefined,
        notificationKind:
          emailPreset !== "custom" || looksLikeFollowUp
            ? "follow_up"
            : undefined,
        sendAt: scheduleSendDate,
      }),
    });

    if (!response.ok) {
      setEmailsError("Programmazione fallita. Riprova.");
      setSchedulingEmail(false);
      return;
    }

    setEmailPreset("custom");
    setEmailSubject("");
    setEmailBody("");
    setScheduleSendDate("");
    await loadScheduledEmails();
    setSchedulingEmail(false);
  };

  const handleCancelScheduledEmail = async (id: string) => {
    await fetch(`/api/scheduled-emails/${id}`, { method: "DELETE" });
    await loadScheduledEmails();
  };

  const handleRefreshConversation = async () => {
    if (!selected || conversationRefreshing) return;
    await loadEmails(selected.id, selected.email, {
      resetConversation: true,
      syncAllEmailAccounts: !selectedEmailAccountId,
      forceSync: true,
    });
  };

  useEffect(() => {
    void loadContacts();
    void loadEmailAccounts();
    void loadScheduledEmails();
    const onContactsRefresh = () => {
      void loadContacts({ silent: true });
    };
    window.addEventListener("crm:contacts-refresh", onContactsRefresh);
    return () => {
      window.removeEventListener("crm:contacts-refresh", onContactsRefresh);
    };
  }, []);

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
    const selectedStatus = newContact.status;

    const response = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email: newContact.email.trim() || null,
        company: company || null,
        role: newContact.role.trim() || null,
        status: selectedStatus,
        last_action_at: null,
      }),
    }).catch(() => null);

    if (!response) {
      setError("Impossibile salvare. Il server non risponde.");
      setAdding(false);
      return;
    }

    if (!response.ok) {
      setError(await readApiError(response, "Impossibile salvare."));
      setAdding(false);
      return;
    }

    const payload = (await response.json()) as ContactsApiResponse;
    const created = payload.contact as Contact;
    setContacts((prev) => sortContacts([created, ...prev]));
    handleSelectContact(created);
    setNewContact(emptyNewContact);
    setAdding(false);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);

    const { id, ...updates } = draft;
    const previousEmailKey = extractEmails(
      contacts.find((contact) => contact.id === id)?.email
    ).join(",");
    const response = await fetch(`/api/contacts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
      }),
    }).catch(() => null);

    if (!response) {
      setError("Impossibile aggiornare. Il server non risponde.");
      setSaving(false);
      return;
    }

    if (!response.ok) {
      setError(await readApiError(response, "Impossibile aggiornare."));
      setSaving(false);
      return;
    }

    const payload = (await response.json()) as ContactsApiResponse;
    const updated = payload.contact as Contact;
    setContacts((prev) =>
      sortContacts(
        prev.map((contact) => (contact.id === id ? updated : contact))
      )
    );
    setDraft(buildDraft(updated));
    setSaving(false);

    const updatedEmailKey = extractEmails(updated.email).join(",");
    if (updatedEmailKey && updatedEmailKey !== previousEmailKey) {
      void refreshContactEmailHistory(updated.id, updated.email);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    setDeleting(true);
    setError(null);

    const response = await fetch(`/api/contacts/${selected.id}`, {
      method: "DELETE",
    }).catch(() => null);

    if (!response) {
      setError("Impossibile eliminare. Il server non risponde.");
      setDeleting(false);
      return;
    }

    if (!response.ok) {
      setError(await readApiError(response, "Impossibile eliminare."));
      setDeleting(false);
      return;
    }

    setContacts((prev) => prev.filter((contact) => contact.id !== selected.id));
    selectedIdRef.current = null;
    setSelectedId(null);
    setDraft(null);
    setEmails([]);
    setSelectedEmailId(null);
    setDeleting(false);
  };

  const renderContactDetails = (contactId: string) => {
    if (!selected || !draft || selected.id !== contactId) return null;
    const remindersDisabled =
      draft.status === "Non interessato" ||
      draft.status === "Collaborazione stabilita";
    const scheduledCountdown = getScheduledCountdown(
      draft.next_action_at,
      draft.next_action_note,
      countdownNow
    );
    const autoCountdown =
      scheduledCountdown?.kind === "auto" ? scheduledCountdown : null;
    const maintainCountdown =
      scheduledCountdown?.kind === "maintain" ? scheduledCountdown : null;

    return (
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-strong)] p-4 shadow-sm">
        <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] bg-[var(--panel-strong)] px-4 pt-4 pb-3">
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
          {draft.status === "Non interessato" && (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm font-semibold uppercase tracking-[0.08em] shadow-sm ${toneStyles.warning}`}
            >
              Non interessato · non rimanere in contatto
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
                <option value="Regista con agente">Regista con agente</option>
                <option value="Regista e Produzione">
                  Regista e Produzione
                </option>
              </select>
            </div>
          </div>

          <div className="grid gap-3">
            <div className="grid gap-6">
              {/* Gruppo: In attesa di risposta */}
              <div className="rounded-3xl border-2 border-indigo-200 bg-indigo-50/30 p-4 dark:border-indigo-900/30 dark:bg-indigo-950/10">
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-2 w-2 rounded-full bg-indigo-500" />
                  <label className="text-[11px] font-black uppercase tracking-[0.15em] text-indigo-700 dark:text-indigo-500">
                    In attesa di risposta
                  </label>
                </div>
                <div className="grid gap-2">
                  {STATUS_GROUPS["In attesa di risposta"].map((status) => {
                    const isActive = draft.status === status;
                    const isAutoFollowUp = status === "Attiva auto follow-up";
                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={async () => {
                          const scrollY = window.scrollY;
                          setShowMaintainWorkflow(false);
                          setDraft((prev) => {
                            if (!prev) return prev;
                            return { ...prev, status: status as Status };
                          });
                          requestAnimationFrame(() => window.scrollTo(0, scrollY));
                          if (draft?.id) {
                            const res = await fetch(`/api/contacts/${draft.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ status }),
                            });
                            if (res.ok) {
                              const payload = (await res.json()) as ContactsApiResponse;
                              const sy = window.scrollY;
                              applyContactUpdate(payload.contact as Contact);
                              requestAnimationFrame(() => window.scrollTo(0, sy));
                            }
                          }
                        }}
                        className={`w-full rounded-xl border px-4 py-2 text-left text-xs font-bold ${
                          isActive
                            ? "border-indigo-600 bg-indigo-600 text-white shadow-sm scale-[1.02]"
                            : "border-indigo-300 bg-indigo-50 text-indigo-800 hover:bg-indigo-100 dark:text-indigo-400"
                        }${isAutoFollowUp && isActive ? " auto-follow-pulse" : " transition-all"}`}
                      >
                        ↳ {getStatusLabel(status)}
                      </button>
                    );
                  })}
                </div>
                {autoCountdown && (
                  <p className="mt-3 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                    Countdown follow-up: {autoCountdown.label}
                  </p>
                )}
              </div>

              {/* Gruppo: Risposta ricevuta */}
              <div className="rounded-3xl border-2 border-amber-200 bg-amber-50/30 p-4 dark:border-amber-900/30 dark:bg-amber-950/10">
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-2 w-2 rounded-full bg-amber-500" />
                  <label className="text-[11px] font-black uppercase tracking-[0.15em] text-amber-700 dark:text-amber-500">
                    Risposta Ricevuta
                  </label>
                </div>
                
                <div className="grid gap-2">
                  <div className="grid grid-cols-1 gap-2">
                    <div className="mt-1 grid gap-2 border-t border-amber-200/50 dark:border-amber-900/30 pt-3">
                      <p className="px-1 text-[9px] font-bold uppercase text-amber-600/70 dark:text-amber-500/50 mb-1">Specifica esito:</p>
                      {STATUS_GROUPS["Risposta ricevuta"]
                        .map((status) => {
                        const isMaintainToggle = status === "Mantenimento rapporto";
                        const isActive = isMaintainToggle
                          ? draft.status === status || showMaintainWorkflow
                          : draft.status === status;
                        const baseStyles = statusStylesByTheme[theme][status as Status];

                        return (
                          <div key={status} className="grid gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                const scrollY = window.scrollY;
                                if (status === "Mantenimento rapporto") {
                                  setShowMaintainWorkflow(true);
                                  requestAnimationFrame(() => window.scrollTo(0, scrollY));
                                  return;
                                }

                                setShowMaintainWorkflow(false);
                                const shouldClearNextAction =
                                  status === "Non interessato" ||
                                  status === "Collaborazione stabilita";
                                setDraft((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        status: status as Status,
                                        ...(shouldClearNextAction
                                          ? { next_action_at: "", next_action_note: "" }
                                          : {}),
                                      }
                                    : prev
                                );
                                requestAnimationFrame(() => window.scrollTo(0, scrollY));
                                if (draft?.id) {
                                  const res = await fetch(`/api/contacts/${draft.id}`, {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      status,
                                      ...(shouldClearNextAction
                                        ? { next_action_at: null, next_action_note: null }
                                        : {}),
                                    }),
                                  });
                                  if (res.ok) {
                                    const payload = (await res.json()) as ContactsApiResponse;
                                    const sy = window.scrollY;
                                    applyContactUpdate(payload.contact as Contact);
                                    requestAnimationFrame(() => window.scrollTo(0, sy));
                                  }
                                }
                              }}
                              className={`rounded-xl border px-4 py-2 text-left text-xs font-bold transition-all ${baseStyles} ${
                                isActive
                                  ? "shadow-md scale-[1.02] ring-1 ring-current"
                                  : "hover:scale-[1.01]"
                              }${
                                status === "Mantenimento rapporto" && isActive
                                  ? " maintain-rapport-pulse"
                                  : ""
                              }`}
                            >
                              ↳ {getStatusLabel(status)}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Mantenimento rapporto */}
            {selected &&
              selected.email &&
              (draft.status === "Mantenimento rapporto" || showMaintainWorkflow) && (
              <div className="rounded-3xl border-2 border-teal-200 bg-teal-50/30 p-4 dark:border-teal-900/30 dark:bg-teal-950/10">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-2 w-2 rounded-full bg-teal-500" />
                  <label className="text-[11px] font-black uppercase tracking-[0.15em] text-teal-700 dark:text-teal-500">
                    Mantenimento rapporto
                  </label>
                  {isMaintainRapportNote(draft.next_action_note) && (
                    <span className="rounded bg-teal-600 px-1.5 py-0.5 text-[9px] font-bold text-white maintain-rapport-pulse">
                      PROGRAMMATO
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!!maintainRapportPending}
                    onClick={() => handleMaintainRapport(selected, 0)}
                    className="rounded-full border border-teal-500 bg-teal-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
                  >
                    {maintainRapportPending === "now" ? "Invio..." : "Invia ora"}
                  </button>
                  {[10, 30, 60].map((days) => (
                    <button
                      key={days}
                      type="button"
                      disabled={!!maintainRapportPending}
                      onClick={() => handleMaintainRapport(selected, days)}
                      className="rounded-full border border-teal-400 bg-teal-50/50 px-3 py-1.5 text-[10px] font-bold text-teal-700 transition hover:bg-teal-100 dark:bg-teal-950/20 dark:text-teal-400 dark:hover:bg-teal-950/40 disabled:opacity-60"
                    >
                      {maintainRapportPending === `schedule-${days}` ? "Programmo..." : `${days}g`}
                    </button>
                  ))}
                </div>
                {maintainCountdown && (
                  <p className="mt-3 text-[11px] font-semibold text-teal-700 dark:text-teal-300">
                    Countdown mantenimento: {maintainCountdown.label}
                  </p>
                )}
                {maintainRapportMessage && (
                  <p className="mt-2 text-[11px] font-semibold text-teal-700 dark:text-teal-400">
                    {maintainRapportMessage}
                  </p>
                )}
              </div>
            )}

            {/* Ricontatto programmato */}
            {selected &&
              (draft.status === "Mantenimento rapporto" || showMaintainWorkflow) && (
              <div className="rounded-3xl border-2 border-orange-200 bg-orange-50/30 p-4 dark:border-orange-900/30 dark:bg-orange-950/10">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-2 w-2 rounded-full bg-orange-500" />
                  <label className="text-[11px] font-black uppercase tracking-[0.15em] text-orange-700 dark:text-orange-500">
                    Ricontatto programmato
                  </label>
                  {isManualRecontactNote(draft.next_action_note) && (
                    <span className="rounded bg-orange-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
                      IMPOSTATO
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {[7, 15, 30, 60].map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={async () => {
                        const today = getTodayDateInputValue();
                        const scheduledDate = addDaysToDateInputValue(today, days);
                        setDraft((prev) =>
                          prev
                            ? { ...prev, next_action_at: scheduledDate, next_action_note: buildManualRecontactNote(days) }
                            : prev
                        );
                        if (selected?.id) {
                          const res = await fetch(`/api/contacts/${selected.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              next_action_at: scheduledDate,
                              next_action_note: buildManualRecontactNote(days),
                            }),
                          });
                          if (res.ok) {
                            const payload = (await res.json()) as ContactsApiResponse;
                            applyContactUpdate(payload.contact as Contact);
                          }
                        }
                      }}
                      className="rounded-full border border-orange-400 bg-orange-50/50 px-3 py-1.5 text-[10px] font-bold text-orange-700 transition hover:bg-orange-100 dark:bg-orange-950/20 dark:text-orange-400 dark:hover:bg-orange-950/40"
                    >
                      {days}g
                    </button>
                  ))}
                </div>
                {isManualRecontactNote(draft.next_action_note) && draft.next_action_at && (
                  <p className="mt-2 text-[11px] font-semibold text-orange-700 dark:text-orange-400">
                    ✓ Ricontatto fissato per il {new Date(draft.next_action_at + "T00:00:00").toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                )}
              </div>
            )}

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
                disabled={remindersDisabled}
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
              <div className="flex items-center gap-2">
                <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                  Nota prossima azione
                </label>
                {(draft.next_action_note === AUTO_FOLLOW_UP_1_NOTE || draft.next_action_note === AUTO_FOLLOW_UP_2_NOTE) && (
                  <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[9px] font-bold text-white auto-follow-pulse">
                    AUTOMATICO
                  </span>
                )}
              </div>
              <input
                value={draft.next_action_note ?? ""}
                disabled={remindersDisabled}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? { ...prev, next_action_note: event.target.value }
                      : prev
                  )
                }
                placeholder="Rimanere in contatto tra 7 giorni"
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
              className={deleteButtonClass}
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
            onClick={handleRefreshConversation}
            disabled={conversationRefreshing}
            className="rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {conversationRefreshing ? "Sync..." : "Sync mail"}
          </button>
        </div>

        <div className="grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                Caselle email
              </div>
              <div className="text-xs font-semibold text-[var(--ink)]">
                Sync da: {activeEmailAccountLabel}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowEmailAccountForm((prev) => !prev);
                setEmailAccountMessage(null);
                setEmailAccountsError(null);
              }}
              className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-semibold text-[var(--muted)]"
            >
              {showEmailAccountForm ? "Chiudi" : "Aggiungi casella"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              className="max-w-sm text-xs"
              value={selectedEmailAccountId}
              disabled={emailAccountsLoading}
              onChange={(event) => setSelectedEmailAccountId(event.target.value)}
            >
              <option value="">
                {emailAccounts.length > 0 ? "Tutte le caselle" : "Gmail attuale"}
              </option>
              {emailAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.display_name || account.email} · {account.provider}
                </option>
              ))}
            </select>
            {emailAccountsLoading && (
              <span className="text-xs text-[var(--muted)]">Carico...</span>
            )}
          </div>

          {showEmailAccountForm && (
            <div className="grid gap-3 border-t border-[var(--line)] pt-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <select
                  value={emailAccountDraft.provider}
                  onChange={(event) =>
                    handleEmailProviderChange(event.target.value as EmailProvider)
                  }
                >
                  <option value="gmail">Gmail</option>
                  <option value="outlook">Outlook</option>
                  <option value="imap">Altra mail IMAP</option>
                </select>
                <input
                  type="email"
                  placeholder="Email"
                  value={emailAccountDraft.email}
                  onChange={(event) =>
                    setEmailAccountDraft((prev) => ({
                      ...prev,
                      email: event.target.value,
                    }))
                  }
                />
                <input
                  placeholder="Username se diverso"
                  value={emailAccountDraft.username}
                  onChange={(event) =>
                    setEmailAccountDraft((prev) => ({
                      ...prev,
                      username: event.target.value,
                    }))
                  }
                />
              </div>
              <input
                type="password"
                placeholder="Password o app password"
                value={emailAccountDraft.password}
                onChange={(event) =>
                  setEmailAccountDraft((prev) => ({
                    ...prev,
                    password: event.target.value,
                  }))
                }
              />
              {emailAccountDraft.provider === "imap" && (
                <div className="grid gap-2 sm:grid-cols-[1fr_120px_1fr]">
                  <input
                    placeholder="Host IMAP"
                    value={emailAccountDraft.imapHost}
                    onChange={(event) =>
                      setEmailAccountDraft((prev) => ({
                        ...prev,
                        imapHost: event.target.value,
                      }))
                    }
                  />
                  <input
                    inputMode="numeric"
                    placeholder="Porta"
                    value={emailAccountDraft.imapPort}
                    onChange={(event) =>
                      setEmailAccountDraft((prev) => ({
                        ...prev,
                        imapPort: event.target.value,
                      }))
                    }
                  />
                  <input
                    placeholder="Mailbox opzionale"
                    value={emailAccountDraft.mailbox}
                    onChange={(event) =>
                      setEmailAccountDraft((prev) => ({
                        ...prev,
                        mailbox: event.target.value,
                      }))
                    }
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestEmailAccount}
                  disabled={emailAccountTesting || emailAccountSaving}
                  className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)] disabled:opacity-60"
                >
                  {emailAccountTesting ? "Test..." : "Test connessione"}
                </button>
                <button
                  type="button"
                  onClick={handleSaveEmailAccount}
                  disabled={emailAccountSaving || emailAccountTesting}
                  className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {emailAccountSaving ? "Salvo..." : "Salva account"}
                </button>
              </div>
            </div>
          )}

          {(emailAccountsError || emailAccountMessage) && (
            <div
              className={`rounded-xl border px-3 py-2 text-xs ${
                emailAccountsError ? toneStyles.error : toneStyles.success
              }`}
            >
              {emailAccountsError || emailAccountMessage}
            </div>
          )}
        </div>

        {emailsLoading && emails.length === 0 && (
          <div className="rounded-xl border border-dashed border-[var(--line)] p-3 text-sm text-[var(--muted)]">
            Caricamento email...
          </div>
        )}

        {!emailsLoading && emails.length === 0 && (
          <div className="rounded-xl border border-dashed border-[var(--line)] p-3 text-sm text-[var(--muted)]">
            Nessuna email per questo contatto.
          </div>
        )}

        <div className="grid gap-3">
          {visibleEmails.map((email) => {
            const isSelected = email.id === selectedEmailId;
            const address =
              email.direction === "inbound"
                ? email.from_email
                : getRecipientSummary(email.to_email);
            const preview = getEmailExcerpt(email);
            const isRead = emailReadById[email.id] ?? true;
            const directionLabel =
              email.direction === "inbound" ? "Ricevuta" : "Inviata";
            const directionStyle =
              email.direction === "inbound"
                ? toneStyles.inbound
                : toneStyles.outbound;

            return (
              <div key={email.id} className="grid gap-2">
                <button
                  type="button"
                  onClick={() => handleSelectEmail(email.id)}
                  className={`perf-card rounded-2xl border px-4 py-3 text-left transition ${
                    isSelected
                      ? "border-[var(--accent)] bg-[var(--panel-strong)]"
                      : isRead
                        ? "border-[var(--line)] bg-[var(--panel)]"
                        : "border-[var(--accent)] bg-[var(--panel-strong)]"
                  }`}
                >
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]">
                    <span className="flex min-w-0 items-center gap-2">
                      {!isRead && (
                        <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                      )}
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${directionStyle}`}
                      >
                        {directionLabel}
                      </span>
                      <span className="min-w-0 break-all">
                        {email.direction === "inbound" ? "Da" : "A"}{" "}
                        {address || "—"}
                      </span>
                    </span>
                    <span>{formatDateTime(email.received_at ?? email.created_at)}</span>
                  </div>
                  <div
                    className={`mt-2 break-words text-sm text-[var(--ink)] ${
                      isRead ? "font-semibold" : "font-bold"
                    }`}
                  >
                    {email.subject || "Senza oggetto"}
                  </div>
                  <div className="mt-1 break-words text-xs text-[var(--muted)]">
                    {preview.length > 220 ? `${preview.slice(0, 220)}…` : preview}
                  </div>
                </button>
                {isSelected && selectedEmail?.id === email.id && renderSelectedEmailDetail()}
              </div>
            );
          })}
        </div>

        <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3">
          <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            Rispondi
          </div>
          <div className="mt-2 text-xs text-[var(--muted)]">
            A: {selected.email || "—"}
          </div>
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
            Template Email
          </div>
          <select
            className="mt-2 w-full"
            value={emailPreset}
            onChange={(event) =>
              handleComposePresetChange(event.target.value as ComposePreset)
            }
          >
            <option value="custom">Nessun template</option>
            <option value="first_follow_up_tu">
              Primo follow-up · tu
            </option>
            <option value="first_follow_up_lei">
              Primo follow-up · lei
            </option>
          </select>
          {emailPreset !== "custom" && (
            <div
              className={`mt-2 rounded-xl border px-3 py-2 text-xs ${toneStyles.warning}`}
            >
              Template primo follow-up caricato (
              {emailPreset === "first_follow_up_tu" ? "tu" : "lei"}).
              {getReplyTarget()
                ? " L'oggetto resta quello del thread per non aprire una mail nuova."
                : ` Oggetto preset: ${FIRST_FOLLOW_UP_SUBJECT}.`}
            </div>
          )}
          <input
            className="mt-3 w-full"
            placeholder="Oggetto"
            value={
              getReplyTarget()
                ? buildReplySubject(getReplyTarget()?.subject, emailSubject)
                : emailSubject
            }
            onChange={(event) => setEmailSubject(event.target.value)}
            readOnly={Boolean(getReplyTarget())}
          />
          <textarea
            className="mt-3 w-full"
            rows={4}
            placeholder="Scrivi il messaggio..."
            value={emailBody}
            onChange={(event) => setEmailBody(event.target.value)}
          />
          {emailsError && (
            <div
              className={`mt-3 rounded-xl border px-3 py-2 text-xs ${toneStyles.error}`}
            >
              {emailsError}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSendEmail}
              disabled={sendingEmail || schedulingEmail}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
            >
              {sendingEmail ? "Invio..." : "Invia email"}
            </button>
            <div className="flex items-center gap-2">
              <input
                type="date"
                className="rounded-lg border px-2 py-1.5 text-sm"
                value={scheduleSendDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setScheduleSendDate(event.target.value)}
              />
              <button
                type="button"
                onClick={handleScheduleEmail}
                disabled={schedulingEmail || sendingEmail || !scheduleSendDate}
                className="rounded-full border border-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)] hover:text-white disabled:opacity-60"
              >
                {schedulingEmail ? "Programmo..." : "Programma"}
              </button>
            </div>
            {getReplyTarget() && (
              <span className="text-xs text-[var(--muted)]">
                Risposta collegata al thread esistente.
              </span>
            )}
          </div>
          {scheduledEmails.filter((se) => se.contact_id === selected?.id).length > 0 && (
            <div className="mt-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                Email programmate
              </div>
              <div className="mt-2 space-y-2">
                {scheduledEmails
                  .filter((se) => se.contact_id === selected?.id)
                  .map((se) => (
                    <div
                      key={se.id}
                      className="flex items-center justify-between rounded-xl border px-3 py-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">
                          {se.subject || "(senza oggetto)"}
                        </span>
                        <span className="ml-2 text-[var(--muted)]">
                          {new Date(se.send_at + "T00:00:00").toLocaleDateString(
                            "it-IT",
                            { day: "numeric", month: "short", year: "numeric" }
                          )}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCancelScheduledEmail(se.id)}
                        className="ml-3 shrink-0 text-red-500 hover:text-red-700"
                      >
                        Annulla
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="relative flex min-h-screen flex-col px-6 pb-16 pt-6 sm:px-10">
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
        </div>
        {error && (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${toneStyles.error}`}
          >
            {error}
          </div>
        )}
        <div className="flex flex-wrap gap-6">
          {/* Gruppo Header: In attesa di risposta */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-indigo-200/50 bg-indigo-50/20 p-2 dark:border-indigo-900/30 dark:bg-indigo-950/10">
            <div className="flex items-center gap-2 px-2 py-1 text-[11px] font-black uppercase tracking-[0.15em] text-indigo-700 dark:text-indigo-400">
              <span>In attesa di risposta</span>
              <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                {counts["In attesa di risposta"] ?? 0}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {STATUS_GROUPS["In attesa di risposta"].map((status) => (
                <div
                  key={status}
                  className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusStyles[status]}${
                    status === "Attiva auto follow-up" ? " auto-follow-pulse" : ""
                  }`}
                >
                  <span>{getStatusLabel(status)}</span>
                  <span className="bg-[var(--panel-strong)]/40 px-1.5 py-0.5 rounded-full text-[9px]">
                    {counts[status] ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Gruppo Header: Risposta ricevuta */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200/50 bg-amber-50/20 p-2 dark:border-amber-900/30 dark:bg-amber-950/10">
            <div className="flex items-center gap-2 px-2 py-1 text-[11px] font-black uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400">
              <span>Risposta ricevuta</span>
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                {counts["Risposta ricevuta"] ?? 0}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {STATUS_GROUPS["Risposta ricevuta"].map((status) => (
                <div
                  key={status}
                  className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusStyles[status]}${
                    status === "Mantenimento rapporto" ? " maintain-rapport-pulse" : ""
                  }`}
                >
                  <span>{getStatusLabel(status)}</span>
                  <span className="bg-[var(--panel-strong)]/40 px-1.5 py-0.5 rounded-full text-[9px]">
                    {counts[status] ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </header>

      <main className="relative mx-auto grid w-full max-w-7xl flex-1 items-start gap-6 md:grid-cols-[minmax(280px,320px)_minmax(0,1fr)] lg:gap-8 lg:grid-cols-[340px_minmax(0,1fr)]">
        <section
          style={
            desktopSidebarHeight
              ? { height: `${desktopSidebarHeight}px` }
              : undefined
          }
          className="min-w-0 rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-lg md:overflow-y-auto md:pr-3"
        >
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
              <option value="Regista con agente">Regista con agente</option>
              <option value="Regista e Produzione">Regista e Produzione</option>
            </select>
            <select
              value={newContact.status}
              onChange={(event) =>
                setNewContact((prev) => ({
                  ...prev,
                  status: event.target.value as NewContactStatus,
                }))
              }
            >
              {NEW_CONTACT_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {getStatusLabel(status)}
                </option>
              ))}
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
            <div
              className={`mt-3 rounded-2xl border px-4 py-2 text-xs ${toneStyles.error}`}
            >
              {addError}
            </div>
          )}

          <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                Follow-up
              </h3>
              <span className="rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted)]">
                {followUpSummary.totalOpen}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
              <span
                className={`rounded-full border px-2 py-0.5 font-semibold ${toneStyles.danger}`}
              >
                In ritardo: {followUpSummary.overdue.length}
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 font-semibold ${toneStyles.warning}`}
              >
                Oggi: {followUpSummary.dueToday.length}
              </span>
            </div>
            <p className="mt-3 text-xs text-[var(--muted)]">
              Data aggiornata automaticamente (di default 10 giorni dopo la prima
              email inviata).
            </p>
            {followUpMessage && (
              <div
                className={`mt-3 rounded-xl border px-3 py-2 text-xs ${toneStyles.success}`}
              >
                {followUpMessage}
              </div>
            )}
            {followUpSummary.totalOpen === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-[var(--line)] p-3 text-xs text-[var(--muted)]">
                Nessun follow-up urgente.
              </div>
            ) : (
              <div className="mt-3 grid gap-2">
                {[
                  ...followUpSummary.overdue.map((contact) => ({
                    contact,
                    label: "In ritardo",
                    tone: toneStyles.danger,
                  })),
                  ...followUpSummary.dueToday.map((contact) => ({
                    contact,
                    label: "Oggi",
                    tone: toneStyles.warning,
                  })),
                ]
                  .slice(0, 8)
                  .map(({ contact, label, tone }) => {
                    const pending = followUpActionByContact[contact.id];
                    const keepWarm = isKeepInTouchNote(contact.next_action_note);
                    const sendStatus = getFollowUpSendStatus(
                      contact,
                      countdownNow
                    );
                    return (
                      <div
                        key={`${label}-${contact.id}`}
                        className={`rounded-xl border px-3 py-2 ${
                          selectedId === contact.id
                            ? "border-[var(--accent)] bg-[var(--panel-strong)]"
                            : "border-[var(--line)] bg-[var(--panel)]"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectContact(contact)}
                          className="flex w-full items-center justify-between gap-3 text-left"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-[var(--ink)]">
                              {getDisplayName(contact)}
                            </div>
                            <div className="text-xs text-[var(--muted)]">
                              {formatDate(contact.next_action_at)}
                            </div>
                            <div
                              className={`mt-1 text-[11px] font-semibold ${
                                sendStatus.sent
                                  ? "text-emerald-600 dark:text-emerald-300"
                                  : "text-amber-700 dark:text-amber-300"
                              }`}
                            >
                              {sendStatus.label}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {keepWarm && (
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${toneStyles.keepInTouch}`}
                              >
                                ogni 2 mesi
                              </span>
                            )}
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                sendStatus.sent ? toneStyles.success : tone
                              }`}
                            >
                              {sendStatus.sent ? "Inviato" : label}
                            </span>
                          </div>
                        </button>

                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => markFollowUpRecontacted(contact)}
                            disabled={Boolean(pending)}
                            className="rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 px-2 py-1 text-[11px] font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/20 disabled:opacity-60"
                          >
                            {pending === "recontacted"
                              ? "Salvo..."
                              : "Ricontattato"}
                          </button>
                          <button
                            type="button"
                            onClick={() => enableKeepInTouch(contact)}
                            disabled={Boolean(pending)}
                            className={keepInTouchButtonClass}
                          >
                            {pending === "keepwarm"
                              ? "Imposto..."
                              : "Mantenere in contatto"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          <div className="mt-8">
            <div className="sticky -top-5 z-30 -mx-5 mb-4 border-b border-[var(--line)] bg-[var(--panel)] px-5 pt-9 pb-4 rounded-t-3xl">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              <span>Contatti</span>
              <span>
                {contactSearch.trim() || contactFolder !== "Tutte"
                  ? `${filteredContacts.length} / ${contacts.length}`
                  : contacts.length}
              </span>
            </div>

            <div className="mt-4 flex flex-col gap-5">
              {/* Filtro Tutte */}
              <button
                type="button"
                onClick={() => setContactFolder("Tutte")}
                className={`flex w-full items-center justify-between rounded-xl border px-4 py-2.5 text-xs font-bold uppercase tracking-[0.15em] transition ${
                  contactFolder === "Tutte"
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "border-[var(--line)] bg-[var(--panel-strong)] text-[var(--muted)] hover:border-[var(--muted)]/30"
                }`}
              >
                <span>Tutte le schede</span>
                <span className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-bold text-[var(--accent)]">
                  {contacts.length}
                </span>
              </button>

              {/* Gruppo: In attesa di risposta */}
              <div className="grid gap-2">
                <button
                  onClick={() => setContactFolder("In attesa di risposta")}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.2em] transition ${
                    contactFolder === "In attesa di risposta"
                      ? "border-sky-500/50 bg-sky-500/10 text-sky-400"
                      : "border-[var(--line)] bg-[var(--panel-strong)] text-[var(--muted)] hover:border-[var(--muted)]/30"
                  }`}
                >
                  <span>In attesa di risposta</span>
                  <span className="rounded-full bg-sky-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                    {counts["In attesa di risposta"] ?? 0}
                  </span>
                </button>
                <div className="ml-2 grid gap-1.5 border-l-2 border-sky-500/20 pl-3">
                  {STATUS_GROUPS["In attesa di risposta"].map((status) => {
                    const isAutoFollowUp = status === "Attiva auto follow-up";
                    const isSelected = contactFolder === status;
                    return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setContactFolder(status)}
                      className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-semibold ${
                        isAutoFollowUp ? "auto-follow-pulse " : "transition "
                      }${
                        isSelected
                          ? statusStyles[status]
                          : "text-[var(--muted)] hover:bg-[var(--panel-strong)] hover:text-[var(--ink)]"
                      }`}
                    >
                      <span>{getStatusLabel(status)}</span>
                      <span className="bg-[var(--panel-strong)] px-1.5 py-0.5 rounded-full text-[9px] font-bold">
                        {counts[status] ?? 0}
                      </span>
                    </button>
                    );
                  })}
                </div>
              </div>

              {/* Gruppo: Risposta ricevuta */}
              <div className="grid gap-2">
                <button
                  onClick={() => setContactFolder("Risposta ricevuta")}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.2em] transition ${
                    contactFolder === "Risposta ricevuta"
                      ? "border-amber-500/50 bg-amber-500/10 text-amber-500"
                      : "border-[var(--line)] bg-[var(--panel-strong)] text-[var(--muted)] hover:border-[var(--muted)]/30"
                  }`}
                >
                  <span>Risposta ricevuta</span>
                  <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                    {counts["Risposta ricevuta"] ?? 0}
                  </span>
                </button>
                <div className="ml-2 grid gap-1.5 border-l-2 border-amber-500/20 pl-3">
                  {STATUS_GROUPS["Risposta ricevuta"].map((status) => {
                    const isMaintainRapport = status === "Mantenimento rapporto";
                    return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setContactFolder(status)}
                      className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${
                        contactFolder === status
                          ? statusStyles[status]
                          : "text-[var(--muted)] hover:bg-[var(--panel-strong)] hover:text-[var(--ink)]"
                      }${isMaintainRapport ? " maintain-rapport-pulse" : ""}`}
                    >
                      <span>{getStatusLabel(status)}</span>
                      <span className="bg-[var(--panel-strong)] px-1.5 py-0.5 rounded-full text-[9px] font-bold">
                        {counts[status] ?? 0}
                      </span>
                    </button>
                    );
                  })}
                </div>
              </div>

            </div>

            <div className="mt-3">
              <input
                placeholder="Cerca contatto (nome, email, produzione...)"
                value={contactSearch}
                onChange={(event) => setContactSearch(event.target.value)}
              />
            </div>
            </div>

            <div className="mt-4 grid gap-3">
              {loading && (
                <div className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
                  Caricamento...
                </div>
              )}
              {!loading && !error && contacts.length === 0 && (
                <div className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
                  Nessun contatto ancora. Aggiungi il primo.
                </div>
              )}
              {!loading &&
                !error &&
                contacts.length > 0 &&
                filteredContacts.length === 0 && (
                <div className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
                  Nessun risultato per “{contactSearch.trim()}”.
                </div>
              )}
            {!loading &&
                filteredContacts.length > 0 &&
                filteredContacts.map((contact) => {
                  const isSelected = contact.id === selectedId;
                  return (
                    <div key={contact.id} className="grid gap-3">
                      <button
                        onClick={() => handleSelectContact(contact)}
                        className={`perf-card flex w-full flex-col gap-3 overflow-hidden rounded-2xl border px-4 py-3 text-left transition hover:-translate-y-1 hover:shadow-[0_18px_40px_-30px_rgba(15,23,42,0.5)] ${
                          isSelected
                            ? "border-[var(--accent)] bg-[var(--panel-strong)]"
                            : "border-[var(--line)] bg-[var(--panel)]"
                        }`}
                      >
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)]/10 text-sm font-semibold text-[var(--accent)]">
                              {getInitials(getDisplayName(contact))}
                            </div>
                            <div className="min-w-0">
                              <div className="flex min-w-0 items-center gap-1">
                                <span className="truncate text-sm font-semibold">
                                  {getDisplayName(contact)}
                                </span>
                                {getLanguageFlag(contact.language) && (
                                  <span
                                    className="shrink-0 text-sm"
                                    title={contact.language === "it" ? "Italiano" : "English"}
                                    aria-label={contact.language === "it" ? "Italiano" : "English"}
                                  >
                                    {getLanguageFlag(contact.language)}
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-xs text-[var(--muted)]">
                                {[contact.role, contact.company]
                                  .filter(Boolean)
                                  .join(" · ") || "—"}
                              </div>
                            </div>
                          </div>
                          <span
                            className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold ${statusStyles[contact.status]}${contact.status === "Attiva auto follow-up" ? " auto-follow-pulse" : ""}${contact.status === "Mantenimento rapporto" ? " maintain-rapport-pulse" : ""}`}
                          >
                            {getStatusLabel(contact.status)}
                          </span>
                        </div>
                        <div className="break-words text-xs text-[var(--muted)]">
                          {contact.status === "Non interessato" ? (
                            <>Non interessato · non rimanere in contatto</>
                          ) : !contact.last_action_at ? (
                            <>Prossima azione: Impostare Auto follow-up</>
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
          </div>
        </section>

        <section
          ref={contentSectionRef}
          className="min-w-0 rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-6 shadow-lg"
        >
          <div className="flex min-w-0 items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                {selected ? "Dettagli" : "Seleziona"}
              </p>
              <div className="flex items-center gap-2">
                <h2 className="break-words text-2xl font-semibold">
                  {selected ? getDisplayName(selected) : "Contatto"}
                </h2>
                {selected && getLanguageFlag(selected.language) && (
                  <span
                    className="shrink-0 text-xl"
                    title={selected.language === "it" ? "Italiano" : "English"}
                    aria-label={selected.language === "it" ? "Italiano" : "English"}
                  >
                    {getLanguageFlag(selected.language)}
                  </span>
                )}
              </div>
            </div>
            {selected && (
              <div
                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${statusStyles[selected.status]}${
                  selected.status === "Attiva auto follow-up"
                    ? " auto-follow-pulse"
                    : ""
                }${
                  selected.status === "Mantenimento rapporto"
                    ? " maintain-rapport-pulse"
                    : ""
                }`}
              >
                {getStatusLabel(selected.status)}
              </div>
            )}
          </div>

          {!selected && (
            <div className="mt-10 rounded-2xl border border-dashed border-[var(--line)] p-6 text-sm text-[var(--muted)]">
              Seleziona un contatto per vedere i dettagli.
            </div>
          )}

          {selected && (
            <div className="mt-6 grid gap-6 pb-10">
              {renderContactDetails(selected.id)}
              {renderConversation()}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
