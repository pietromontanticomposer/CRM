import type { SupabaseClient } from "@supabase/supabase-js";
import { extractEmails, rowMatchesAddresses } from "@/lib/server/emailMatching";

type LinkableEmailRow = {
  id: string;
  contact_id?: string | null;
  direction?: "inbound" | "outbound" | null;
  from_email?: string | null;
  to_email?: string | null;
  raw?: Record<string, unknown> | null;
};

const EMAIL_LINK_LIMIT = 5000;

const escapeIlike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const chunkArray = <T,>(items: T[], chunkSize: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

export const linkExistingEmailsToContact = async (
  supabase: SupabaseClient,
  contactId: string,
  emailText?: string | null,
  ownerId?: string | null,
  includeLegacy = false
) => {
  const addresses = extractEmails(emailText);
  if (!contactId || !addresses.length) return 0;

  const addressSet = new Set(addresses);
  const fallbackFilter = addresses
    .flatMap((address) => [
      `from_email.ilike.%${escapeIlike(address)}%`,
      `to_email.ilike.%${escapeIlike(address)}%`,
    ])
    .join(",");

  const ownerModes =
    ownerId && includeLegacy ? ["owner", "legacy"] : ownerId ? ["owner"] : ["all"];
  const rows: LinkableEmailRow[] = [];

  for (const ownerMode of ownerModes) {
    let query = supabase
      .from("emails")
      .select("id, contact_id, direction, from_email, to_email, raw")
      .is("contact_id", null)
      .or(fallbackFilter)
      .limit(EMAIL_LINK_LIMIT);

    if (ownerMode === "owner" && ownerId) {
      query = query.eq("owner_id", ownerId);
    } else if (ownerMode === "legacy") {
      query = query.is("owner_id", null);
    }

    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(((data ?? []) as unknown) as LinkableEmailRow[]));
  }

  const ids = rows
    .filter((row) => rowMatchesAddresses(row, addressSet))
    .map((row) => row.id);

  for (const chunk of chunkArray(ids, 200)) {
    const { error: updateError } = await supabase
      .from("emails")
      .update({ contact_id: contactId, ...(ownerId ? { owner_id: ownerId } : {}) })
      .in("id", chunk);

    if (updateError) throw updateError;
  }

  return ids.length;
};
