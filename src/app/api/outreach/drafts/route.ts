import { NextResponse } from "next/server";
import { isUnauthorizedError, requireCurrentUser } from "@/lib/server/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseRest = () => {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
};

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser();
    const cfg = supabaseRest();
    if (!cfg) {
      return NextResponse.json(
        { error: "Missing SUPABASE env." },
        { status: 500 }
      );
    }
    const url = new URL(request.url);
    const batchId = url.searchParams.get("batchId");
    const filter = `owner_id=eq.${user.id}`;
    const batchFilter = batchId ? `&batch_id=eq.${batchId}` : "";
    const response = await fetch(
      `${cfg.url}/rest/v1/outreach_drafts?${filter}${batchFilter}&order=created_at.asc`,
      {
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
        },
      }
    );
    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: error || response.statusText },
        { status: response.status }
      );
    }
    const drafts = await response.json();
    return NextResponse.json({ drafts });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/outreach/drafts failed", error);
    return NextResponse.json(
      { error: "Impossibile caricare le draft." },
      { status: 500 }
    );
  }
}
