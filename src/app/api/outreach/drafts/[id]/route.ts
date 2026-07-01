import { NextResponse } from "next/server";
import { isUnauthorizedError, requireCurrentUser } from "@/lib/server/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const supabaseRest = () => {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
};

// SOLO i campi che l'utente modifica davvero dalla UI (oggetto, testo, anagrafica).
// ai_status / ai_send_allowed / ai_validation_status / ai_template_used /
// ai_link_visione sono di ESCLUSIVA competenza del worker: se la UI potesse
// scriverli, un salvataggio dell'utente potrebbe sovrascrivere lo stato mentre il
// worker sta lavorando (e viceversa). Verificato: l'unico PATCH della UI manda
// solo ai_email_subject/ai_email_body; batch-add-line manda solo ai_email_body.
const PATCHABLE_FIELDS = new Set([
  "ai_email_subject",
  "ai_email_body",
  "notes",
  "name",
  "email",
  "company",
  "role",
]);

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const user = await requireCurrentUser();
    const cfg = supabaseRest();
    if (!cfg) {
      return NextResponse.json(
        { error: "Missing SUPABASE env." },
        { status: 500 }
      );
    }
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (PATCHABLE_FIELDS.has(key)) sanitized[key] = value;
    }
    if (!Object.keys(sanitized).length) {
      return NextResponse.json(
        { error: "Nessun campo modificabile nel payload." },
        { status: 400 }
      );
    }
    sanitized.updated_at = new Date().toISOString();

    const response = await fetch(
      `${cfg.url}/rest/v1/outreach_drafts?id=eq.${id}&owner_id=eq.${user.id}`,
      {
        method: "PATCH",
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(sanitized),
      }
    );
    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: text || response.statusText },
        { status: response.status }
      );
    }
    const data = (await response.json()) as unknown[];
    return NextResponse.json({ draft: data[0] ?? null });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PATCH /api/outreach/drafts/[id] failed", error);
    return NextResponse.json(
      { error: "Aggiornamento draft fallito." },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const user = await requireCurrentUser();
    const cfg = supabaseRest();
    if (!cfg) {
      return NextResponse.json(
        { error: "Missing SUPABASE env." },
        { status: 500 }
      );
    }
    const response = await fetch(
      `${cfg.url}/rest/v1/outreach_drafts?id=eq.${id}&owner_id=eq.${user.id}`,
      {
        method: "DELETE",
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
        },
      }
    );
    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: text || response.statusText },
        { status: response.status }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/outreach/drafts/[id] failed", error);
    return NextResponse.json(
      { error: "Cancellazione draft fallita." },
      { status: 500 }
    );
  }
}
