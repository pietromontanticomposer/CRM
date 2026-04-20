import fs from "node:fs";
import path from "path";

import { DEFAULT_SIGNATURE_HTML } from "@/lib/followUp";

const DEFAULT_CV_PATH =
  "/Users/pietromontanti/Desktop/Curriculum Pietro Montanti.pdf";
const PUBLIC_CV_PATH = path.join(process.cwd(), "public", "curriculum-pietro-montanti.pdf");
const CV_NOTICE_MARKER = 'data-cv-notice="true"';
const CV_NOTICE_HTML = `<div ${CV_NOTICE_MARKER} style="margin-top: 16px; font-family: Helvetica, Arial, sans-serif; color: #111; font-size: 14px; line-height: 1.4;">In allegato trovi il mio Curriculum Vitae (PDF).</div>`;

type OutboundAttachment = {
  filename: string;
  path: string;
  cid?: string;
  contentType?: string;
};

const normalizeText = (value?: string | null) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const addCvNoticeAboveSignature = (html: string) => {
  if (html.includes(CV_NOTICE_MARKER)) return html;

  if (html.includes(DEFAULT_SIGNATURE_HTML)) {
    return html.replace(DEFAULT_SIGNATURE_HTML, `${CV_NOTICE_HTML}${DEFAULT_SIGNATURE_HTML}`);
  }

  const signatureImageRegex = /<img\b[^>]*\bsrc=["']cid:firma_pietro["'][^>]*>/i;
  if (signatureImageRegex.test(html)) {
    return html.replace(signatureImageRegex, `${CV_NOTICE_HTML}$&`);
  }

  return `${html}${CV_NOTICE_HTML}${DEFAULT_SIGNATURE_HTML}`;
};

const getCvPath = () => {
  const candidates = [
    normalizeText(process.env.EMAIL_CV_PATH),
    PUBLIC_CV_PATH,
    DEFAULT_CV_PATH,
  ].filter((value): value is string => Boolean(value));

  return candidates.find((cvPath) => fs.existsSync(cvPath)) ?? null;
};

export const buildOutboundHtml = (html?: string | null, text?: string | null) => {
  const cleanedHtml = normalizeText(html);
  const shouldMentionCv = Boolean(getCvPath());
  if (cleanedHtml) {
    return shouldMentionCv ? addCvNoticeAboveSignature(cleanedHtml) : cleanedHtml;
  }

  const cleanedText = normalizeText(text);
  if (!cleanedText) return undefined;

  const htmlBody = `<div>${escapeHtml(cleanedText).replaceAll(/\r?\n/g, "<br>")}</div>`;
  return shouldMentionCv ? addCvNoticeAboveSignature(htmlBody) : htmlBody;
};

export const buildOutboundAttachments = (html?: string | null) => {
  const attachments: OutboundAttachment[] = [];
  const cvPath = getCvPath();

  if (cvPath) {
    attachments.push({
      filename: "Curriculum Pietro Montanti.pdf",
      path: cvPath,
      contentType: "application/pdf",
    });
  }

  if (normalizeText(html)?.includes("cid:firma_pietro")) {
    attachments.unshift({
      filename: "firma_pietro.png",
      path: path.join(process.cwd(), "public", "firma_pietro.png"),
      cid: "firma_pietro",
    });
  }

  return attachments;
};
