import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  isUnauthorizedError,
  requireCurrentUser,
} from "@/lib/server/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseRest = () => {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
};

// Nome del SEGNALE di ricerca. E' una riga "sentinella" in outreach_drafts: il
// worker locale la riconosce (verified_facts_json.discovery_request=true), va a
// cercare i wedding planner sul web, semina le bozze nello stesso batch e poi
// cancella la sentinella. L'UNIQUE index (owner+nome) impedisce due ricerche in
// parallelo per lo stesso utente: la seconda torna 409 -> "gia' in corso".
const SENTINEL_NAME = "Ricerca wedding planner";

// POST /api/outreach/discover  body: { target?: number }
// Avvia una ricerca di N wedding planner (default 20) entro ~2h da Verona. NON
// cerca qui (il sito su Vercel non ha le AI): mette il SEGNALE che il worker
// locale (Mac, "Avvia CRM") raccoglie ed esegue. Nessun invio automatico.
export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const cfg = supabaseRest();
    if (!cfg) {
      return NextResponse.json({ error: "Missing SUPABASE env." }, { status: 500 });
    }

    const body = (await request.json().catch(() => ({}))) as { target?: unknown };
    const rawTarget = Number(body.target);
    const target = Number.isFinite(rawTarget)
      ? Math.max(1, Math.min(50, Math.floor(rawTarget)))
      : 20;

    const batchId = randomUUID();
    const batchName = `Wedding planners ${new Date()
      .toISOString()
      .slice(0, 16)
      .replace("T", " ")}`;

    const payload = {
      owner_id: user.id,
      batch_id: batchId,
      batch_name: batchName,
      section: "live_music",
      name: SENTINEL_NAME,
      role: "__discovery__",
      notes: `Richiesta: trova ${target} wedding planner entro ~2h da Verona.`,
      verified_facts_json: { discovery_request: true, target },
      ai_status: "imported",
      ai_validation_status: "not_checked",
      ai_send_allowed: false,
    };

    const res = await fetch(`${cfg.url}/rest/v1/outreach_drafts`, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 409) {
      // Sentinella gia' presente: una ricerca e' gia' in coda/in corso.
      return NextResponse.json(
        {
          pending: true,
          message:
            "Una ricerca è già in corso. Aspetta che finisca prima di avviarne un'altra.",
        },
        { status: 200 }
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: text || res.statusText },
        { status: res.status }
      );
    }

    return NextResponse.json({ batch: { id: batchId, name: batchName }, target });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/outreach/discover failed", error);
    return NextResponse.json({ error: "Avvio ricerca fallito." }, { status: 500 });
  }
}
