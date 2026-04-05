import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const testEmail = "pietromontanticomposer@gmail.com";

const extractFirstName = (fullName) => {
  if (!fullName) return "";
  const firstPart = fullName.trim().split(/\s+/)[0];
  return firstPart.charAt(0).toUpperCase() + firstPart.slice(1).toLowerCase();
};

const buildAutoFollowUpEmail1 = (name, signatureHtml) => {
  const firstName = extractFirstName(name);
  const text = `Ciao ${firstName}!,
ti scrivo per riprendere velocemente la mia ultima mail.
Se può avere senso sentirci, io sono disponibile lunedì o martedì prossimo alle 16.
Fammi sapere cosa ti è più comodo.
A presto,
Pietro`;

  // Use cid:firma_pietro for the local test to be 100% sure it shows
  const defaultSignature = `
<div style="margin-top: 25px; font-family: Helvetica, Arial, sans-serif; color: #111; line-height: 1.4;">
  <div style="font-weight: bold; font-size: 16px;">Pietro Montanti</div>
  <div style="font-size: 14px;">Multi Instrumentalist, Composer for TV & Theatre</div>
  <div style="font-size: 14px;">3515172560</div>
  <div style="font-size: 14px;">P.IVA: 04593080239</div>
  <div style="font-size: 14px;">Via Mulino Turri 9c, Negrar (VR)</div>
  <div style="margin-top: 20px;">
    <img src="cid:firma_pietro" alt="Pietro Montanti" width="450" style="display: block; max-width: 100%; height: auto;">
  </div>
</div>`;

  const finalSignature = signatureHtml || defaultSignature;

  const html = `<div>Ciao ${firstName}!,<br><br>
ti scrivo per riprendere velocemente la mia ultima mail.<br>
Se può avere senso sentirci, io sono disponibile lunedì o martedì prossimo alle 16.<br>
Fammi sapere cosa ti è più comodo.<br><br>
A presto,<br>
Pietro${finalSignature}</div>`;

  return {
    subject: "Il tuo lavoro",
    body: text,
    html: html,
  };
};

async function sendTest() {
  console.log(`Inviando mail di prova a ${testEmail}...`);

  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  const emailContent = buildAutoFollowUpEmail1("Pietro Montanti", null);

  const info = await transport.sendMail({
    from: process.env.GMAIL_USER,
    to: testEmail,
    subject: "TEST FINALE FIRMA: " + emailContent.subject,
    text: emailContent.body,
    html: emailContent.html,
    attachments: [{
      filename: 'firma_pietro.png',
      path: path.join(__dirname, '..', 'public', 'firma_pietro.png'),
      cid: 'firma_pietro'
    }]
  });

  console.log(`Mail inviata! ID: ${info.messageId}`);
}

sendTest().catch(console.error);
