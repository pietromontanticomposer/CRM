const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const SESSION_COOKIE_NAME = "crm_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 14;

type SessionPayload = {
  email: string;
  exp: number;
};

const getEnv = (key: string) => {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : null;
};

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const base64UrlToBytes = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(`${normalized}${padding}`);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const encodeText = (value: string) => bytesToBase64Url(encoder.encode(value));

const decodeText = (value: string) => decoder.decode(base64UrlToBytes(value));

const getSessionSecret = () => getEnv("APP_SESSION_SECRET");

const getLoginEmail = () => getEnv("APP_LOGIN_EMAIL");

const getLoginPassword = () => getEnv("APP_LOGIN_PASSWORD");

const importHmacKey = async (secret: string) =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

const signValue = async (value: string, secret: string) => {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
};

const verifyValue = async (value: string, signature: string, secret: string) => {
  const key = await importHmacKey(secret);
  return crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlToBytes(signature),
    encoder.encode(value)
  );
};

export const isAuthConfigured = () =>
  Boolean(getLoginEmail() && getLoginPassword() && getSessionSecret());

export const getConfiguredLoginEmail = () => getLoginEmail();

export const validateLogin = async (email: string, password: string) => {
  const expectedEmail = getLoginEmail();
  const expectedPassword = getLoginPassword();
  if (!expectedEmail || !expectedPassword) return false;

  return (
    email.trim().toLowerCase() === expectedEmail.toLowerCase() &&
    password === expectedPassword
  );
};

export const createSessionToken = async (email: string) => {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error("Missing APP_SESSION_SECRET");
  }

  const payload: SessionPayload = {
    email: email.trim().toLowerCase(),
    exp: Date.now() + SESSION_DURATION_SECONDS * 1000,
  };
  const encodedPayload = encodeText(JSON.stringify(payload));
  const signature = await signValue(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
};

export const verifySessionToken = async (token?: string | null) => {
  if (!token) return null;

  const secret = getSessionSecret();
  if (!secret) return null;

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const isValid = await verifyValue(encodedPayload, signature, secret);
  if (!isValid) return null;

  try {
    const payload = JSON.parse(decodeText(encodedPayload)) as SessionPayload;
    if (!payload.email || !payload.exp || payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

export const normalizeNextPath = (value?: string | null) => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/crm";
  }
  return value;
};

export const getSessionCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_DURATION_SECONDS,
});
