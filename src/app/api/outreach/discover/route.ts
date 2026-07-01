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

// Se la sentinella esiste da piu' di questo tempo la consideriamo ORFANA (worker
// crashato/spento prima di cancellarla) e la sovrascriviamo. Una ricerca reale
// dura pochi minuti: 30' e' un margine ampio che NON interrompe una ricerca
// legittima ma sblocca il caso "409 per giorni" dopo un crash.
const SENTINEL_TTL_MINUTES = 30;

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

    const insertSentinel = () =>
      fetch(`${cfg.url}/rest/v1/outreach_drafts`, {
        method: "POST",
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(payload),
      });

    let res = await insertSentinel();

    if (res.status === 409) {
      // Sentinella gia' presente. Puo' essere una ricerca DAVVERO in corso, oppure
      // una sentinella ORFANA lasciata da un worker crashato/ucciso prima di
      // cancellarla. Guardo da quanto esiste: se supera il TTL la considero orfana,
      // la rimuovo e riprovo UNA volta; altrimenti rispondo "gia' in corso".
      const staleCutoffIso = new Date(
        Date.now() - SENTINEL_TTL_MINUTES * 60 * 1000
      ).toISOString();
      const existingRes = await fetch(
        `${cfg.url}/rest/v1/outreach_drafts?owner_id=eq.${user.id}&role=eq.__discovery__&name=eq.${encodeURIComponent(
          SENTINEL_NAME
        )}&select=id,created_at&order=created_at.asc&limit=1`,
        { headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` } }
      ).catch(() => null);
      const existing =
        existingRes && existingRes.ok
          ? ((await existingRes.json().catch(() => [])) as Array<{
              id?: string;
              created_at?: string;
            }>)
          : [];
      const orphan = existing[0];
      const isStale =
        typeof orphan?.created_at === "string" &&
        orphan.created_at < staleCutoffIso;
      if (orphan?.id && isStale) {
        await fetch(
          `${cfg.url}/rest/v1/outreach_drafts?id=eq.${orphan.id}&owner_id=eq.${user.id}`,
          {
            method: "DELETE",
            headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
          }
        ).catch(() => null);
        res = await insertSentinel(); // riprovo dopo aver tolto l'orfana
      } else {
        return NextResponse.json(
          {
            pending: true,
            message:
              "Una ricerca è già in corso. Aspetta che finisca prima di avviarne un'altra.",
          },
          { status: 200 }
        );
      }
    }
    // Ancora 409 dopo il retry (gara con un'altra richiesta): tratto come pending.
    if (res.status === 409) {
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
