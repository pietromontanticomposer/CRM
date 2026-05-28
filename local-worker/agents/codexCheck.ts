import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  VALIDATOR_PROMPT_FILENAME,
  buildFailedResult,
  buildValidationPrompt,
  cleanupTempDirectory,
  createSchemaTempFile,
  parseAgentOutput,
  runCommand,
  type AgentRunResult,
  type ValidationPacket,
} from "./shared";

const CODEX_VALIDATOR_TIMEOUT_MS = 240_000;

export const runCodexCheck = async (
  packet: ValidationPacket,
  workingDirectory: string
): Promise<AgentRunResult> => {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<AgentRunResult>((resolve) => {
    timer = setTimeout(
      () =>
        resolve(
          buildFailedResult(
            "codex",
            `Timeout Codex validator (${CODEX_VALIDATOR_TIMEOUT_MS}ms).`
          )
        ),
      CODEX_VALIDATOR_TIMEOUT_MS
    );
  });
  const work = (async (): Promise<AgentRunResult> => {
    let tempDirectory: string | null = null;
    try {
      const prompt = await buildValidationPrompt(
        VALIDATOR_PROMPT_FILENAME,
        packet
      );
      const tempFiles = await createSchemaTempFile();
      tempDirectory = tempFiles.directory;
      const outputFile = path.join(tempFiles.directory, "last-message.json");
      const args = [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "--output-last-message",
        outputFile,
        "-",
      ];
      const model =
        process.env.CODEX_VALIDATOR_MODEL?.trim() ||
        process.env.CODEX_MODEL?.trim();
      if (model) {
        args.splice(1, 0, "--model", model);
      }
      const result = await runCommand({
        command: "codex",
        args,
        cwd: workingDirectory,
        stdin: prompt,
      });
      const fileOutput = await readFile(outputFile, "utf8").catch(() => "");
      const rawOutput =
        fileOutput.trim() || result.stdout.trim() || result.stderr.trim();
      if (result.code !== 0) {
        return buildFailedResult(
          "codex",
          `Codex CLI exited with code ${result.code ?? "unknown"}.`,
          rawOutput
        );
      }
      return parseAgentOutput("codex", rawOutput);
    } catch (error) {
      return buildFailedResult(
        "codex",
        error instanceof Error ? error.message : "Codex CLI non disponibile."
      );
    } finally {
      if (tempDirectory) {
        await cleanupTempDirectory(tempDirectory);
      }
    }
  })();
  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
