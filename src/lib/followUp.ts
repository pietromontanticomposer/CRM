import type { SupabaseClient } from "@supabase/supabase-js";

export const KEEP_IN_TOUCH_MONTHS = 2;
export const KEEP_IN_TOUCH_NOTE = `Mantenere in contatto (automatico ogni ${KEEP_IN_TOUCH_MONTHS} mesi)`;

export const SECOND_FOLLOW_UP_DAYS = 20; // Modified from 30 to 20 as requested
export const LEGACY_AUTOMATIC_FOLLOW_UP_NOTE = "Follow-up automatico (10 giorni)";
export const FOLLOW_UP_TIME_ZONE = "Europe/Rome";

export const AUTO_FOLLOW_UP_1_NOTE = "Follow-up automatico 1/2 (10 giorni)";
export const AUTO_FOLLOW_UP_2_NOTE = `Follow-up automatico 2/2 (${SECOND_FOLLOW_UP_DAYS} giorni dal primo)`;

export const MANUAL_RECONTACT_NOTE_PREFIX = "Ricontatto programmato";
export const buildManualRecontactNote = (days: number) =>
  `${MANUAL_RECONTACT_NOTE_PREFIX} (${days} giorni)`;
export const isManualRecontactNote = (value?: string | null) =>
  !!value?.trim().startsWith(MANUAL_RECONTACT_NOTE_PREFIX);

export const MAINTAIN_RAPPORT_NOTE_PREFIX = "Mantenimento rapporto";
export const buildMaintainRapportNote = (days: number) =>
  days === 0
    ? `${MAINTAIN_RAPPORT_NOTE_PREFIX} (inviato)`
    : `${MAINTAIN_RAPPORT_NOTE_PREFIX} (${days} giorni)`;

export const isMaintainRapportNote = (value?: string | null) =>
  !!value?.trim().startsWith(MAINTAIN_RAPPORT_NOTE_PREFIX);

export const getMaintainRapportDays = (value?: string | null): number | null => {
  if (!value || !isMaintainRapportNote(value)) return null;
  const match = value.match(/\((\d+)\s*giorni\)/);
  return match ? Number(match[1]) : null;
};

export type AutomaticFollowUpStage = 1 | 2;

const followUpDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: FOLLOW_UP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const toFollowUpDateOnly = (date: Date) => {
  const parts = followUpDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    return date.toISOString().slice(0, 10);
  }
  return `${year}-${month}-${day}`;
};

export const isKeepInTouchNote = (value?: string | null) =>
  value?.trim() === KEEP_IN_TOUCH_NOTE;

export const getAutomaticFollowUpStage = (
  value?: string | null
): AutomaticFollowUpStage | null => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === LEGACY_AUTOMATIC_FOLLOW_UP_NOTE.toLowerCase()) return 1;
  if (normalized === AUTO_FOLLOW_UP_1_NOTE.toLowerCase()) return 1;
  if (normalized === AUTO_FOLLOW_UP_2_NOTE.toLowerCase()) return 2;
  if (normalized.startsWith("follow-up automatico 2/2")) return 2;
  if (normalized.startsWith("follow-up automatico 1/2")) return 1;
  if (normalized.startsWith("follow-up automatico")) return 1;
  return null;
};

export const buildAutomaticFollowUpNote = (
  stage: AutomaticFollowUpStage
) => {
  if (stage === 1) {
    return AUTO_FOLLOW_UP_1_NOTE;
  }
  return AUTO_FOLLOW_UP_2_NOTE;
};

export const extractFirstName = (fullName: string) => {
  if (!fullName) return "";
  const firstPart = fullName.trim().split(/\s+/)[0];
  return firstPart.charAt(0).toUpperCase() + firstPart.slice(1).toLowerCase();
};

/** Returns true when the contact is a production company (not "Regista e Produzione") */
export const isProductionOnly = (role?: string | null) =>
  role === "Produzione";

export type FollowUpLanguage = "it" | "en";

const getFollowUpLanguage = (value?: string | null): FollowUpLanguage =>
  value === "en" ? "en" : "it";

const DEFAULT_SIGNATURE_HTML = `
<div style="margin-top: 25px; font-family: Helvetica, Arial, sans-serif; color: #111; line-height: 1.4;">
  <div style="font-weight: bold; font-size: 16px;">Pietro Montanti</div>
  <div style="font-size: 14px;">Multi Instrumentalist, Composer for TV & Theatre</div>
  <div style="font-size: 14px;">3515172560</div>
  <div style="font-size: 14px;">P.IVA: 04593080239</div>
  <div style="font-size: 14px;">Via Mulino Turri 9c, Negrar (VR)</div>
  <div style="margin-top: 20px;">
    <img src="cid:firma_pietro" alt="Pietro Montanti" width="320" style="display: block; max-width: 100%; height: auto;">
  </div>
</div>`;

