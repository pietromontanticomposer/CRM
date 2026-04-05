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
} from "@/lib/followUp";

const STATUS_OPTIONS = [
  "Auto follow-up impostato",
  "In attesa",
  "Risposta ricevuta",
  "Non interessato",
  "Rimanere in contatto",
  "Call prenotata",
] as const;

type Status = (typeof STATUS_OPTIONS)[number];

const STATUS_GROUPS = {
  "In attesa di risposta": ["Auto follow-up impostato", "In attesa"],
  "Risposta ricevuta": ["Non interessato", "Rimanere in contatto", "Call prenotata"],
} as const;

type MacroStatus = keyof typeof STATUS_GROUPS;
type ContactFolder = "Tutte" | Status | MacroStatus;

const NEW_CONTACT_STATUS_OPTIONS = ["Auto follow-up impostato", "In attesa"] as const;
type NewContactStatus = (typeof NEW_CONTACT_STATUS_OPTIONS)[number];

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
  status: "Auto follow-up impostato",
};

const statusStylesByTheme: Record<CrmTheme, Record<Status, string>> = {
  dark: {
    "Auto follow-up impostato": "bg-indigo-500/15 text-indigo-200 border-indigo-400/30",
    "In attesa": "bg-sky-500/15 text-sky-200 border-sky-400/30",
    "Risposta ricevuta": "bg-amber-500/15 text-amber-200 border-amber-400/30",
    "Non interessato": "bg-rose-500/15 text-rose-200 border-rose-400/30",
    "Rimanere in contatto": "bg-orange-500/15 text-orange-200 border-orange-400/30",
    "Call prenotata": "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
  },
  light: {
    "Auto follow-up impostato": "border-indigo-300 bg-indigo-50 text-indigo-800",
    "In attesa": "border-sky-300 bg-sky-50 text-sky-800",
    "Risposta ricevuta": "border-amber-300 bg-amber-50 text-amber-800",
    "Non interessato": "border-rose-300 bg-rose-50 text-rose-800",
    "Rimanere in contatto": "border-orange-300 bg-orange-50 text-orange-800",
    "Call prenotata": "border-emerald-300 bg-emerald-50 text-emerald-800",
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
    success: "border-emerald-300 bg-emerald-50 text-emerald-800",
    danger: "border-rose-300 bg-rose-50 text-rose-800",
    inbound: "border-emerald-300 bg-emerald-50 text-emerald-800",
    outbound: "border-amber-300 bg-amber-50 text-amber-800",
    keepInTouch: "border-cyan-300 bg-cyan-50 text-cyan-800",
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
  `Rimanere in contatto tra ${days} giorni`;

const toDateKey = (value?: string | null) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const isOpenFollowUpContact = (contact: Contact, today: string) => {
  if (contact.status === "Non interessato") {
    return false;
  }
  const nextActionDate = toDateKey(contact.next_action_at);
  if (!nextActionDate) return false;
  return nextActionDate <= today;
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
const DEFAULT_FIRST_FOLLOW_UP_DAYS = 10;

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

const getContactActivityTimestamp = (contact: Contact) =>
  Math.max(
    getTimestamp(contact.activity_at ?? null),
    getTimestamp(contact.last_inbound_email_at ?? null),
    getTimestamp(contact.updated_at),
    getTimestamp(contact.created_at)
  );

const sortContacts = (contacts: Contact[]) =>
  [...contacts].sort((a, b) => {
    const activityDiff =
      getContactActivityTimestamp(b) - getContactActivityTimestamp(a);
    if (activityDiff !== 0) return activityDiff;
    return getTimestamp(b.created_at) - getTimestamp(a.created_at);
  });

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
  const [emailReadById, setEmailReadById] = useState<Record<string, boolean>>(
    {}
  );
  const [summary, setSummary] = useState<SummaryState | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [emailPreset, setEmailPreset] = useState<ComposePreset>("custom");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
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
  const [desktopSidebarHeight, setDesktopSidebarHeight] = useState<
    number | null
  >(null);
  const contentSectionRef = useRef<HTMLElement | null>(null);
  const emailRequestIdRef = useRef(0);
  const summaryRequestIdRef = useRef(0);
  const statusStyles = statusStylesByTheme[theme];
  const toneStyles = toneStylesByTheme[theme];
  const deleteButtonClass =
    theme === "light"
      ? "rounded-full border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 transition hover:border-red-400 hover:bg-red-50 disabled:opacity-60"
      : "rounded-full border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-200 transition hover:border-red-400/70 hover:bg-red-500/10 disabled:opacity-60";
  const keepInTouchButtonClass =
    theme === "light"
      ? "rounded-full border border-cyan-300 bg-cyan-50 px-2 py-1 text-[11px] font-semibold text-cyan-800 transition hover:bg-cyan-100 disabled:opacity-60"
      : "rounded-full border border-cyan-400/40 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-500/20 disabled:opacity-60";

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
    if (
      !selectedId ||
      !contentSectionRef.current ||
      window.innerWidth >= TWO_COLUMN_LAYOUT_MIN_WIDTH
    ) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      contentSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [selectedId]);

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
          await loadEmails(selected.id, selected.email, { background: true });
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
      if (contact.status === "Non interessato") {
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

  const summaryMeta = useMemo(() => {
    if (!visibleEmails.length) return null;
    const lastActivity =
      visibleEmails[0]?.received_at ?? visibleEmails[0]?.created_at ?? null;
    const unreadCount = visibleEmails.reduce((acc, email) => {
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
      threadCount: new Set(visibleEmails.map((email) => getEmailThreadKey(email)))
        .size,
    };
  }, [visibleEmails, emailReadById]);

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
    const nextContacts = sortContacts(payload.contacts || []);
    setContacts(nextContacts);
    if (!silent) {
      setLoading(false);
    }
    return nextContacts;
  };

  const loadEmails = async (
    contactId: string | null,
    email?: string | null,
    options?: { resetConversation?: boolean; background?: boolean }
  ) => {
    const resetConversation = options?.resetConversation ?? false;
    const background = options?.background ?? false;
    if (!contactId) {
      emailRequestIdRef.current += 1;
      summaryRequestIdRef.current += 1;
      setEmails([]);
      setSelectedEmailId(null);
      setEmailReadById({});
      setEmailsLoading(false);
      setEmailsError(null);
      setSummary(null);
      setSummaryLoading(false);
      setSummaryError(null);
      return [] as EmailRow[];
    }

    const requestId = emailRequestIdRef.current + 1;
    emailRequestIdRef.current = requestId;

    if (resetConversation) {
      summaryRequestIdRef.current += 1;
      setEmails([]);
      setSelectedEmailId(null);
      setEmailReadById({});
      setSummary(null);
      setSummaryLoading(false);
      setSummaryError(null);
    }

    if (!background) {
      setEmailsLoading(true);
      setEmailsError(null);
    }
    const query = new URLSearchParams();
    if (email?.trim()) {
      query.set("email", email);
    }

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
    return uniqueRows;
  };

  const runBackfillForContact = async (
    contactId: string,
    email?: string | null
  ) => {
    const emailList = extractEmails(email);
    if (!emailList.length) return;
    if (backfillByContact[contactId] === "pending") return;

    setBackfillByContact((prev) => ({ ...prev, [contactId]: "pending" }));
    try {
      let beforeUid: number | null = null;
      let batchCount = 0;

      while (batchCount < 20) {
        const response = await fetch("/api/gmail/backfill-contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            emails: emailList,
            contactId,
            limit: 400,
            beforeUid,
          }),
        });
        if (!response.ok) return;

        const payload = (await response.json()) as {
          nextCursor?: number | null;
        };
        const nextCursor =
          typeof payload?.nextCursor === "number" && payload.nextCursor > 0
            ? payload.nextCursor
            : null;

        batchCount += 1;
        if (!nextCursor) {
          break;
        }
        beforeUid = nextCursor;
      }
    } catch (error) {
      console.error(error);
    } finally {
      setBackfillByContact((prev) => {
        const next = { ...prev };
        delete next[contactId];
        return next;
      });
    }
  };

  const refreshSummary = async (contactId: string, force = false) => {
    const requestId = summaryRequestIdRef.current + 1;
    summaryRequestIdRef.current = requestId;
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
        if (summaryRequestIdRef.current !== requestId) return;
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

      if (summaryRequestIdRef.current !== requestId) return;
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
      if (summaryRequestIdRef.current !== requestId) return;
      setSummaryError("Impossibile generare il riassunto. Riprova.");
      setSummaryLoading(false);
    }
  };

  const handleSelectContact = (contact: Contact) => {
    const shouldResetConversation = selectedId !== contact.id;
    setSelectedId(contact.id);
    setDraft(buildDraft(contact));
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
          ? buildAutomaticFollowUpNote(2, DEFAULT_FIRST_FOLLOW_UP_DAYS)
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
    applyContactUpdate(updated);
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
    const nextFollowUp = addMonthsToDateInputValue(today, KEEP_IN_TOUCH_MONTHS);

    const updatePayload: Record<string, unknown> = {
      status: contact.status,
      last_action_at: today,
      last_action_note: `Mantenimento attivo (ogni ${KEEP_IN_TOUCH_MONTHS} mesi)`,
      next_action_at: nextFollowUp,
      next_action_note: KEEP_IN_TOUCH_NOTE,
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
    applyContactUpdate(updated);
    setFollowUpMessage(
      `Mantenimento attivo: reminder ogni ${KEEP_IN_TOUCH_MONTHS} mesi.`
    );
    setFollowUpActionByContact((prev) => {
      const next = { ...prev };
      delete next[contact.id];
      return next;
    });
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
      }),
    });

    if (!response.ok) {
      setEmailsError("Invio email fallito. Riprova.");
      setSendingEmail(false);
      return;
    }

    const responsePayload = (await response.json().catch(() => null)) as
      | { messageId?: string }
      | null;

    setEmailPreset("custom");
    setEmailSubject("");
    setEmailBody("");
    const refreshedEmails = await loadEmails(selected.id, selected.email);
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

  const handleSyncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage(null);

    let totalProcessed = 0;
    let loopCount = 0;
    let hasMore = false;
    const maxSyncPasses = 100;

    while (loopCount < maxSyncPasses) {
      const response = await fetch("/api/gmail/sync-now", { method: "POST" });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setSyncMessage(payload?.error || "Sync fallita. Riprova.");
        setSyncing(false);
        return;
      }

      if (typeof payload?.processed === "number") {
        totalProcessed += payload.processed;
      }

      hasMore = Boolean(payload?.has_more);
      loopCount += 1;

      if (!hasMore) {
        break;
      }
    }

    setLastSyncAt(new Date());
    setSyncMessage(
      hasMore
        ? `Sync parziale: importate ${totalProcessed} mail, ci sono ancora arretrati da recuperare.`
        : totalProcessed > 0
          ? `Sync completata (${totalProcessed} nuove).`
          : "Sync completata (nessuna nuova)."
    );
    const refreshedContacts = await loadContacts({ silent: true });
    const refreshedSelected = selected
      ? refreshedContacts.find((contact) => contact.id === selected.id)
      : null;
    if (refreshedSelected) {
      setDraft(buildDraft(refreshedSelected));
    }
    if (selected) {
      await runBackfillForContact(
        selected.id,
        refreshedSelected?.email ?? selected.email
      );
      await loadEmails(selected.id, refreshedSelected?.email ?? selected.email);
    }
    setSyncing(false);
  };

  const handleRefreshConversation = async () => {
    if (!selected || conversationRefreshing) return;
    await runBackfillForContact(selected.id, selected.email);
    await loadEmails(selected.id, selected.email);
  };

  useEffect(() => {
    loadContacts();
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
    setSelectedId(null);
    setDraft(null);
    setEmails([]);
    setSelectedEmailId(null);
    setDeleting(false);
  };

  const renderContactDetails = (contactId: string) => {
    if (!selected || !draft || selected.id !== contactId) return null;
    const remindersDisabled =
      draft.status === "Non interessato";

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
                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setDraft((prev) => {
                          if (!prev) return prev;
                          return { ...prev, status: status as Status };
                        })}
                        className={`w-full rounded-xl border px-4 py-2 text-left text-xs font-bold transition-all ${
                          isActive
                            ? "border-indigo-600 bg-indigo-600 text-white shadow-sm scale-[1.02]"
                            : "border-indigo-200 bg-[var(--panel)] text-indigo-700 hover:bg-indigo-50 dark:text-indigo-400 opacity-60 hover:opacity-100"
                        }`}
                      >
                        ↳ {status}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Gruppo: Risposta ricevuta */}
              <div className="rounded-3xl border-2 border-amber-200 bg-amber-50/30 p-4 dark:border-amber-900/30 dark:bg-amber-950/10">
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                  <label className="text-[11px] font-black uppercase tracking-[0.15em] text-amber-700 dark:text-amber-500">
                    Risposta Ricevuta
                  </label>
                </div>
                
                <div className="grid gap-2">
                  <div className="grid grid-cols-1 gap-2">
                    {/* Pulsante generico Risposta Ricevuta */}
                    <button
                      type="button"
                      onClick={() => setDraft((prev) => {
                        if (!prev) return prev;
                        return { ...prev, status: "Risposta ricevuta" };
                      })}
                      className={`w-full rounded-xl border px-4 py-2 text-left text-xs font-bold transition mb-1 ${
                        draft.status === "Risposta ricevuta"
                          ? "border-amber-600 bg-amber-600 text-white shadow-sm scale-[1.02]"
                          : "border-amber-200 bg-[var(--panel)] text-amber-700 hover:bg-amber-50 dark:text-amber-400 opacity-60 hover:opacity-100"
                      }`}
                    >
                      ✓ Risposta ricevuta (generico)
                    </button>

                    <div className="mt-1 grid gap-2 border-t border-amber-200/50 dark:border-amber-900/30 pt-3">
                      <p className="px-1 text-[9px] font-bold uppercase text-amber-600/70 dark:text-amber-500/50 mb-1">Specifica esito:</p>
                      {STATUS_GROUPS["Risposta ricevuta"].map((status) => {
                        const isActive = draft.status === status;
                        const baseStyles = statusStylesByTheme[theme][status as Status];

                        return (
                          <div key={status} className="grid gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setDraft((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        status: status as Status,
                                        ...(status === "Non interessato" ? { next_action_at: "", next_action_note: "" } : {}),
                                      }
                                    : prev
                                )
                              }
                              className={`rounded-xl border px-4 py-2 text-left text-xs font-bold transition-all ${baseStyles} ${
                                isActive
                                  ? "shadow-md scale-[1.02] ring-1 ring-current"
                                  : "opacity-40 hover:opacity-100 hover:scale-[1.01]"
                              }`}
                            >
                              ↳ {status}
                            </button>

                            {status === "Rimanere in contatto" && isActive && (
                              <div className="flex flex-wrap items-center gap-3 pl-4 py-1 animate-in fade-in slide-in-from-top-1 duration-200">
                                <div className="flex flex-wrap gap-2">
                                  {QUICK_RECONTACT_DAYS.map((days) => (
                                    <button
                                      key={days}
                                      type="button"
                                      onClick={() => {
                                        const today = getTodayDateInputValue();
                                        setDraft((prev) =>
                                          prev
                                            ? {
                                                ...prev,
                                                next_action_at: addDaysToDateInputValue(
                                                  today,
                                                  days
                                                ),
                                                next_action_note:
                                                  buildRecontactReminderNote(days),
                                              }
                                            : prev
                                        );
                                      }}
                                      className="rounded-full border border-orange-400 bg-orange-50/50 px-3 py-1 text-[10px] font-bold text-orange-700 transition hover:bg-orange-100 dark:bg-orange-950/20 dark:text-orange-400 dark:hover:bg-orange-950/40"
                                    >
                                      {days}g
                                    </button>
                                  ))}
                                </div>

                                <div className="h-4 w-px bg-amber-200 dark:bg-amber-900/50" />

                                <div className="flex flex-wrap gap-2">
                                      {(() => {
                                       const isAutoFollowUpActive = draft.next_action_note === AUTO_FOLLOW_UP_1_NOTE || 
                                                                    draft.next_action_note === AUTO_FOLLOW_UP_2_NOTE;
                                       return (
                                         <button
                                           type="button"
                                           disabled={remindersDisabled}
                                           onClick={() => {
                                             const today = getTodayDateInputValue();
                                             setDraft((prev) => {
                                               if (!prev) return prev;
                                               if (isAutoFollowUpActive) {
                                                 return {
                                                   ...prev,
                                                   status: prev.status === "Auto follow-up impostato" ? "Risposta ricevuta" : prev.status,
                                                   next_action_at: "",
                                                   next_action_note: "",
                                                 };
                                               }
                                               return {
                                                 ...prev,
                                                 status: "Auto follow-up impostato",
                                                 next_action_at: addDaysToDateInputValue(today, 10),
                                                 next_action_note: AUTO_FOLLOW_UP_1_NOTE,
                                               };
                                             });
                                           }}
                                           className={`rounded-full border px-3 py-1 text-[10px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                                             isAutoFollowUpActive
                                               ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                                               : "border-indigo-500 text-indigo-600 hover:bg-indigo-50"
                                           }`}
                                         >
                                           {isAutoFollowUpActive ? "✓ Auto Follow-up Attivo" : "Auto Follow-up (10g + 20g)"}
                                         </button>
                                       );
                                     })()}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
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
                  <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[9px] font-bold text-white animate-pulse">
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
            className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-semibold text-[var(--muted)] disabled:opacity-60"
          >
            {conversationRefreshing ? "Aggiorno..." : "Aggiorna"}
          </button>
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
              <div
                className={`mt-3 rounded-xl border px-3 py-2 text-xs ${toneStyles.error}`}
              >
                {summaryError}
              </div>
            )}

            {!summary && !summaryLoading && !summaryError && (
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
                      <div
                        className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${toneStyles.warning}`}
                      >
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
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] dark:bg-indigo-900/50">
                {counts["In attesa di risposta"] ?? 0}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {STATUS_GROUPS["In attesa di risposta"].map((status) => (
                <div
                  key={status}
                  className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusStyles[status]}`}
                >
                  <span>{status}</span>
                  <span className="opacity-60">{counts[status] ?? 0}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Gruppo Header: Risposta ricevuta */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200/50 bg-amber-50/20 p-2 dark:border-amber-900/30 dark:bg-amber-950/10">
            <div className="flex items-center gap-2 px-2 py-1 text-[11px] font-black uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400">
              <span>Risposta ricevuta</span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] dark:bg-amber-900/50">
                {counts["Risposta ricevuta"] ?? 0}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <div
                className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusStyles["Risposta ricevuta"]}`}
              >
                <span>Generico</span>
                <span className="opacity-60">{counts["Risposta ricevuta"] ?? 0}</span>
              </div>
              {STATUS_GROUPS["Risposta ricevuta"].map((status) => (
                <div
                  key={status}
                  className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusStyles[status]}`}
                >
                  <span>{status}</span>
                  <span className="opacity-60">{counts[status] ?? 0}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="relative mx-auto grid w-full max-w-7xl flex-1 gap-6 md:grid-cols-[minmax(280px,320px)_minmax(0,1fr)] lg:gap-8 lg:grid-cols-[340px_minmax(0,1fr)]">
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
                  {status}
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
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone}`}
                            >
                              {label}
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
            <div className="sticky top-0 z-30 -mx-5 mb-4 border-b border-[var(--line)] bg-[var(--panel)] px-5 pt-4 pb-4">
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
                <span className="rounded-full bg-[var(--panel)] px-2 py-0.5 text-[10px] opacity-80">
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
                  <span className="rounded-full bg-[var(--panel)] px-2 py-0.5 text-[10px] opacity-80">
                    {counts["In attesa di risposta"] ?? 0}
                  </span>
                </button>
                <div className="ml-2 grid gap-1.5 border-l-2 border-sky-500/20 pl-3">
                  {STATUS_GROUPS["In attesa di risposta"].map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setContactFolder(status)}
                      className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${
                        contactFolder === status
                          ? statusStyles[status]
                          : "text-[var(--muted)] hover:bg-[var(--panel-strong)] hover:text-[var(--ink)]"
                      }`}
                    >
                      <span>{status}</span>
                      <span className="text-[10px] opacity-60">{counts[status] ?? 0}</span>
                    </button>
                  ))}
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
                  <span className="rounded-full bg-[var(--panel)] px-2 py-0.5 text-[10px] opacity-80">
                    {counts["Risposta ricevuta"] ?? 0}
                  </span>
                </button>
                <div className="ml-2 grid gap-1.5 border-l-2 border-amber-500/20 pl-3">
                  {STATUS_GROUPS["Risposta ricevuta"].map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setContactFolder(status)}
                      className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${
                        contactFolder === status
                          ? statusStyles[status]
                          : "text-[var(--muted)] hover:bg-[var(--panel-strong)] hover:text-[var(--ink)]"
                      }`}
                    >
                      <span>{status}</span>
                      <span className="text-[10px] opacity-60">{counts[status] ?? 0}</span>
                    </button>
                  ))}
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
                              <div className="truncate text-sm font-semibold">
                                {getDisplayName(contact)}
                              </div>
                              <div className="truncate text-xs text-[var(--muted)]">
                                {[contact.role, contact.company]
                                  .filter(Boolean)
                                  .join(" · ") || "—"}
                              </div>
                            </div>
                          </div>
                          <span
                            className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold ${statusStyles[contact.status]}`}
                          >
                            {contact.status}
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
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                {selected ? "Dettagli" : "Seleziona"}
              </p>
              <h2 className="break-words text-2xl font-semibold">
                {selected ? getDisplayName(selected) : "Contatto"}
              </h2>
            </div>
            {selected && (
              <div className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${statusStyles[selected.status]}`}>
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
