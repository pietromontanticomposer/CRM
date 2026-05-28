import {
  VALIDATOR_PROMPT_FILENAME,
  buildFailedResult,
  buildValidationPrompt,
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
    // Web access: WebSearch + WebFetch per verificare i claim contro fonti
    // pubbliche. NON usiamo --json-schema: con tool use attivo Claude a
    // volte mescola la risposta finale a output intermedio, e il vincolo
    // schema forzato puo' far svuotare l'output. Il parser robusto in
    // parseAgentOutput estrae comunque il JSON dal testo.
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
    ];

    const model =
      process.env.CLAUDE_VALIDATOR_MODEL?.trim() ||
      process.env.CLAUDE_MODEL?.trim();
    if (model) {
      args.push("--model", model);
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
