export const KEEP_IN_TOUCH_MONTHS = 2;
export const KEEP_IN_TOUCH_NOTE = `Mantenere in contatto (automatico ogni ${KEEP_IN_TOUCH_MONTHS} mesi)`;

export const SECOND_FOLLOW_UP_DAYS = 30;

export type AutomaticFollowUpStage = 1 | 2;

export const isKeepInTouchNote = (value?: string | null) =>
  value?.trim() === KEEP_IN_TOUCH_NOTE;

export const getAutomaticFollowUpStage = (
  value?: string | null
): AutomaticFollowUpStage | null => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
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
