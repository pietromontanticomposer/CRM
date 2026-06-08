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

type DraftRow = {
  id: string;
  language: string | null;
  ai_email_body: string | null;
};

// Inserisce la frase come nuovo paragrafo SUBITO DOPO l'apertura, senza toccare
// il resto della mail. Niente AI, niente rigenerazione: istantaneo.
const insertAfterOpening = (body: string, line: string): string => {
  const paras = body.split(/\n{2,}/);
  const at = Math.min(1, paras.length); // dopo il 1° paragrafo (apertura)
  paras.splice(at, 0, line);
  return paras.join("\n\n");
};

// POST /api/outreach/drafts/batch-add-line
// Aggiunge una frase a TUTTE le bozze del batch, ognuna nella sua lingua
// (italiano -> lineIt, straniero/inglese -> lineEn). Deterministico e immediato.
export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const payload = (await request.json().catch(() => null)) as {
      batchId?: string;
      lineIt?: string;
      lineEn?: string;
    } | null;
    const batchId =
      typeof payload?.batchId === "string" ? payload.batchId.trim() : "";
    const lineIt =
      typeof payload?.lineIt === "string" ? payload.lineIt.trim() : "";
    const lineEn =
      typeof payload?.lineEn === "string" ? payload.lineEn.trim() : "";
    if (!batchId) {
      return NextResponse.json({ error: "batchId mancante." }, { status: 400 });
    }
    if (!lineIt && !lineEn) {
      return NextResponse.json(
        { error: "Scrivi almeno una frase." },
        { status: 400 }
      );
    }
    const cfg = supabaseRest();
    if (!cfg) {
      return NextResponse.json(
        { error: "Missing SUPABASE env." },
        { status: 500 }
      );
    }
    const headers = {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
    };

    const getRes = await fetch(
      `${cfg.url}/rest/v1/outreach_drafts?batch_id=eq.${batchId}&owner_id=eq.${user.id}&select=id,language,ai_email_body`,
      { headers }
    );
    if (!getRes.ok) {
      const text = await getRes.text();
      return NextResponse.json(
        { error: text || getRes.statusText },
        { status: getRes.status }
      );
    }
    const drafts = (await getRes.json()) as DraftRow[];

    const lineFor = (lang: string | null): string => {
      if (lang === "it") return lineIt || lineEn;
      return lineEn || lineIt; // straniero / sconosciuto -> inglese (fallback IT)
    };

    let updated = 0;
    let skipped = 0;
    // A blocchi per non saturare la funzione serverless.
    for (let i = 0; i < drafts.length; i += 10) {
      const chunk = drafts.slice(i, i + 10);
      await Promise.all(
        chunk.map(async (draft) => {
          const body = draft.ai_email_body;
          if (!body || !body.trim()) {
            skipped += 1;
            return;
          }
          const line = lineFor(draft.language);
          if (!line || body.includes(line)) {
            skipped += 1; // niente da aggiungere o gia' presente
            return;
          }
          const newBody = insertAfterOpening(body, line);
          const patchRes = await fetch(
            `${cfg.url}/rest/v1/outreach_drafts?id=eq.${draft.id}&owner_id=eq.${user.id}`,
            {
              method: "PATCH",
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify({ ai_email_body: newBody }),
            }
          );
          if (patchRes.ok) updated += 1;
          else skipped += 1;
        })
      );
    }

    return NextResponse.json({ updated, skipped, total: drafts.length });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/outreach/drafts/batch-add-line failed", error);
    return NextResponse.json(
      { error: "Aggiunta frase fallita." },
      { status: 500 }
    );
  }
}
