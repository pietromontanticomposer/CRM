import {
  VALIDATOR_PROMPT_FILENAME,
  buildFailedResult,
  buildValidationPrompt,
  getInlineSchema,
  parseAgentOutput,
  runCommand,
  type AgentRunResult,
  type ValidationPacket,
} from "./shared";

export const runClaudeCheck = async (
  packet: ValidationPacket,
  workingDirectory: string
): Promise<AgentRunResult> => {
  try {
    const prompt = await buildValidationPrompt(
      VALIDATOR_PROMPT_FILENAME,
      packet
    );
    // Web access: WebSearch + WebFetch sono i tool di Claude per cercare
    // online e leggere pagine. Senza, il validatore non puo' verificare i
    // claim contro fonti pubbliche.
    const args = [
      "-p",
      prompt,
      "--allowedTools",
      "WebSearch",
      "WebFetch",
      "--permission-mode",
      "acceptEdits",
      "--output-format",
      "text",
      "--no-session-persistence",
      "--json-schema",
      getInlineSchema(),
    ];

    if (process.env.CLAUDE_MODEL?.trim()) {
      args.push("--model", process.env.CLAUDE_MODEL.trim());
    }

    const result = await runCommand({
      command: "claude",
      args,
      cwd: workingDirectory,
    });
    const rawOutput = result.stdout.trim() || result.stderr.trim();

    if (result.code !== 0) {
      return buildFailedResult(
        "claude",
        `Claude CLI exited with code ${result.code ?? "unknown"}.`,
        rawOutput
      );
    }

    return parseAgentOutput("claude", rawOutput);
  } catch (error) {
    return buildFailedResult(
      "claude",
      error instanceof Error ? error.message : "Claude CLI non disponibile."
    );
  }
};
