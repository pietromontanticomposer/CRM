import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildKnownContactAddresses,
  extractEmails,
  rowMatchesAddresses,
} from "@/lib/server/emailMatching";

type EmailHistoryRow = {
  id: string;
  contact_id?: string | null;
  direction?: "inbound" | "outbound" | null;
  from_email?: string | null;
  to_email?: string | null;
  received_at?: string | null;
  created_at?: string | null;
  raw?: Record<string, unknown> | null;
};

const escapeIlike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const getTimestamp = (value?: string | null) => {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const loadContactEmailHistory = async <TRow extends EmailHistoryRow>(
  supabase: SupabaseClient,
  options: {
    contactId: string;
    emailText?: string | null;
    select: string;
    limit: number;
  }
) => {
  const { contactId, emailText, select, limit } = options;

  const { data: linkedRows, error: linkedError } = await supabase
    .from("emails")
    .select(select)
    .eq("contact_id", contactId)
    .order("received_at", { ascending: false })
    .limit(limit);

  if (linkedError) {
    return { data: null as TRow[] | null, error: linkedError };
  }
  const linkedData = ((linkedRows ?? []) as unknown) as TRow[];

  const addresses = buildKnownContactAddresses(
    extractEmails(emailText),
    linkedData,
    process.env.GMAIL_USER
  );
  const addressSet = new Set(addresses);
  const shouldIncludeRow = (row: TRow) => {
    if (!addressSet.size) {
      return true;
    }
    return rowMatchesAddresses(row, addressSet);
  };

  if (!addresses.length) {
    return { data: linkedData.filter(shouldIncludeRow), error: null };
  }

  const fallbackFilter = addresses
    .flatMap((address) => [
      `from_email.ilike.%${escapeIlike(address)}%`,
      `to_email.ilike.%${escapeIlike(address)}%`,
    ])
    .join(",");

  const { data: unlinkedRows, error: unlinkedError } = await supabase
    .from("emails")
    .select(select)
    .or(fallbackFilter)
    .order("received_at", { ascending: false })
    .limit(limit);

  if (unlinkedError) {
    return { data: null as TRow[] | null, error: unlinkedError };
  }

  const merged = new Map<string, TRow>();
  const unlinkedData = ((unlinkedRows ?? []) as unknown) as TRow[];

  linkedData.filter(shouldIncludeRow).forEach((row) => {
    merged.set(row.id, row);
  });

  unlinkedData
    .filter(shouldIncludeRow)
    .forEach((row) => {
      merged.set(row.id, row);
    });

  const ordered = Array.from(merged.values())
    .sort((a, b) => {
      const aTime = getTimestamp(a.received_at ?? a.created_at ?? null);
      const bTime = getTimestamp(b.received_at ?? b.created_at ?? null);
      return bTime - aTime;
    })
    .slice(0, limit);

  return { data: ordered, error: null };
};
