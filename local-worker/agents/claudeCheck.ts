import {
  VALIDATOR_PROMPT_FILENAME,
  buildFailedResult,
  buildValidationPrompt,
  parseAgentOutput,
  runCommand,
  type AgentRunResult,
  type ValidationPacket,
} from "./shared";

const CLAUDE_VALIDATOR_TIMEOUT_MS = 300_000;

export const runClaudeCheck = async (
  packet: ValidationPacket,
  workingDirectory: string,
  promptFileName: string = VALIDATOR_PROMPT_FILENAME
): Promise<AgentRunResult> => {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<AgentRunResult>((resolve) => {
    timer = setTimeout(
      () =>
        resolve(
          buildFailedResult(
            "claude",
            `Timeout Claude validator (${CLAUDE_VALIDATOR_TIMEOUT_MS}ms).`
          )
        ),
      CLAUDE_VALIDATOR_TIMEOUT_MS
    );
  });
  const work = (async (): Promise<AgentRunResult> => {
    try {
      const prompt = await buildValidationPrompt(promptFileName, packet);
      // Prompt via STDIN (non come argomento): su Windows la shell spezza un
      // argomento lungo/multi-riga e Claude riceve spazzatura. stdin e' sicuro
      // su Mac e Windows.
      const args = [
        "-p",
        "--allowedTools",
        "WebSearch",
        "WebFetch",
        "--permission-mode",
        "acceptEdits",
        "--output-format",
        "text",
        "--no-session-persistence",
      ];
      // Validatore = controllo incrociato anti-cazzate: deve essere il modello
      // PIÙ FORTE (scelta Pietro 2026-06-11), non quello economico. Default
      // Opus 4.8 (override via env). Nota: consuma molto più di Haiku/Sonnet,
      // ma gira solo sulle bozze con email CERTA (poche), quindi è sostenibile.
      const model =
        process.env.CLAUDE_VALIDATOR_MODEL?.trim() ||
        process.env.CLAUDE_MODEL?.trim() ||
        "claude-opus-4-8";
      args.push("--model", model);
      const result = await runCommand({
        command: "claude",
        args,
        cwd: workingDirectory,
        stdin: prompt,
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
  })();
  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
