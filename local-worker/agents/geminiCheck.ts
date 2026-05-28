import {
  VALIDATOR_PROMPT_FILENAME,
  buildFailedResult,
  buildValidationPrompt,
  parseAgentOutput,
  runCommand,
  type AgentRunResult,
  type ValidationPacket,
} from "./shared";

const GEMINI_VALIDATOR_TIMEOUT_MS = 180_000;

export const runGeminiCheck = async (
  packet: ValidationPacket,
  workingDirectory: string
): Promise<AgentRunResult> => {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<AgentRunResult>((resolve) => {
    timer = setTimeout(
      () =>
        resolve(
          buildFailedResult(
            "gemini",
            `Timeout Gemini validator (${GEMINI_VALIDATOR_TIMEOUT_MS}ms).`
          )
        ),
      GEMINI_VALIDATOR_TIMEOUT_MS
    );
  });
  const work = (async (): Promise<AgentRunResult> => {
    try {
      const prompt = await buildValidationPrompt(
        VALIDATOR_PROMPT_FILENAME,
        packet
      );
      const args = ["-p", prompt, "-o", "text"];
      const model =
        process.env.GEMINI_VALIDATOR_MODEL?.trim() ||
        process.env.GEMINI_MODEL?.trim();
      if (model) {
        args.push("-m", model);
      }
      const result = await runCommand({
        command: "gemini",
        args,
        cwd: workingDirectory,
      });
      const rawOutput = result.stdout.trim() || result.stderr.trim();
      if (result.code !== 0) {
        return buildFailedResult(
          "gemini",
          `Gemini CLI exited with code ${result.code ?? "unknown"}.`,
          rawOutput
        );
      }
      return parseAgentOutput("gemini", rawOutput);
    } catch (error) {
      return buildFailedResult(
        "gemini",
        error instanceof Error ? error.message : "Gemini CLI non disponibile."
      );
    }
  })();
  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
