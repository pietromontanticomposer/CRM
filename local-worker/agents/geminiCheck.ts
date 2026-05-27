import {
  VALIDATOR_PROMPT_FILENAME,
  buildFailedResult,
  buildValidationPrompt,
  parseAgentOutput,
  runCommand,
  type AgentRunResult,
  type ValidationPacket,
} from "./shared";

export const runGeminiCheck = async (
  packet: ValidationPacket,
  workingDirectory: string
): Promise<AgentRunResult> => {
  try {
    const prompt = await buildValidationPrompt(
      VALIDATOR_PROMPT_FILENAME,
      packet
    );
    const args = ["-p", prompt, "-o", "text"];

    if (process.env.GEMINI_MODEL?.trim()) {
      args.push("-m", process.env.GEMINI_MODEL.trim());
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
};
