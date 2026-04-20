import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import {
  getProviderDefaults,
  normalizeEmailProvider,
} from "@/lib/server/emailAccounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const normalizeString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const normalizeBoolean = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

const normalizePort = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const formatError = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Connessione email fallita.";
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const provider = normalizeEmailProvider(body.provider);
  const email = normalizeString(body.email).toLowerCase();
  const username = normalizeString(body.username) || email;
  const password = normalizeString(body.password);

  if (!provider || !email || !password) {
    return NextResponse.json(
      { ok: false, error: "Provider, email e password sono obbligatori." },
      { status: 400 }
    );
  }

  const defaults = getProviderDefaults(provider);
  const host = normalizeString(body.imap_host || body.imapHost) || defaults.imapHost;
  if (!host) {
    return NextResponse.json(
      { ok: false, error: "Host IMAP obbligatorio." },
      { status: 400 }
    );
  }

  const client = new ImapFlow({
    host,
    port: normalizePort(body.imap_port || body.imapPort, defaults.imapPort),
    secure: normalizeBoolean(
      body.imap_secure ?? body.imapSecure,
      defaults.imapSecure
    ),
    auth: { user: username, pass: password },
  });

  try {
    await client.connect();
    const mailboxes = await client.list();
    return NextResponse.json({
      ok: true,
      mailboxes: mailboxes.slice(0, 20).map((box) => box.path),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: formatError(error) },
      { status: 400 }
    );
  } finally {
    await client.logout().catch(() => undefined);
  }
}
