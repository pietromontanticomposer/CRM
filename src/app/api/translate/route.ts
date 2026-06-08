import { NextResponse } from "next/server";
import {
  isUnauthorizedError,
  requireCurrentUser,
} from "@/lib/server/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/translate { text, from?, to? }
// Traduzione GRATUITA (MyMemory, nessuna chiave, nessun costo). Usata solo per
// tradurre brevi frasi che Pietro scrive (es. la frase da aggiungere a tutte le
// mail). NON e' Writer/Validator/Research: e' un'utility dell'interfaccia.
export async function POST(request: Request) {
  try {
    await requireCurrentUser();
    const payload = (await request.json().catch(() => null)) as {
      text?: string;
      from?: string;
      to?: string;
    } | null;
    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "Testo mancante." }, { status: 400 });
    }
    const to = payload?.to === "it" ? "it" : "en";
    const from = payload?.from === "en" ? "en" : to === "en" ? "it" : "en";

    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
      text
    )}&langpair=${from}|${to}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "crm-next/1.0" },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: "Servizio di traduzione non disponibile." },
        { status: 502 }
      );
    }
    const data = (await res.json()) as {
      responseStatus?: number | string;
      responseData?: { translatedText?: string };
    };
    const translated = (data?.responseData?.translatedText ?? "").trim();
    const status = Number(data?.responseStatus);
    if (status !== 200 || !translated || /^[A-Z ]{12,}$/.test(translated)) {
      // MyMemory in rate-limit restituisce un avviso in maiuscolo invece della
      // traduzione: trattalo come fallito (l'utente scrivera' l'inglese a mano).
      return NextResponse.json(
        { error: "Traduzione non riuscita, scrivi l'inglese a mano." },
        { status: 502 }
      );
    }
    return NextResponse.json({ translated });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/translate failed", error);
    return NextResponse.json(
      { error: "Traduzione fallita." },
      { status: 500 }
    );
  }
}
