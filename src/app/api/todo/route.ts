import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TodoInsert = {
  title: string;
  priority: string;
  is_done: boolean;
  notes: string | null;
  due_date: string | null;
  contact_id: string | null;
};

const normalizeString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const normalizeNullableString = (value: unknown) => {
  const normalized = normalizeString(value);
  return normalized || null;
};

const normalizeCreatePayload = (value: unknown): TodoInsert | null => {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const title = normalizeString(payload.title);
  if (!title) return null;

  return {
    title,
    priority: normalizeString(payload.priority) || "media",
    is_done: Boolean(payload.is_done),
    notes: normalizeNullableString(payload.notes),
    due_date: normalizeNullableString(payload.due_date),
    contact_id: normalizeNullableString(payload.contact_id),
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

  if (
    details.includes("enotfound") ||
    details.includes("fetch failed") ||
    details.includes("timed out")
  ) {
    return "Database non raggiungibile.";
  }

  return fallback;
};

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("todo_tasks")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("GET /api/todo failed", error);
      return NextResponse.json(
        { error: getErrorMessage(error, "Impossibile caricare i task.") },
        { status: 500 }
      );
    }

    return NextResponse.json({ tasks: data ?? [] });
  } catch (error) {
    console.error("GET /api/todo unexpected error", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Impossibile caricare i task.") },
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
        { error: "Titolo task mancante." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("todo_tasks")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      console.error("POST /api/todo failed", error);
      return NextResponse.json(
        { error: getErrorMessage(error, "Impossibile creare il task.") },
        { status: 500 }
      );
    }

    return NextResponse.json({ task: data }, { status: 201 });
  } catch (error) {
    console.error("POST /api/todo unexpected error", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Impossibile creare il task.") },
      { status: 500 }
    );
  }
}