export const buildAutoFollowUpEmail1 = (
  name: string,
  signatureHtml?: string | null,
  language?: FollowUpLanguage | null,
  role?: string | null
) => {
  const firstName = extractFirstName(name);
  const selectedLanguage = getFollowUpLanguage(language);
  const plural = isProductionOnly(role);
  const fullName = name.trim();
  const text =
    selectedLanguage === "en"
      ? `Hi ${firstName},
just a quick follow-up to my previous email.
If it makes sense to chat, I am available next Monday or Tuesday at 4:00 PM (CET).
Let me know what works best for you!
Best,`
      : plural
        ? `Buongiorno team di ${fullName}!
vi scrivo per riprendere velocemente la mia ultima mail.
Se può avere senso sentirci, sono disponibile lunedì o martedì prossimo alle 16!
Fatemi sapere cosa vi è più comodo.
A presto,`
        : `Ciao ${firstName}!,
ti scrivo per riprendere velocemente la mia ultima mail.
Se può avere senso sentirci, io sono disponibile lunedì o martedì prossimo alle 16.
Fammi sapere cosa ti è più comodo.
A presto,`;

  const finalSignature = signatureHtml || DEFAULT_SIGNATURE_HTML;

  const html =
    selectedLanguage === "en"
      ? `<div>Hi ${firstName},<br><br>
just a quick follow-up to my previous email.<br>
If it makes sense to chat, I am available next Monday or Tuesday at 4:00 PM (CET).<br>
Let me know what works best for you!<br><br>
Best,${finalSignature}</div>`
      : plural
        ? `<div>Buongiorno team di ${fullName}!<br><br>
vi scrivo per riprendere velocemente la mia ultima mail.<br>
Se può avere senso sentirci, sono disponibile lunedì o martedì prossimo alle 16!<br>
Fatemi sapere cosa vi è più comodo.<br><br>
A presto,${finalSignature}</div>`
        : `<div>Ciao ${firstName}!,<br><br>
ti scrivo per riprendere velocemente la mia ultima mail.<br>
Se può avere senso sentirci, io sono disponibile lunedì o martedì prossimo alle 16.<br>
Fammi sapere cosa ti è più comodo.<br><br>
A presto,${finalSignature}</div>`;

  return {
    subject: selectedLanguage === "en" ? "Your project" : "Il tuo lavoro",
    body: text,
    html: html,
  };
};

export const buildAutoFollowUpEmail2 = (
  name: string,
  signatureHtml?: string | null,
  language?: FollowUpLanguage | null,
  role?: string | null
) => {
  const firstName = extractFirstName(name);
  const selectedLanguage = getFollowUpLanguage(language);
  const plural = isProductionOnly(role);
  const fullName = name.trim();
  const text =
    selectedLanguage === "en"
      ? `Hi ${firstName},
this is my last follow-up.
Since I have not heard back, I assume your music needs are currently already covered.
If you would still like to connect, let me know and I will be happy to schedule a Zoom call this week!
Best regards,`
      : plural
        ? `Buongiorno team di ${fullName}!
vi scrivo per un ultimo follow-up.
Non avendo ricevuto risposta, presumo che al momento le vostre esigenze musicali siano già soddisfatte.
Se volete comunque sentirci, fatemi sapere e sarò felice di fissare una call su Zoom questa settimana!
Un saluto,`
        : `Ciao ${firstName}!,
ti scrivo per un ultimo follow-up.
Non avendo ricevuto risposta, presumo che al momento le tue esigenze musicali siano già soddisfatte.
Se vuoi comunque sentirci, fammi sapere e sono disponibile a fissare una call su Zoom questa settimana.
Un saluto,`;

  const finalSignature = signatureHtml || DEFAULT_SIGNATURE_HTML;

  const html =
    selectedLanguage === "en"
      ? `<div>Hi ${firstName},<br><br>
this is my last follow-up.<br>
Since I have not heard back, I assume your music needs are currently already covered.<br>
If you would still like to connect, let me know and I will be happy to schedule a Zoom call this week!<br><br>
Best regards,${finalSignature}</div>`
      : plural
        ? `<div>Buongiorno team di ${fullName}!<br><br>
vi scrivo per un ultimo follow-up.<br>
Non avendo ricevuto risposta, presumo che al momento le vostre esigenze musicali siano già soddisfatte.<br>
Se volete comunque sentirci, fatemi sapere e sarò felice di fissare una call su Zoom questa settimana!<br><br>
Un saluto,${finalSignature}</div>`
        : `<div>Ciao ${firstName}!,<br><br>
ti scrivo per un ultimo follow-up.<br>
Non avendo ricevuto risposta, presumo che al momento le tue esigenze musicali siano già soddisfatte.<br>
Se vuoi comunque sentirci, fammi sapere e sono disponibile a fissare una call su Zoom questa settimana.<br><br>
Un saluto,${finalSignature}</div>`;

  return {
    subject: selectedLanguage === "en" ? "Your project" : "Il tuo lavoro",
    body: text,
    html: html,
  };
};

