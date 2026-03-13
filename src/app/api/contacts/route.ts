import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ContactInsert = {
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  status: string;
  last_action_at: string | null;
};

const normalizeString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const normalizeNullableString = (value: unknown) => {
  const normalized = normalizeString(value);
  return normalized || null;
};

const normalizeCreatePayload = (value: unknown): ContactInsert | null => {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const name = normalizeString(payload.name);
  const company = normalizeString(payload.company);

  if (!name && !company) {
    return null;
  }

  const status = normalizeString(payload.status) || "Da contattare";
  const lastActionAt =
    status === "Già contattato"
      ? normalizeString(payload.last_action_at) || null
      : null;

  return {
    name,
    email: normalizeNullableString(payload.email),
    company: company || null,
    role: normalizeNullableString(payload.role),
    status,
    last_action_at: lastActionAt,
  };
};

const getErrorMessage = (error: unknown, fallback: string) => {
  const details = [
    error instanceof Error ? error.message : "",
    typeof error === "object" && error
      ? JSON.stringify(error, Object.getOwnPropertyNames(error))
      : String(error),
  ]
    .join(" ")
    .toLowerCase();

  if (details.includes("enotfound") || details.includes("fetch failed")) {
    return "Database non raggiungibile. Controlla SUPABASE_URL o che il progetto Supabase esista ancora.";
  }

  return fallback;
};

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("GET /api/contacts failed", error);
      return NextResponse.json(
        { error: getErrorMessage(error, "Impossibile caricare i contatti.") },
        { status: 500 }
      );
    }

    return NextResponse.json({ contacts: data ?? [] });
  } catch (error) {
    console.error("GET /api/contacts unexpected error", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Impossibile caricare i contatti.") },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const payload = normalizeCreatePayload(body);

    if (!payload) {
      return NextResponse.json(
        { error: "Inserisci nome oppure produzione." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("contacts")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      console.error("POST /api/contacts failed", error);
      return NextResponse.json(
        { error: getErrorMessage(error, "Impossibile salvare il contatto.") },
        { status: 500 }
      );
    }

    return NextResponse.json({ contact: data }, { status: 201 });
  } catch (error) {
    console.error("POST /api/contacts unexpected error", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Impossibile salvare il contatto.") },
      { status: 500 }
    );
  }
}
