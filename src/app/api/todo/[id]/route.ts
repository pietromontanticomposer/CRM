import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type TodoUpdate = {
  title?: string;
  priority?: string;
  is_done?: boolean;
  notes?: string | null;
  due_date?: string | null;
  contact_id?: string | null;
};

const normalizeString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const normalizeNullableString = (value: unknown) => {
  const normalized = normalizeString(value);
  return normalized || null;
};

const normalizeUpdatePayload = (value: unknown): TodoUpdate | null => {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;

  return {
    title:
      typeof payload.title === "string" ? normalizeString(payload.title) : undefined,
    priority:
      typeof payload.priority === "string"
        ? normalizeString(payload.priority)
        : undefined,
    is_done:
      typeof payload.is_done === "boolean" ? payload.is_done : undefined,
    notes:
      payload.notes === undefined ? undefined : normalizeNullableString(payload.notes),
    due_date:
      payload.due_date === undefined
        ? undefined
        : normalizeNullableString(payload.due_date),
    contact_id:
      payload.contact_id === undefined
        ? undefined
        : normalizeNullableString(payload.contact_id),
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

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    const payload = normalizeUpdatePayload(body);

    if (!payload) {
      return NextResponse.json(
        { error: "Payload aggiornamento non valido." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("todo_tasks")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      console.error(`PATCH /api/todo/${id} failed`, error);
      return NextResponse.json(
        { error: getErrorMessage(error, "Impossibile aggiornare il task.") },
        { status: 500 }
      );
    }

    return NextResponse.json({ task: data });
  } catch (error) {
    console.error("PATCH /api/todo/[id] unexpected error", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Impossibile aggiornare il task.") },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("todo_tasks").delete().eq("id", id);

    if (error) {
      console.error(`DELETE /api/todo/${id} failed`, error);
      return NextResponse.json(
        { error: getErrorMessage(error, "Impossibile eliminare il task.") },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/todo/[id] unexpected error", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Impossibile eliminare il task.") },
      { status: 500 }
    );
  }
}
