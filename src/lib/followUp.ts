export const KEEP_IN_TOUCH_MONTHS = 2;
export const KEEP_IN_TOUCH_NOTE = `Mantenere in contatto (automatico ogni ${KEEP_IN_TOUCH_MONTHS} mesi)`;

export const SECOND_FOLLOW_UP_DAYS = 30;
export const LEGACY_AUTOMATIC_FOLLOW_UP_NOTE = "Follow-up automatico (10 giorni)";
export const FOLLOW_UP_TIME_ZONE = "Europe/Rome";

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
  if (normalized.startsWith("follow-up automatico 2/2")) return 2;
  if (normalized.startsWith("follow-up automatico 1/2")) return 1;
  if (normalized.startsWith("follow-up automatico")) return 1;
  return null;
};

export const buildAutomaticFollowUpNote = (
  stage: AutomaticFollowUpStage,
  firstFollowUpDays: number
) => {
  if (stage === 1) {
    return `Follow-up automatico 1/2 (${firstFollowUpDays} giorni)`;
  }

  return `Follow-up automatico 2/2 (${SECOND_FOLLOW_UP_DAYS} giorni dal primo follow-up)`;
};
