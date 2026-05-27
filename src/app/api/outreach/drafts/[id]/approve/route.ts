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

// POST /api/outreach/drafts/[id]/approve
// Promuove una draft outreach in un contact "reale" nella tabella contacts.
// Strategia: SELECT draft -> INSERT contact -> DELETE draft. Atomicita' non
// transazionale (PostgREST non supporta tx multi-statement), accettabile per
// questo workflow (worst case: draft cancellata + contact gia' inserito,
// nessuna perdita di dati).
export async function POST(_request: Request, context: RouteContext) {
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

    // 1. SELECT della draft
    const selectResponse = await fetch(
      `${cfg.url}/rest/v1/outreach_drafts?id=eq.${id}&owner_id=eq.${user.id}&select=*`,
      {
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
        },
      }
    );
    if (!selectResponse.ok) {
      const text = await selectResponse.text();
      return NextResponse.json(
        { error: text || selectResponse.statusText },
        { status: selectResponse.status }
      );
    }
    const drafts = (await selectResponse.json()) as Record<
      string,
      unknown
    >[];
    const draft = drafts[0];
    if (!draft) {
      return NextResponse.json(
        { error: "Draft non trovata." },
        { status: 404 }
      );
    }

    // 2. INSERT nel contacts. Mappa i campi della draft sulle colonne contacts.
    const contactPayload = {
      owner_id: user.id,
      name: draft.name,
      email: draft.email,
      company: draft.company,
      role: draft.role || "Regista",
      status: "Attiva auto follow-up",
      notes: draft.notes,
      last_action_at: null,
      section: draft.section,
      ai_batch_id: draft.batch_id,
      ai_batch_name: draft.batch_name,
      ai_status: "approved",
      ai_validation_status: "passed",
      ai_email_subject: draft.ai_email_subject,
      ai_email_body: draft.ai_email_body,
      ai_template_used: draft.ai_template_used,
      ai_link_visione: draft.ai_link_visione,
      ai_risk_score: draft.ai_risk_score,
      ai_send_allowed: draft.ai_send_allowed,
      ai_validation_summary: draft.ai_validation_summary,
      ai_agent_checks_json: draft.ai_agent_checks_json ?? {},
      verified_facts_json: draft.verified_facts_json ?? {},
      source_link: draft.source_link,
      prompt_master_rules: draft.prompt_master_rules,
      email_source_url: draft.email_source_url,
      email_source_type: draft.email_source_type,
      email_confidence: draft.email_confidence,
      email_enrichment_status: draft.email_enrichment_status,
      email_enrichment_reason: draft.email_enrichment_reason,
      email_found_at: draft.email_found_at,
    };

    const insertResponse = await fetch(`${cfg.url}/rest/v1/contacts`, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(contactPayload),
    });
    if (!insertResponse.ok) {
      const text = await insertResponse.text();
      return NextResponse.json(
        { error: text || insertResponse.statusText },
        { status: insertResponse.status }
      );
    }
    const insertedContacts = (await insertResponse.json()) as Record<
      string,
      unknown
    >[];
    const contact = insertedContacts[0] ?? null;

    // 3. DELETE della draft (dopo che l'insert ha avuto successo)
    await fetch(
      `${cfg.url}/rest/v1/outreach_drafts?id=eq.${id}&owner_id=eq.${user.id}`,
      {
        method: "DELETE",
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
        },
      }
    ).catch((deleteError) => {
      console.warn(
        "POST /api/outreach/drafts/[id]/approve: contact inserted but draft delete failed",
        deleteError
      );
    });

    return NextResponse.json({ contact });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/outreach/drafts/[id]/approve failed", error);
    return NextResponse.json(
      { error: "Promozione draft fallita." },
      { status: 500 }
    );
  }
}
