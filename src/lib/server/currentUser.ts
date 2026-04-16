import crypto from "node:crypto";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getConfiguredLoginEmail,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

type AppUserRow = {
  id: string;
  email: string;
  password_hash: string | null;
  email_verified_at?: string | null;
  disabled_at?: string | null;
};

export type CurrentUser = {
  id: string;
  email: string;
  canAccessLegacyData: boolean;
};

const PASSWORD_PREFIX = "pbkdf2-v1";
const PASSWORD_ITERATIONS = 120000;
const PASSWORD_KEY_LENGTH = 32;

const normalizeUserEmail = (email: string) => email.trim().toLowerCase();

const canAccessLegacyData = (email: string) => {
  const legacyEmail = getConfiguredLoginEmail()?.trim().toLowerCase();
  return Boolean(legacyEmail && normalizeUserEmail(email) === legacyEmail);
};

const toCurrentUser = (row: AppUserRow): CurrentUser => ({
  id: row.id,
  email: row.email,
  canAccessLegacyData: canAccessLegacyData(row.email),
});

export const findAppUserByEmail = async (
  supabase: SupabaseClient,
  email: string
) => {
  const { data, error } = await supabase
    .from("app_users")
    .select("id,email,password_hash,email_verified_at,disabled_at")
    .eq("email", normalizeUserEmail(email))
    .maybeSingle();

  if (error) throw error;
  return data as AppUserRow | null;
};

export const getOwnerFilter = (user: CurrentUser) =>
  user.canAccessLegacyData
    ? `owner_id.eq.${user.id},owner_id.is.null`
    : `owner_id.eq.${user.id}`;

export const hashPassword = (password: string) => {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(
    password,
    salt,
    PASSWORD_ITERATIONS,
    PASSWORD_KEY_LENGTH,
    "sha256"
  );
  return [
    PASSWORD_PREFIX,
    String(PASSWORD_ITERATIONS),
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join(":");
};

export const verifyPasswordHash = (stored: string, password: string) => {
  const [prefix, iterationsValue, saltValue, hashValue] = stored.split(":");
  const iterations = Number(iterationsValue);
  if (
    prefix !== PASSWORD_PREFIX ||
    !Number.isFinite(iterations) ||
    !saltValue ||
    !hashValue
  ) {
    return false;
  }

  const salt = Buffer.from(saltValue, "base64url");
  const expected = Buffer.from(hashValue, "base64url");
  const actual = crypto.pbkdf2Sync(
    password,
    salt,
    iterations,
    expected.length,
    "sha256"
  );
  return (
    actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  );
};

export const ensureAppUser = async (
  supabase: SupabaseClient,
  email: string
) => {
  const normalizedEmail = normalizeUserEmail(email);
  const existing = await findAppUserByEmail(supabase, normalizedEmail);
  if (existing) {
    if (existing.disabled_at) throw new Error("Unauthorized");
    return toCurrentUser(existing);
  }
  const legacyVerifiedAt = canAccessLegacyData(normalizedEmail)
    ? new Date().toISOString()
    : null;

  const { data, error } = await supabase
    .from("app_users")
    .insert({ email: normalizedEmail, email_verified_at: legacyVerifiedAt })
    .select("id,email,password_hash,email_verified_at,disabled_at")
    .single();

  if (error) {
    const retry = await findAppUserByEmail(supabase, normalizedEmail);
    if (retry) return toCurrentUser(retry);
    throw error;
  }

  return toCurrentUser(data as AppUserRow);
};

export const createAppUser = async (
  supabase: SupabaseClient,
  email: string,
  password: string
) => {
  const normalizedEmail = normalizeUserEmail(email);
  if (!normalizedEmail || password.length < 8) {
    throw new Error("Email o password non valida.");
  }

  const passwordHash = hashPassword(password);
  const existing = await findAppUserByEmail(supabase, normalizedEmail);
  if (existing) {
    if (existing.disabled_at) {
      throw new Error("Account disabilitato.");
    }
    if (existing.password_hash && existing.email_verified_at) {
      throw new Error("Account gia esistente.");
    }

    const { data, error } = await supabase
      .from("app_users")
      .update({ password_hash: passwordHash })
      .eq("id", existing.id)
      .select("id,email,password_hash,email_verified_at,disabled_at")
      .single();
    if (error) throw error;
    return toCurrentUser(data as AppUserRow);
  }

  const { data, error } = await supabase
    .from("app_users")
    .insert({ email: normalizedEmail, password_hash: passwordHash })
    .select("id,email,password_hash,email_verified_at,disabled_at")
    .single();

  if (error) throw error;
  return toCurrentUser(data as AppUserRow);
};

export const validateAppUserLogin = async (
  supabase: SupabaseClient,
  email: string,
  password: string
) => {
  const user = await findAppUserByEmail(supabase, email);
  if (!user?.password_hash) return null;
  if (user.disabled_at) return null;
  if (!user.email_verified_at && !canAccessLegacyData(user.email)) {
    throw new Error("EMAIL_NOT_VERIFIED");
  }
  if (!verifyPasswordHash(user.password_hash, password)) return null;
  return toCurrentUser(user);
};

export const markEmailVerified = async (
  supabase: SupabaseClient,
  userId: string
) => {
  const { data, error } = await supabase
    .from("app_users")
    .update({ email_verified_at: new Date().toISOString() })
    .eq("id", userId)
    .select("id,email,password_hash,email_verified_at,disabled_at")
    .single();
  if (error) throw error;
  return toCurrentUser(data as AppUserRow);
};

export const updateAppUserPassword = async (
  supabase: SupabaseClient,
  userId: string,
  password: string
) => {
  if (password.length < 8) {
    throw new Error("Password minimo 8 caratteri.");
  }
  const { data, error } = await supabase
    .from("app_users")
    .update({ password_hash: hashPassword(password) })
    .eq("id", userId)
    .is("disabled_at", null)
    .select("id,email,password_hash,email_verified_at,disabled_at")
    .single();
  if (error) throw error;
  return toCurrentUser(data as AppUserRow);
};

export const requireCurrentUser = async (
  supabase: SupabaseClient = getSupabaseAdmin()
) => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionToken(token);
  if (!session?.email) {
    throw new Error("Unauthorized");
  }
  return ensureAppUser(supabase, session.email);
};