export const buildMaintainRapportEmail = (
  name: string,
  signatureHtml?: string | null,
  language?: FollowUpLanguage | null,
  role?: string | null
) => {
  const firstName = extractFirstName(name);
  const selectedLanguage = getFollowUpLanguage(language);
  const plural = isProductionOnly(role);
  const fullName = name.trim();
  const text =
    selectedLanguage === "en"
      ? `Hi ${firstName},

I hope you are doing well!

I have been meaning to reconnect and I would be glad to be in touch again. I was wondering how your projects are going these days.

In the meantime, I also updated my website (https://www.pietromontanti.com/) and collected some recent work on SoundCloud (https://soundcloud.com/pietromontanticomposer), many selected at international festivals, so feel free to have a look if you like!

Best regards,`
      : plural
        ? `Buongiorno team di ${fullName}!

spero stiate bene!

È da un po' che pensavo di ricontattarvi e mi faceva piacere riallacciare il contatto. Mi chiedevo come stessero andando i vostri progetti in questo periodo.

Nel frattempo ho aggiornato anche il mio sito (https://www.pietromontanti.com/) e raccolto alcuni lavori recenti su SoundCloud (https://soundcloud.com/pietromontanticomposer) molti selezionati in festival internazionali quindi se vi fa piacere potete dare un'occhiata!

Un saluto,`
        : `Ciao ${firstName}!,

spero tu stia bene.

È da un po' che pensavo di risentirti e mi faceva piacere riallacciare il contatto. Mi chiedevo come stessero andando i tuoi progetti in questo periodo.

Nel frattempo ho aggiornato anche il mio sito (https://www.pietromontanti.com/) e raccolto alcuni lavori recenti su SoundCloud (https://soundcloud.com/pietromontanticomposer) molti selezionati in festival internazionali quindi se ti fa piacere puoi dare un'occhiata!

Un saluto,`;

  const finalSignature = signatureHtml || DEFAULT_SIGNATURE_HTML;

  const html =
    selectedLanguage === "en"
      ? `<div>Hi ${firstName},<br><br>
I hope you are doing well!<br><br>
I have been meaning to reconnect and I would be glad to be in touch again. I was wondering how your projects are going these days.<br><br>
In the meantime, I also updated my website (<a href="https://www.pietromontanti.com/">pietromontanti.com</a>) and collected some recent work on <a href="https://soundcloud.com/pietromontanticomposer">SoundCloud</a>, many selected at international festivals, so feel free to have a look if you like!<br><br>
Best regards,${finalSignature}</div>`
      : plural
        ? `<div>Buongiorno team di ${fullName}!<br><br>
spero stiate bene!<br><br>
È da un po' che pensavo di ricontattarvi e mi faceva piacere riallacciare il contatto. Mi chiedevo come stessero andando i vostri progetti in questo periodo.<br><br>
Nel frattempo ho aggiornato anche il mio sito (<a href="https://www.pietromontanti.com/">pietromontanti.com</a>) e raccolto alcuni lavori recenti su <a href="https://soundcloud.com/pietromontanticomposer">SoundCloud</a> molti selezionati in festival internazionali quindi se vi fa piacere potete dare un'occhiata!<br><br>
Un saluto,${finalSignature}</div>`
        : `<div>Ciao ${firstName}!,<br><br>
spero tu stia bene.<br><br>
È da un po' che pensavo di risentirti e mi faceva piacere riallacciare il contatto. Mi chiedevo come stessero andando i tuoi progetti in questo periodo.<br><br>
Nel frattempo ho aggiornato anche il mio sito (<a href="https://www.pietromontanti.com/">pietromontanti.com</a>) e raccolto alcuni lavori recenti su <a href="https://soundcloud.com/pietromontanticomposer">SoundCloud</a> molti selezionati in festival internazionali quindi se ti fa piacere puoi dare un'occhiata!<br><br>
Un saluto,${finalSignature}</div>`;

  return {
    subject: selectedLanguage === "en" ? "Your project" : "Il tuo lavoro",
    body: text,
    html: html,
  };
};

export const handleContactInbound = async (
  supabase: SupabaseClient,
  contactId: string
) => {
  const { data: contact } = await supabase
    .from("contacts")
    .select("status, next_action_note")
    .eq("id", contactId)
    .maybeSingle();

  if (contact) {
    const isAutoFollowActive = getAutomaticFollowUpStage(contact.next_action_note);
    const isMaintainActive = isMaintainRapportNote(contact.next_action_note);
    const updates: Record<string, string | null> = {};

    // Se c'è un auto follow-up attivo o se lo stato è ancora quello iniziale o in attesa
    if (
      isAutoFollowActive ||
      isMaintainActive ||
      contact.status === "Attiva auto follow-up" ||
      contact.status === "In attesa"
    ) {
      updates.status = "Azione richiesta";
    }

    // Cancella follow-up automatico o mantenimento rapporto se il contatto risponde
    if (isAutoFollowActive || isMaintainActive) {
      updates.next_action_at = null;
      updates.next_action_note = null;
    }

    if (Object.keys(updates).length > 0) {
      await supabase
        .from("contacts")
        .update(updates)
        .eq("id", contactId);
    }
  }
};
