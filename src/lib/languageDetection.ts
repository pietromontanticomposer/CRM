const normalizeString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const countMatches = (text: string, regexes: RegExp[]) =>
  regexes.reduce((sum, regex) => sum + (text.match(regex)?.length ?? 0), 0);

const ITALIAN_WORDS = new Set([
  "ciao",
  "buongiorno",
  "buonasera",
  "grazie",
  "gentile",
  "cordiali",
  "saluti",
  "per",
  "favore",
  "sono",
  "non",
  "con",
  "come",
  "anche",
  "quando",
  "dove",
  "quindi",
  "se",
  "abbiamo",
  "avete",
  "puoi",
  "potrei",
  "sarebbe",
  "scrivo",
  "contatto",
  "collaborazione",
  "proposta",
  "preventivo",
  "disponibile",
]);

const ENGLISH_WORDS = new Set([
  "hello",
  "hi",
  "thanks",
  "thank",
  "please",
  "best",
  "regards",
  "kind",
  "with",
  "not",
  "i",
  "you",
  "we",
  "they",
  "your",
  "our",
  "can",
  "could",
  "would",
  "should",
  "about",
  "project",
  "collaboration",
  "proposal",
  "available",
  "contact",
  "meeting",
  "schedule",
]);

const ITALIAN_PHRASES = [
  /\bcordiali saluti\b/g,
  /\bgrazie mille\b/g,
  /\bbuona giornata\b/g,
  /\ba presto\b/g,
  /\ble scrivo\b/g,
  /\bti ringrazio\b/g,
];

const ENGLISH_PHRASES = [
  /\bbest regards\b/g,
  /\bkind regards\b/g,
  /\bthank you\b/g,
  /\bthanks a lot\b/g,
  /\bhave a great day\b/g,
  /\blooking forward\b/g,
  /\bplease let me know\b/g,
];

const REPLY_BREAK_PATTERNS = [
  /^on .+wrote:$/i,
  /^il .+ha scritto:$/i,
  /^from:\s/i,
  /^da:\s/i,
  /^sent:\s/i,
  /^inviato:\s/i,
  /^subject:\s/i,
  /^oggetto:\s/i,
  /^-{2,}\s*original message\s*-{2,}$/i,
  /^-{2,}\s*messaggio originale\s*-{2,}$/i,
];

export const stripHtml = (value?: string | null) =>
  (value ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const extractLatestReplyChunk = (value: string) => {
  const lines = value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const kept: string[] = [];
  for (const line of lines) {
    if (line.startsWith(">")) continue;
    if (REPLY_BREAK_PATTERNS.some((pattern) => pattern.test(line))) break;
    kept.push(line);
    if (kept.length >= 24) break;
  }

  return kept.join(" ");
};

const tokenizeLanguageText = (text: string) =>
  text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\S+@\S+/g, " ")
    .replace(/[^a-zàèéìòù'\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);

const countWordHits = (tokens: string[], lexicon: Set<string>) =>
  tokens.reduce((sum, token) => sum + (lexicon.has(token) ? 1 : 0), 0);

export const detectLanguageFromEmail = (
  value?: string | null
): "it" | "en" | null => {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  const cleanText = extractLatestReplyChunk(normalized);
  if (!cleanText) return null;

  const lowerText = cleanText.toLowerCase();
  const tokens = tokenizeLanguageText(lowerText);
  if (tokens.length < 4) {
    return null;
  }

  let italianScore = countWordHits(tokens, ITALIAN_WORDS);
  let englishScore = countWordHits(tokens, ENGLISH_WORDS);

  italianScore += countMatches(lowerText, ITALIAN_PHRASES) * 2;
  englishScore += countMatches(lowerText, ENGLISH_PHRASES) * 2;

  if (/[àèéìòù]/.test(lowerText)) {
    italianScore += 2;
  }

  const totalScore = italianScore + englishScore;
  if (totalScore < 3) {
    return null;
  }

  const diff = Math.abs(italianScore - englishScore);
  if (diff < 2) {
    return null;
  }

  const lowerScore = Math.min(italianScore, englishScore);
  const higherScore = Math.max(italianScore, englishScore);
  if (lowerScore > 0 && higherScore / lowerScore < 1.4) {
    return null;
  }

  return italianScore > englishScore ? "it" : "en";
};
