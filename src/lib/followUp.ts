export const KEEP_IN_TOUCH_MONTHS = 2;
export const KEEP_IN_TOUCH_NOTE = `Mantenere in contatto (automatico ogni ${KEEP_IN_TOUCH_MONTHS} mesi)`;

export const SECOND_FOLLOW_UP_DAYS = 20; // Modified from 30 to 20 as requested
export const LEGACY_AUTOMATIC_FOLLOW_UP_NOTE = "Follow-up automatico (10 giorni)";
export const FOLLOW_UP_TIME_ZONE = "Europe/Rome";

export const AUTO_FOLLOW_UP_1_NOTE = "Follow-up automatico 1/2 (10 giorni)";
export const AUTO_FOLLOW_UP_2_NOTE = `Follow-up automatico 2/2 (${SECOND_FOLLOW_UP_DAYS} giorni dal primo)`;

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
  stage: AutomaticFollowUpStage,
  firstFollowUpDays: number = 10
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

export const buildAutoFollowUpEmail1 = (name: string, signatureHtml?: string | null) => {
  const firstName = extractFirstName(name);
  const text = `Ciao ${firstName}!,
ti scrivo per riprendere velocemente la mia ultima mail.
Se può avere senso sentirci, io sono disponibile lunedì o martedì prossimo alle 16.
Fammi sapere cosa ti è più comodo.
A presto,`;

  // Fallback signature if none in env
  const defaultSignature = `
<div style="margin-top: 25px; font-family: Helvetica, Arial, sans-serif; color: #111; line-height: 1.4;">
  <div style="font-weight: bold; font-size: 16px;">Pietro Montanti</div>
  <div style="font-size: 14px;">Multi Instrumentalist, Composer for TV & Theatre</div>
  <div style="font-size: 14px;">3515172560</div>
  <div style="font-size: 14px;">P.IVA: 04593080239</div>
  <div style="font-size: 14px;">Via Mulino Turri 9c, Negrar (VR)</div>
  <div style="margin-top: 20px;">
    <img src="https://crm-next-pietro.vercel.app/firma_pietro.png" alt="Pietro Montanti" width="320" style="display: block; max-width: 100%; height: auto;">
  </div>
</div>`;

  const finalSignature = signatureHtml || defaultSignature;

  const html = `<div>Ciao ${firstName}!,<br><br>
ti scrivo per riprendere velocemente la mia ultima mail.<br>
Se può avere senso sentirci, io sono disponibile lunedì o martedì prossimo alle 16.<br>
Fammi sapere cosa ti è più comodo.<br><br>
A presto,${finalSignature}</div>`;

  return {
    subject: "Il tuo lavoro",
    body: text,
    html: html,
  };
};

export const buildAutoFollowUpEmail2 = (name: string, signatureHtml?: string | null) => {
  const firstName = extractFirstName(name);
  const text = `Ciao ${firstName}!,
ti scrivo per un ultimo follow-up.
Non avendo ricevuto risposta, presumo che al momento le tue esigenze musicali siano già soddisfatte.
Se vuoi comunque sentirci, fammi sapere e sono disponibile a fissare una call su Zoom questa settimana.
Un saluto,`;

  // Fallback signature if none in env
  const defaultSignature = `
<div style="margin-top: 25px; font-family: Helvetica, Arial, sans-serif; color: #111; line-height: 1.4;">
  <div style="font-weight: bold; font-size: 16px;">Pietro Montanti</div>
  <div style="font-size: 14px;">Multi Instrumentalist, Composer for TV & Theatre</div>
  <div style="font-size: 14px;">3515172560</div>
  <div style="font-size: 14px;">P.IVA: 04593080239</div>
  <div style="font-size: 14px;">Via Mulino Turri 9c, Negrar (VR)</div>
  <div style="margin-top: 20px;">
    <img src="https://crm-next-pietro.vercel.app/firma_pietro.png" alt="Pietro Montanti" width="320" style="display: block; max-width: 100%; height: auto;">
  </div>
</div>`;

  const finalSignature = signatureHtml || defaultSignature;

  const html = `<div>Ciao ${firstName}!,<br><br>
ti scrivo per un ultimo follow-up.<br>
Non avendo ricevuto risposta, presumo che al momento le tue esigenze musicali siano già soddisfatte.<br>
Se vuoi comunque sentirci, fammi sapere e sono disponibile a fissare una call su Zoom questa settimana.<br><br>
Un saluto,${finalSignature}</div>`;

  return {
    subject: "Il tuo lavoro",
    body: text,
    html: html,
  };
};

export const handleContactInbound = async (
  supabase: any,
  contactId: string
) => {
  const { data: contact } = await supabase
    .from("contacts")
    .select("status, next_action_note")
    .eq("id", contactId)
    .maybeSingle();

  if (contact) {
    const isAutoFollowActive = getAutomaticFollowUpStage(contact.next_action_note);
    const updates: Record<string, any> = {};

    // Se c'è un auto follow-up attivo o se lo stato è ancora quello iniziale
    if (isAutoFollowActive || contact.status === "Auto follow impostato") {
      updates.status = "Risposta ricevuta";
    }

    if (isAutoFollowActive) {
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
