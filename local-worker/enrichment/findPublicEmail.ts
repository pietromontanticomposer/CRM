import { runCommand } from "../agents/shared";

export type EnrichmentInput = {
  name: string;
  company: string | null;
  source_link: string | null;
  notes: string | null;
  city: string | null;
  language: string | null;
};

export type EnrichmentStatus =
  | "not_needed"
  | "found_public"
  | "needs_review"
  | "not_found"
  | "error";

export type EnrichmentResult = {
  email: string | null;
  source_url: string | null;
  source_type: string | null;
  confidence: number;
  status: EnrichmentStatus;
  reason: string;
  found_at: string | null;
};

const EMAIL_REGEX =
  /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

const FETCH_TIMEOUT_MS = 8000;
const GEMINI_TIMEOUT_MS = 30000;
const FETCH_USER_AGENT =
  "Mozilla/5.0 (compatible; PietroCRMBot/1.0; +https://pietromontanti.com)";

const JUNK_EMAIL_SUFFIXES = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
];

const PUBLIC_EXAMPLE_DOMAINS = new Set([
  "example.com",
  "example.org",
  "domain.com",
  "yourdomain.com",
  "test.com",
  "email.com",
  "sentry.io",
  "wixpress.com",
  "wix.com",
]);

const looksLikeRealEmail = (raw: string): string | null => {
  const lower = raw.toLowerCase().trim();
  if (!lower) return null;
  if (JUNK_EMAIL_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return null;
  if (lower.includes("..")) return null;
  const [, domain] = lower.split("@");
  if (!domain) return null;
  if (PUBLIC_EXAMPLE_DOMAINS.has(domain)) return null;
  if (/sentry|wixpress|cdn|static|assets|noreply|no-reply|donotreply/.test(lower))
    return null;
  return lower;
};

const fetchWithTimeout = async (url: string): Promise<string | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": FETCH_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const text = await response.text();
    return text.slice(0, 500_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

const extractEmailsFromHtml = (html: string): string[] => {
  const emails = new Set<string>();
  const mailtoRegex = /mailto:([^"'?\s<>]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = mailtoRegex.exec(html)) !== null) {
    const candidate = looksLikeRealEmail(decodeURIComponent(match[1]));
    if (candidate) emails.add(candidate);
  }
  EMAIL_REGEX.lastIndex = 0;
  while ((match = EMAIL_REGEX.exec(html)) !== null) {
    const candidate = looksLikeRealEmail(match[1]);
    if (candidate) emails.add(candidate);
  }
  return [...emails];
};

const tokenize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const scoreEmail = (
  email: string,
  input: EnrichmentInput,
  sourceUrl: string
): { score: number; sourceType: string; reason: string } => {
  const [local, domain] = email.split("@");
  const nameTokens = tokenize(input.name);
  const companyTokens = input.company ? tokenize(input.company) : [];
  const localTokens = tokenize(local);

  const sharesNameToken = nameTokens.some(
    (token) => token.length >= 3 && localTokens.includes(token)
  );
  const sharesCompanyToken = companyTokens.some(
    (token) => token.length >= 3 && domain.includes(token)
  );
  const isGenericLocal = /^(info|hello|ciao|contact|contatti|press|stampa|booking|management|office|studio|admin|mail)$/i.test(
    local
  );
  const sourceUrlLower = sourceUrl.toLowerCase();

  if (sharesNameToken) {
    return {
      score: 0.92,
      sourceType: "official_site",
      reason: "Email contiene nome regista, fonte ufficiale.",
    };
  }
  if (sharesCompanyToken && isGenericLocal) {
    return {
      score: 0.6,
      sourceType: "production",
      reason: "Email generica della produzione collegata al regista.",
    };
  }
  if (sharesCompanyToken) {
    return {
      score: 0.78,
      sourceType: "production",
      reason: "Email di dominio produzione coerente col regista.",
    };
  }
  if (isGenericLocal) {
    return {
      score: 0.52,
      sourceType: sourceUrlLower.includes("imdb")
        ? "imdb"
        : sourceUrlLower.includes("vimeo")
        ? "vimeo"
        : sourceUrlLower.includes("filmfreeway")
        ? "filmfreeway"
        : "official_site",
      reason: "Email generica ufficiale, fonte sito ufficiale.",
    };
  }
  return {
    score: 0.4,
    sourceType: "unverified",
    reason: "Email trovata ma coerenza con il destinatario non confermata.",
  };
};

const buildCandidateUrls = (sourceLink: string | null): string[] => {
  if (!sourceLink) return [];
  const urls = new Set<string>();
  urls.add(sourceLink);
  try {
    const url = new URL(sourceLink);
    const origin = `${url.protocol}//${url.host}`;
    [
      "",
      "/contact",
      "/contacts",
      "/contatti",
      "/contatto",
      "/about",
      "/about-us",
      "/chi-siamo",
      "/press",
      "/stampa",
      "/info",
    ].forEach((path) => urls.add(`${origin}${path}`));
  } catch {
    // ignore invalid URL
  }
  return [...urls];
};

const searchByFetch = async (
  input: EnrichmentInput
): Promise<EnrichmentResult | null> => {
  const candidateUrls = buildCandidateUrls(input.source_link);
  if (candidateUrls.length === 0) return null;

  let best: EnrichmentResult | null = null;
  for (const url of candidateUrls) {
    const html = await fetchWithTimeout(url);
    if (!html) continue;
    const emails = extractEmailsFromHtml(html);
    for (const email of emails) {
      const scored = scoreEmail(email, input, url);
      if (scored.score < 0.5) continue;
      const candidate: EnrichmentResult = {
        email,
        source_url: url,
        source_type: scored.sourceType,
        confidence: scored.score,
        status: scored.score >= 0.5 ? "found_public" : "needs_review",
        reason: scored.reason,
        found_at: new Date().toISOString(),
      };
      if (!best || candidate.confidence > best.confidence) {
        best = candidate;
      }
      if (best.confidence >= 0.85) return best;
    }
  }
  return best;
};

const buildGeminiPrompt = (input: EnrichmentInput): string => {
  const lines = [
    "Devi trovare UNA singola email pubblica del regista o filmmaker indicato.",
    "Cerca solo fonti pubbliche e verificabili.",
    "Non inventare email. Se non sei sicuro restituisci found:false.",
    "Restituisci SOLO JSON valido, senza markdown.",
    "",
    "Dati contatto:",
    JSON.stringify(input, null, 2),
    "",
    "Schema di output obbligatorio:",
    '{"found": true, "email": "...", "source_url": "...", "source_type": "official_site|production|festival|imdb|vimeo|filmfreeway|other", "reason": "..."}',
    "oppure:",
    '{"found": false, "reason": "..."}',
  ];
  return lines.join("\n");
};

const parseGeminiResponse = (raw: string): {
  found: boolean;
  email?: string;
  source_url?: string;
  source_type?: string;
  reason?: string;
} | null => {
  const trimmed = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
};

const searchByGeminiCli = async (
  input: EnrichmentInput,
  workingDirectory: string
): Promise<EnrichmentResult | null> => {
  if (process.env.ENRICHMENT_DISABLE_GEMINI === "1") return null;
  const prompt = buildGeminiPrompt(input);
  const args = ["-p", prompt, "-o", "text"];
  if (process.env.GEMINI_MODEL?.trim()) {
    args.push("-m", process.env.GEMINI_MODEL.trim());
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    let result;
    try {
      result = await runCommand({
        command: "gemini",
        args,
        cwd: workingDirectory,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (result.code !== 0) return null;
    const raw = result.stdout.trim() || result.stderr.trim();
    const parsed = parseGeminiResponse(raw);
    if (!parsed || !parsed.found || !parsed.email) return null;
    const email = looksLikeRealEmail(parsed.email);
    if (!email) return null;
    const scored = scoreEmail(email, input, parsed.source_url ?? "gemini_cli");
    const confidence = Math.min(scored.score, 0.7);
    return {
      email,
      source_url: parsed.source_url ?? null,
      source_type: parsed.source_type ?? scored.sourceType,
      confidence,
      status: confidence >= 0.5 ? "found_public" : "needs_review",
      reason: parsed.reason ?? scored.reason,
      found_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
};

export const findPublicEmail = async (
  input: EnrichmentInput,
  workingDirectory: string
): Promise<EnrichmentResult> => {
  const trimmedName = input.name?.trim();
  if (!trimmedName) {
    return {
      email: null,
      source_url: null,
      source_type: null,
      confidence: 0,
      status: "not_found",
      reason: "Nome destinatario mancante, enrichment impossibile.",
      found_at: null,
    };
  }

  try {
    const direct = await searchByFetch(input);
    if (direct && direct.email) return direct;

    const viaGemini = await searchByGeminiCli(input, workingDirectory);
    if (viaGemini && viaGemini.email) return viaGemini;
  } catch (error) {
    return {
      email: null,
      source_url: null,
      source_type: null,
      confidence: 0,
      status: "error",
      reason: error instanceof Error ? error.message : "Errore enrichment.",
      found_at: null,
    };
  }

  return {
    email: null,
    source_url: null,
    source_type: null,
    confidence: 0,
    status: "not_found",
    reason: "Nessuna email pubblica trovata su fonti accessibili.",
    found_at: null,
  };
};
