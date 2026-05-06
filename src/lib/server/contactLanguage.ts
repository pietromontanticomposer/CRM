import type { SupabaseClient } from "@supabase/supabase-js";
import { detectLanguageFromEmail, stripHtml } from "@/lib/languageDetection";

type EmailContent = {
  subject?: string | null;
  text_body?: string | null;
  html_body?: string | null;
};

const buildDetectionText = (email: EmailContent) =>
  [email.text_body, stripHtml(email.html_body), email.subject]
    .filter(Boolean)
    .join(" ")
    .trim();

/**
 * Update contacts.language for the given contact based on the content of an
 * inbound email. No-op if the email content is too short for the heuristic
 * to produce a confident answer — we'd rather keep a previous value than
 * overwrite with noise.
 */
export const refreshContactLanguageFromInboundEmail = async (
  supabase: SupabaseClient,
  contactId: string,
  email: EmailContent
) => {
  const text = buildDetectionText(email);
  const detected = detectLanguageFromEmail(text);
  if (!detected) return;

  const { error } = await supabase
    .from("contacts")
    .update({ language: detected })
    .eq("id", contactId);

  if (error) {
    console.error("refreshContactLanguageFromInboundEmail failed", error);
  }
};
