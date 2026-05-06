/**
 * Sends 3 test emails (FU1, FU2, Mantenimento Rapporto) for the live_music
 * section to a recipient. Used to manually verify the live music email
 * templates render correctly.
 *
 * Uso: npx tsx scripts/test-live-followups.ts [recipient]
 *      npx tsx scripts/test-live-followups.ts pietromontanticomposer@gmail.com
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import {
  buildAutoFollowUpEmail1,
  buildAutoFollowUpEmail2,
  buildMaintainRapportEmail,
} from "../src/lib/followUp";
import {
  buildOutboundAttachments,
  buildOutboundHtml,
} from "../src/lib/outboundEmail";

const env = dotenv.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8")
);

const GMAIL_USER = env.GMAIL_USER;
const GMAIL_APP_PASSWORD = env.GMAIL_APP_PASSWORD;
if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  throw new Error("Missing GMAIL_USER or GMAIL_APP_PASSWORD in .env.local");
}

const recipient = process.argv[2] || "pietromontanticomposer@gmail.com";
const TEST_NAME = "Mario Rossi";
const TEST_LANGUAGE = "it" as const;
const TEST_ROLE = "Regista";
const TEST_SECTION = "live_music" as const;

const transport = nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

type Builder = (
  name: string,
  signatureHtml?: string | null,
  language?: "it" | "en" | null,
  role?: string | null,
  section?: "cinema" | "live_music" | string | null
) => { subject: string; body: string; html: string };

const send = async (label: string, builder: Builder) => {
  const content = builder(TEST_NAME, undefined, TEST_LANGUAGE, TEST_ROLE, TEST_SECTION);
  const subject = `[TEST LIVE — ${label}] ${content.subject}`;
  const htmlBody = buildOutboundHtml(content.html, content.body);
  const attachments = buildOutboundAttachments(htmlBody);

  console.log(`\n=== ${label} ===`);
  console.log(`Subject: ${subject}`);
  console.log(`Body:\n${content.body}`);

  const info = await transport.sendMail({
    from: GMAIL_USER,
    to: recipient,
    subject,
    text: content.body,
    html: htmlBody,
    attachments,
  });
  console.log(`✓ sent: ${info.messageId}`);
};

const main = async () => {
  console.log(`Sending 3 LIVE-section test emails to ${recipient}`);
  await send("FU1", buildAutoFollowUpEmail1);
  await send("FU2", buildAutoFollowUpEmail2);
  await send("Mantenimento", buildMaintainRapportEmail);
  console.log(`\nAll 3 emails sent. Check ${recipient}.`);
};

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
