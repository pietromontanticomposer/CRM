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
    // Gemini CLI ha web grounding (Google Search) abilitato di default,
    // quindi puo' verificare i claim online senza flag aggiuntivi.
    const prompt = await buildValidationPrompt(
      VALIDATOR_PROMPT_FILENAME,
      packet
    );
    const args = ["-p", prompt, "-o", "text"];

    // GEMINI_VALIDATOR_MODEL prevale se settato (per usare gemini-2.5-flash
    // sui validatori e tenere il modello piu' lento solo per writer/enrichment).
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
};
