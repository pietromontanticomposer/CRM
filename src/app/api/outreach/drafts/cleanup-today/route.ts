import { NextResponse } from "next/server";
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

// Mezzanotte di OGGI nel fuso di Pietro (Europe/Rome), DST-aware, in ISO.
// Es. "2026-06-07T00:00:00+02:00". Tutto cio' che e' >= questo cutoff conta
// come "importato oggi".
const startOfTodayRomeIso = (): string => {
  const now = new Date();
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // "YYYY-MM-DD"
  const offset =
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Rome",
      timeZoneName: "longOffset",
    })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const off = offset.replace("GMT", "") || "+00:00"; // "+02:00"
  return `${day}T00:00:00${off}`;
};

// POST /api/outreach/drafts/cleanup-today
// Cancella TUTTE le outreach_drafts (non approvate, per definizione: gli
// approvati stanno in `contacts`) dell'utente create OGGI. Rete anti-doppioni
// manuale: cosi' Pietro azzera l'import del giorno con un click.
export async function POST() {
  try {
    const user = await requireCurrentUser();
    const cfg = supabaseRest();
    if (!cfg) {
      return NextResponse.json(
        { error: "Missing SUPABASE env." },
        { status: 500 }
      );
    }
    const cutoff = startOfTodayRomeIso();
    // NON cancellare le bozze che il worker sta lavorando in questo momento:
    // 'processing' (email/scrittura in corso) e 'draft_ready' (scritta, in attesa
    // dei validatori — il worker la ri-pesca). Cancellarle interromperebbe il
    // lavoro. Due filtri neq sullo stesso campo = AND in PostgREST.
    const response = await fetch(
      `${cfg.url}/rest/v1/outreach_drafts?owner_id=eq.${user.id}&created_at=gte.${encodeURIComponent(
        cutoff
      )}&ai_status=neq.processing&ai_status=neq.draft_ready`,
      {
        method: "DELETE",
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          Prefer: "return=representation",
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
    const rows = (await response.json()) as unknown[];
    return NextResponse.json({
      deleted: Array.isArray(rows) ? rows.length : 0,
      cutoff,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/outreach/drafts/cleanup-today failed", error);
    return NextResponse.json(
      { error: "Pulizia di oggi fallita." },
      { status: 500 }
    );
  }
}
