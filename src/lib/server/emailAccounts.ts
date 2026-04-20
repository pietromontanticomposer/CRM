import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type EmailProvider = "gmail" | "outlook" | "imap";

export type EmailAccountRow = {
  id: string;
  owner_id?: string | null;
  provider: EmailProvider;
  email: string;
  display_name: string | null;
  username: string | null;
  imap_host: string | null;
  imap_port: number | null;
  imap_secure: boolean | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: boolean | null;
  mailbox: string | null;
  password_encrypted: string | null;
  sync_enabled: boolean | null;
  sync_status: string | null;
  last_uid: number | null;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ResolvedEmailAccount = {
  id: string | null;
  provider: EmailProvider;
  email: string;
  username: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  mailbox: string | null;
};

const ENCRYPTION_PREFIX = "v1";

const getOptionalEnv = (key: string) => {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : null;
};

const getRequiredEnv = (key: string) => {
  const value = getOptionalEnv(key);
  if (!value) throw new Error(`Missing env var ${key}`);
  return value;
};

const getSecretKey = () => {
  const secret =
    getOptionalEnv("EMAIL_ACCOUNT_SECRET") || getOptionalEnv("APP_SESSION_SECRET");
  if (!secret) {
    throw new Error("Missing EMAIL_ACCOUNT_SECRET or APP_SESSION_SECRET");
  }
  return crypto.createHash("sha256").update(secret).digest();
};

export const encryptEmailAccountSecret = (value: string) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getSecretKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTION_PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
};

export const decryptEmailAccountSecret = (value: string) => {
  const [version, ivValue, tagValue, encryptedValue] = value.split(":");
  if (
    version !== ENCRYPTION_PREFIX ||
    !ivValue ||
    !tagValue ||
    !encryptedValue
  ) {
    throw new Error("Invalid encrypted email account secret");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getSecretKey(),
    Buffer.from(ivValue, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};

export const getProviderDefaults = (provider: EmailProvider) => {
  if (provider === "gmail") {
    return {
      imapHost: "imap.gmail.com",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "smtp.gmail.com",
      smtpPort: 465,
      smtpSecure: true,
    };
  }
  if (provider === "outlook") {
    return {
      imapHost: "outlook.office365.com",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "smtp.office365.com",
      smtpPort: 587,
      smtpSecure: false,
    };
  }
  return {
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
  };
};

export const normalizeEmailProvider = (value: unknown): EmailProvider | null => {
  if (value === "gmail" || value === "outlook" || value === "imap") {
    return value;
  }
  return null;
};

export const getLegacyGmailAccount = (): ResolvedEmailAccount => {
  const email = getRequiredEnv("GMAIL_USER");
  return {
    id: null,
    provider: "gmail",
    email,
    username: email,
    password: getRequiredEnv("GMAIL_APP_PASSWORD"),
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    mailbox: null,
  };
};

export const serializeEmailAccount = (row: EmailAccountRow) => ({
  id: row.id,
  provider: row.provider,
  email: row.email,
  display_name: row.display_name,
  username: row.username,
  imap_host: row.imap_host,
  imap_port: row.imap_port,
  imap_secure: row.imap_secure,
  smtp_host: row.smtp_host,
  smtp_port: row.smtp_port,
  smtp_secure: row.smtp_secure,
  mailbox: row.mailbox,
  sync_enabled: row.sync_enabled,
  sync_status: row.sync_status,
  last_uid: row.last_uid,
  last_sync_at: row.last_sync_at,
  last_error: row.last_error,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export const resolveEmailAccount = async (
  supabase: SupabaseClient,
  emailAccountId?: string | null,
  ownerId?: string | null,
  includeLegacy = false
): Promise<ResolvedEmailAccount> => {
  if (!emailAccountId) {
    return getLegacyGmailAccount();
  }

  let query = supabase
    .from("email_accounts")
    .select(
      "id,provider,email,display_name,username,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,mailbox,password_encrypted,sync_enabled,sync_status,last_uid,last_sync_at,last_error,created_at,updated_at"
    )
    .eq("id", emailAccountId);

  if (ownerId) {
    query = query.or(
      includeLegacy ? `owner_id.eq.${ownerId},owner_id.is.null` : `owner_id.eq.${ownerId}`
    );
  }

  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Email account not found");

  const row = data as EmailAccountRow;
  if (!row.sync_enabled) throw new Error("Email account sync disabled");

  const defaults = getProviderDefaults(row.provider);
  const password = row.password_encrypted
    ? decryptEmailAccountSecret(row.password_encrypted)
    : null;
  if (!password) {
    throw new Error("Email account password missing");
  }

  const imapHost = row.imap_host?.trim() || defaults.imapHost;
  if (!imapHost) throw new Error("Email account IMAP host missing");
  const smtpHost = row.smtp_host?.trim() || defaults.smtpHost || null;

  return {
    id: row.id,
    provider: row.provider,
    email: row.email,
    username: row.username?.trim() || row.email,
    password,
    imapHost,
    imapPort: row.imap_port || defaults.imapPort,
    imapSecure: row.imap_secure ?? defaults.imapSecure,
    smtpHost,
    smtpPort: row.smtp_port || defaults.smtpPort,
    smtpSecure: row.smtp_secure ?? defaults.smtpSecure,
    mailbox: row.mailbox,
  };
};
