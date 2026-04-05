import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";

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

  const defaultSignature = `
<div style="font-family: Helvetica, Arial, sans-serif; color: #444; line-height: 1.5; margin-top: 25px; border-top: 1px solid #eee; padding-top: 20px;">
  <table border="0" cellpadding="0" cellspacing="0">
    <tr>
      <td style="vertical-align: top; padding-right: 20px;">
        <img src="https://crm-next-pietro.vercel.app/firma_pietro.png" alt="Pietro Montanti" width="100" style="border-radius: 4px; display: block;">
      </td>
      <td style="vertical-align: top; border-left: 1px solid #ddd; padding-left: 20px;">
        <div style="font-weight: bold; font-size: 16px; color: #111;">Pietro Montanti</div>
        <div style="font-size: 14px; color: #666;">Composer for TV & Theatre</div>
        <div style="margin-top: 8px; font-size: 13px;">
          <span style="color: #888;">m:</span> <a href="tel:3515172560" style="color: #444; text-decoration: none;">351 517 2560</a><br>
          <span style="color: #888;">p.iva:</span> 04593080239<br>
          <span style="color: #888;">a:</span> Via Mulino Turri 9c, Negrar (VR)
        </div>
      </td>
    </tr>
  </table>
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

  const signatureHtml = process.env.EMAIL_SIGNATURE_HTML || null;
  const emailContent = buildAutoFollowUpEmail1("Pietro Montanti", signatureHtml);

  const info = await transport.sendMail({
    from: process.env.GMAIL_USER,
    to: testEmail,
    subject: "TEST FIRMA: " + emailContent.subject,
    text: emailContent.body,
    html: emailContent.html,
  });

  console.log(`Mail inviata! ID: ${info.messageId}`);
}

sendTest().catch(console.error);
