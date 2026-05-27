import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import {
  encryptEmailAccountSecret,
  getProviderDefaults,
  normalizeEmailProvider,
  serializeEmailAccount,
  type EmailAccountRow,
} from "@/lib/server/emailAccounts";
import { getOwnerFilter, isUnauthorizedError, requireCurrentUser } from "@/lib/server/currentUser";
import { isLegacySchemaError } from "@/lib/server/supabaseSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const normalizeString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const normalizeNullableString = (value: unknown) => {
  const normalized = normalizeString(value);
  return normalized || null;
};

const normalizeBoolean = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

const normalizePort = (value: unknown, fallback: number | null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireCurrentUser(supabase);
    if (user.usesLegacySchema) {
      return NextResponse.json({ ok: true, accounts: [] });
    }
    const { data, error } = await supabase
      .from("email_accounts")
      .select(
        "id,provider,email,display_name,username,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,mailbox,sync_enabled,sync_status,last_uid,last_sync_at,last_error,created_at,updated_at"
      )
      .or(getOwnerFilter(user))
      .order("created_at", { ascending: false });

    if (error) {
      if (isLegacySchemaError(error, ["email_accounts", "owner_id"])) {
        return NextResponse.json({ ok: true, accounts: [] });
      }
      return NextResponse.json(
        { ok: false, error: "Impossibile caricare gli account email." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      accounts: ((data ?? []) as EmailAccountRow[]).map(serializeEmailAccount),
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/email-accounts unexpected error", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const provider = normalizeEmailProvider(body.provider);
    const email = normalizeString(body.email).toLowerCase();
    const password = normalizeString(body.password);

    if (!provider || !email) {
      return NextResponse.json(
        { ok: false, error: "Provider ed email sono obbligatori." },
        { status: 400 }
      );
    }
    if (!password) {
      return NextResponse.json(
        { ok: false, error: "Password/app password obbligatoria." },
        { status: 400 }
      );
    }

    const defaults = getProviderDefaults(provider);
    const imapHost =
      normalizeString(body.imap_host || body.imapHost) || defaults.imapHost;
    if (!imapHost) {
      return NextResponse.json(
        { ok: false, error: "Host IMAP obbligatorio." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const user = await requireCurrentUser(supabase);
    if (user.usesLegacySchema) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Configurazione account multipli non disponibile finché il database non viene aggiornato.",
        },
        { status: 400 }
      );
    }
    const insertPayload = {
      owner_id: user.id,
      provider,
      email,
      display_name: normalizeNullableString(body.display_name || body.displayName),
      username: normalizeNullableString(body.username) || email,
      imap_host: imapHost,
      imap_port: normalizePort(
        body.imap_port || body.imapPort,
        defaults.imapPort
      ),
      imap_secure: normalizeBoolean(
        body.imap_secure ?? body.imapSecure,
        defaults.imapSecure
      ),
      smtp_host:
        normalizeNullableString(body.smtp_host || body.smtpHost) ||
        defaults.smtpHost ||
        null,
      smtp_port: normalizePort(
        body.smtp_port || body.smtpPort,
        defaults.smtpPort
      ),
      smtp_secure: normalizeBoolean(
        body.smtp_secure ?? body.smtpSecure,
        defaults.smtpSecure
      ),
      mailbox: normalizeNullableString(body.mailbox),
      password_encrypted: encryptEmailAccountSecret(password),
      sync_enabled: normalizeBoolean(body.sync_enabled ?? body.syncEnabled, true),
      sync_status: "ready",
    };

    const { data, error } = await supabase
      .from("email_accounts")
      .insert(insertPayload)
      .select(
        "id,provider,email,display_name,username,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,mailbox,sync_enabled,sync_status,last_uid,last_sync_at,last_error,created_at,updated_at"
      )
      .single();

    if (error) {
      if (isLegacySchemaError(error, ["email_accounts", "owner_id"])) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Configurazione account multipli non disponibile finché il database non viene aggiornato.",
          },
          { status: 400 }
        );
      }
      console.error("POST /api/email-accounts failed", error);
      return NextResponse.json(
        { ok: false, error: "Impossibile salvare account email." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      account: serializeEmailAccount(data as EmailAccountRow),
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/email-accounts unexpected error", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
