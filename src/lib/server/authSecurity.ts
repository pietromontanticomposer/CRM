import crypto from "node:crypto";
import nodemailer from "nodemailer";
import type { SupabaseClient } from "@supabase/supabase-js";

type AuthTokenType = "email_verification" | "password_reset";

const getOptionalEnv = (key: string) => {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : null;
};

const sha256 = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

export const getClientIp = (request: Request) => {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
};

export const checkRateLimit = async (
  supabase: SupabaseClient,
  input: {
    action: string;
    identifier: string;
    maxAttempts: number;
    windowSeconds: number;
    blockSeconds: number;
  }
) => {
  const key = sha256(`${input.action}:${input.identifier}`);
  const now = new Date();
  const { data: current, error } = await supabase
    .from("app_auth_rate_limits")
    .select("count, window_start, blocked_until")
    .eq("key", key)
    .maybeSingle();

  if (error) throw error;

  if (current?.blocked_until) {
    const blockedUntil = new Date(current.blocked_until);
    if (blockedUntil.getTime() > now.getTime()) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(
          (blockedUntil.getTime() - now.getTime()) / 1000
        ),
      };
    }
  }

  const windowStart = current?.window_start
    ? new Date(current.window_start)
    : now;
  const windowExpired =
    now.getTime() - windowStart.getTime() > input.windowSeconds * 1000;
  const nextCount = windowExpired ? 1 : Number(current?.count ?? 0) + 1;
  const blockedUntil =
    nextCount > input.maxAttempts
      ? new Date(now.getTime() + input.blockSeconds * 1000).toISOString()
      : null;

  const { error: upsertError } = await supabase
    .from("app_auth_rate_limits")
    .upsert(
      {
        key,
        action: input.action,
        count: nextCount,
        window_start: windowExpired ? now.toISOString() : windowStart.toISOString(),
        blocked_until: blockedUntil,
        updated_at: now.toISOString(),
      },
      { onConflict: "key" }
    );

  if (upsertError) throw upsertError;

  return {
    allowed: !blockedUntil,
    retryAfterSeconds: blockedUntil ? input.blockSeconds : 0,
  };
};

export const createAuthToken = async (
  supabase: SupabaseClient,
  userId: string,
  type: AuthTokenType,
  ttlMinutes: number
) => {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  const { error } = await supabase.from("app_auth_tokens").insert({
    user_id: userId,
    token_hash: tokenHash,
    type,
    expires_at: expiresAt,
  });
  if (error) throw error;

  return token;
};

export const consumeAuthToken = async (
  supabase: SupabaseClient,
  type: AuthTokenType,
  token: string
) => {
  const tokenHash = sha256(token.trim());
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("app_auth_tokens")
    .select("id, user_id")
    .eq("type", type)
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gt("expires_at", now)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const { error: updateError } = await supabase
    .from("app_auth_tokens")
    .update({ used_at: now })
    .eq("id", data.id);
  if (updateError) throw updateError;

  return { userId: data.user_id as string };
};

const getTransport = () => {
  const smtpHost = getOptionalEnv("SMTP_HOST");
  const smtpPort = Number(getOptionalEnv("SMTP_PORT") ?? 0);
  const smtpUser = getOptionalEnv("SMTP_USER");
  const smtpPass = getOptionalEnv("SMTP_PASS");
  if (smtpHost && Number.isFinite(smtpPort) && smtpPort > 0) {
    return nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
    });
  }

  const gmailUser = getOptionalEnv("GMAIL_USER");
  const gmailPass = getOptionalEnv("GMAIL_APP_PASSWORD");
  if (!gmailUser || !gmailPass) {
    throw new Error("SMTP non configurato.");
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass },
  });
};

export const sendAuthEmail = async (input: {
  to: string;
  subject: string;
  text: string;
}) => {
  const from = getOptionalEnv("MAIL_FROM") || getOptionalEnv("GMAIL_USER");
  if (!from) throw new Error("MAIL_FROM o GMAIL_USER mancante.");
  const transport = getTransport();
  await transport.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
  });
};
