const DEFAULT_IDENTIFIERS = [
  "app_users",
  "app_auth_rate_limits",
  "app_auth_tokens",
  "email_accounts",
  "owner_id",
  "section",
  "language",
  "contact_id",
  "email_verified_at",
  "disabled_at",
  "last_login_at",
  "password_encrypted",
] as const;

export const getSupabaseErrorDetails = (error: unknown) =>
  [
    error instanceof Error ? error.message : "",
    typeof error === "object" && error
      ? JSON.stringify(error, Object.getOwnPropertyNames(error))
      : String(error),
  ]
    .join(" ")
    .toLowerCase();

export const isLegacySchemaError = (
  error: unknown,
  identifiers: readonly string[] = DEFAULT_IDENTIFIERS
) => {
  const details = getSupabaseErrorDetails(error);
  const mentionsKnownField = identifiers.some((identifier) =>
    details.includes(identifier.toLowerCase())
  );
  const looksLikeMissingSchema =
    details.includes("does not exist") ||
    details.includes("schema cache") ||
    details.includes("could not find the") ||
    details.includes("\"42p01\"") ||
    details.includes("\"42703\"") ||
    details.includes("\"pgrst204\"");

  return mentionsKnownField && looksLikeMissingSchema;
};
