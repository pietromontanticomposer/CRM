const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_GROQ_TIMEOUT_MS = 30000;

const getRequiredEnv = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var ${key}`);
  return value;
};

const normalizeEnvValue = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const unquoted = trimmed.replace(/^(['"])(.*)\1$/, "$2").trim();
  return unquoted || null;
};

const getTimeoutMs = () => {
  const raw = Number(
    normalizeEnvValue(process.env.GROQ_TIMEOUT_MS) ?? DEFAULT_GROQ_TIMEOUT_MS
  );
  return Number.isFinite(raw) ? raw : DEFAULT_GROQ_TIMEOUT_MS;
};

const buildChatCompletionsUrl = (baseUrl: string) => {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
};

const isModelConfigurationError = (status: number, body: string) => {
  if (status !== 400 && status !== 404) return false;
  const message = body.toLowerCase();
  return (
    message.includes("model") &&
    (
      message.includes("not found") ||
      message.includes("does not exist") ||
      message.includes("unknown") ||
      message.includes("invalid") ||
      message.includes("unsupported")
    )
  );
};

export const callConfiguredAiChat = async (prompt: string) => {
  const apiKey = getRequiredEnv("GROQ_API_KEY");
  const baseUrl =
    normalizeEnvValue(process.env.GROQ_BASE_URL) ?? DEFAULT_GROQ_BASE_URL;
  const defaultModel = DEFAULT_GROQ_MODEL;
  const configuredModel = normalizeEnvValue(process.env.GROQ_MODEL);
  const timeoutMs = getTimeoutMs();
  const url = buildChatCompletionsUrl(baseUrl);
  const isGoogle = baseUrl.includes("generativelanguage.googleapis.com");

  const requestOnce = async (
    modelName: string,
    headerMode: "bearer" | "google"
  ) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (headerMode === "google") {
        headers["x-goog-api-key"] = apiKey;
      } else {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      response = await fetch(url, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
        }),
      });
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        throw new Error("AI timeout");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    const text = await response.text();
    return { response, text };
  };

  let activeModel = configuredModel ?? defaultModel;
  let attempt = await requestOnce(activeModel, "bearer");

  if (!attempt.response.ok && isGoogle) {
    const message = attempt.text.toLowerCase();
    const canTryPrefix =
      !activeModel.startsWith("models/") &&
      (attempt.response.status === 404 ||
        (
          message.includes("model") &&
          (
            message.includes("not found") ||
            message.includes("does not exist") ||
            message.includes("unknown")
          )
        ));

    if (canTryPrefix) {
      activeModel = `models/${activeModel}`;
      attempt = await requestOnce(activeModel, "bearer");
    }

    if (
      !attempt.response.ok &&
      (attempt.response.status === 401 || attempt.response.status === 403)
    ) {
      attempt = await requestOnce(activeModel, "google");
    }
  }

  if (
    !attempt.response.ok &&
    !isGoogle &&
    activeModel !== defaultModel &&
    isModelConfigurationError(attempt.response.status, attempt.text)
  ) {
    activeModel = defaultModel;
    attempt = await requestOnce(activeModel, "bearer");
  }

  if (!attempt.response.ok) {
    let message = attempt.text?.slice(0, 400) || "AI error";
    try {
      const parsed = JSON.parse(attempt.text) as { error?: { message?: string } };
      if (parsed?.error?.message) {
        message = parsed.error.message.slice(0, 400);
      }
    } catch {
      // ignore JSON parse failures and keep raw body
    }
    const error = new Error(`AI ${attempt.response.status}: ${message}`);
    (error as { status?: number }).status = attempt.response.status;
    throw error;
  }

  const payload = JSON.parse(attempt.text) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    model?: string;
  };
  const content = payload.choices?.[0]?.message?.content ?? "";

  return {
    raw: content,
    model: payload.model ?? activeModel,
  };
};
