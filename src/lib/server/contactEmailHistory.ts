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

const sortRowsByActivity = <TRow extends EmailHistoryRow>(rows: TRow[]) =>
  [...rows].sort((a, b) => {
    const aTime = getTimestamp(a.received_at ?? a.created_at ?? null);
    const bTime = getTimestamp(b.received_at ?? b.created_at ?? null);
    return bTime - aTime;
  });

export const loadContactEmailHistory = async <TRow extends EmailHistoryRow>(
  supabase: SupabaseClient,
  options: {
    contactId: string;
    emailText?: string | null;
    select: string;
    limit: number;
    ownerId?: string | null;
    includeLegacy?: boolean;
  }
) => {
  const { contactId, emailText, select, limit, ownerId, includeLegacy } = options;
  const ownerModes =
    ownerId && includeLegacy ? ["owner", "legacy"] : ownerId ? ["owner"] : ["all"];

  const linkedData: TRow[] = [];

  for (const ownerMode of ownerModes) {
    let linkedQuery = supabase
      .from("emails")
      .select(select)
      .eq("contact_id", contactId)
      .order("received_at", { ascending: false })
      .limit(limit);

    if (ownerMode === "owner" && ownerId) {
      linkedQuery = linkedQuery.eq("owner_id", ownerId);
    } else if (ownerMode === "legacy") {
      linkedQuery = linkedQuery.is("owner_id", null);
    }

    const { data: linkedRows, error: linkedError } = await linkedQuery;
    if (linkedError) {
      return { data: null as TRow[] | null, error: linkedError };
    }
    linkedData.push(...(((linkedRows ?? []) as unknown) as TRow[]));
  }

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
  const filteredLinkedData = linkedData.filter(shouldIncludeRow);

  if (!addresses.length) {
    return { data: sortRowsByActivity(filteredLinkedData).slice(0, limit), error: null };
  }

  if (filteredLinkedData.length > 0) {
    return { data: sortRowsByActivity(filteredLinkedData).slice(0, limit), error: null };
  }

  const fallbackFilter = addresses
    .flatMap((address) => [
      `from_email.ilike.%${escapeIlike(address)}%`,
      `to_email.ilike.%${escapeIlike(address)}%`,
    ])
    .join(",");

  const unlinkedData: TRow[] = [];

  for (const ownerMode of ownerModes) {
    let unlinkedQuery = supabase
      .from("emails")
      .select(select)
      .or(fallbackFilter)
      .order("received_at", { ascending: false })
      .limit(limit);

    if (ownerMode === "owner" && ownerId) {
      unlinkedQuery = unlinkedQuery.eq("owner_id", ownerId);
    } else if (ownerMode === "legacy") {
      unlinkedQuery = unlinkedQuery.is("owner_id", null);
    }

    const { data: unlinkedRows, error: unlinkedError } = await unlinkedQuery;
    if (unlinkedError) {
      return { data: null as TRow[] | null, error: unlinkedError };
    }
    unlinkedData.push(...(((unlinkedRows ?? []) as unknown) as TRow[]));
  }

  const merged = new Map<string, TRow>();

  filteredLinkedData.forEach((row) => {
    merged.set(row.id, row);
  });

  unlinkedData
    .filter(shouldIncludeRow)
    .forEach((row) => {
      merged.set(row.id, row);
    });

  const ordered = sortRowsByActivity(Array.from(merged.values())).slice(0, limit);

  return { data: ordered, error: null };
};
