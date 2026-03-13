export const normalizeEmail = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
};

export const uniqueEmails = (values: Array<string | null | undefined>) => {
  const unique = new Set<string>();
  values.forEach((value) => {
    const normalized = normalizeEmail(value);
    if (normalized) unique.add(normalized);
  });
  return Array.from(unique);
};

export const extractEmails = (value?: string | null) => {
  if (!value) return [];
  const matches = value.match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
  );
  if (!matches) return [];
  const unique = new Set(matches.map((item) => item.toLowerCase()));
  return Array.from(unique);
};

export const extractMessageIds = (value?: string | null) => {
  if (!value) return [];
  const bracketMatches = value.match(/<[^>]+>/g);
  const tokens =
    bracketMatches && bracketMatches.length > 0
      ? bracketMatches
      : value.split(/\s+/);

  const unique = new Set(
    tokens
      .map((token) => token.trim().replace(/^<|>$/g, "").toLowerCase())
      .filter(Boolean)
  );
  return Array.from(unique);
};

type EmailParticipantRow = {
  direction?: "inbound" | "outbound" | null;
  from_email?: string | null;
  to_email?: string | null;
  raw?: Record<string, unknown> | null;
};

const extractRawEmails = (value: unknown) => {
  if (typeof value === "string") {
    return extractEmails(value);
  }
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<string>();
  value.forEach((item) => {
    if (typeof item !== "string") return;
    extractEmails(item).forEach((address) => unique.add(address));
  });
  return Array.from(unique);
};

export const getParticipantAddresses = (row: EmailParticipantRow) => {
  const raw = row.raw && typeof row.raw === "object" ? row.raw : null;
  const unique = new Set([
    ...extractEmails(row.from_email),
    ...extractEmails(row.to_email),
    ...extractRawEmails(raw?.cc),
    ...extractRawEmails(raw?.bcc),
    ...extractRawEmails(raw?.to),
  ]);
  return Array.from(unique);
};

export const getRecipientAddresses = (row: EmailParticipantRow) => {
  const raw = row.raw && typeof row.raw === "object" ? row.raw : null;
  const unique = new Set([
    ...extractEmails(row.to_email),
    ...extractRawEmails(raw?.cc),
    ...extractRawEmails(raw?.bcc),
  ]);
  return Array.from(unique);
};

export const rowMatchesAddresses = (
  row: EmailParticipantRow,
  addresses: Set<string>
) => getParticipantAddresses(row).some((address) => addresses.has(address));

export const buildKnownContactAddresses = <TRow extends EmailParticipantRow>(
  seedAddresses: Array<string | null | undefined>,
  rows: TRow[],
  userEmail?: string | null
) => {
  const user = normalizeEmail(userEmail);
  const known = new Set(uniqueEmails(seedAddresses));

  rows.forEach((row) => {
    if (row.direction === "inbound") {
      extractEmails(row.from_email).forEach((address) => known.add(address));
      return;
    }

    if (row.direction !== "outbound") {
      return;
    }

    const recipients = getRecipientAddresses(row).filter(
      (address) => address !== user
    );
    if (recipients.length === 1) {
      known.add(recipients[0]);
    }
  });

  return Array.from(known);
};
