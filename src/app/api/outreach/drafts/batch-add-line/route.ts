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

type Position = "start" | "after_compliment" | "end";

// Inserisce la frase come nuovo paragrafo nel punto scelto, senza toccare il
// resto della mail. Niente rigenerazione: istantaneo.
const insertAtPosition = (
  body: string,
  line: string,
  position: Position
): string => {
  const paras = body.split(/\n{2,}/);
  let at: number;
  if (position === "end") {
    const sigIdx = paras.findIndex((p) =>
      /^(un saluto|best,?|cordiali|a presto|kind regards|warm regards)/i.test(
        p.trim()
      )
    );
    at = sigIdx >= 0 ? sigIdx : Math.max(0, paras.length - 1);
  } else if (position === "after_compliment") {
    at = Math.min(2, paras.length);
  } else {
    at = Math.min(1, paras.length);
  }
  paras.splice(at, 0, line);
  return paras.join("\n\n");
};

// Traduzione GRATUITA IT->EN (MyMemory, nessuna chiave, nessun costo). Stringa
// vuota se fallisce (in quel caso si usa l'italiano come fallback).
const translateToEn = async (text: string): Promise<string> => {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
      text
    )}&langpair=it|en`;
    const res = await fetch(url, { headers: { "User-Agent": "crm-next/1.0" } });
    if (!res.ok) return "";
    const data = (await res.json()) as {
      responseStatus?: number | string;
      responseData?: { translatedText?: string };
    };
    const t = (data?.responseData?.translatedText ?? "").trim();
    if (Number(data?.responseStatus) !== 200 || !t || /^[A-Z ]{12,}$/.test(t)) {
      return "";
    }
    return t;
  } catch {
    return "";
  }
};

// POST /api/outreach/drafts/batch-add-line  { batchId, line, position }
// Pietro scrive la frase SOLO in italiano. Il sito traduce DA SOLO in inglese
// per le mail in inglese, poi inserisce la frase giusta in ogni bozza del batch.
export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const payload = (await request.json().catch(() => null)) as {
      batchId?: string;
      line?: string;
      position?: string;
    } | null;
    const batchId =
      typeof payload?.batchId === "string" ? payload.batchId.trim() : "";
    const line = typeof payload?.line === "string" ? payload.line.trim() : "";
    const position: Position =
      payload?.position === "after_compliment" || payload?.position === "end"
        ? payload.position
        : "start";
    if (!batchId) {
      return NextResponse.json({ error: "batchId mancante." }, { status: 400 });
    }
    if (!line) {
      return NextResponse.json({ error: "Scrivi la frase." }, { status: 400 });
    }
    const cfg = supabaseRest();
    if (!cfg) {
      return NextResponse.json(
        { error: "Missing SUPABASE env." },
        { status: 500 }
      );
    }
    const headers = { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` };

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

    // Se c'è almeno una mail NON italiana, traduco la frase una volta sola.
    const hasForeign = drafts.some((d) => (d.language ?? "") !== "it");
    let enLine = line;
    if (hasForeign) {
      const translated = await translateToEn(line);
      if (translated) enLine = translated;
    }
    const lineFor = (lang: string | null) => (lang === "it" ? line : enLine);

    let updated = 0;
    let skipped = 0;
    for (let i = 0; i < drafts.length; i += 10) {
      const chunk = drafts.slice(i, i + 10);
      await Promise.all(
        chunk.map(async (draft) => {
          const body = draft.ai_email_body;
          const phrase = lineFor(draft.language);
          if (!body || !body.trim() || body.includes(phrase)) {
            skipped += 1;
            return;
          }
          const newBody = insertAtPosition(body, phrase, position);
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

    return NextResponse.json({
      updated,
      skipped,
      total: drafts.length,
      en: hasForeign ? enLine : null,
    });
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
