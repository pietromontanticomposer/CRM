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

export const runCodexCheck = async (
  packet: ValidationPacket,
  workingDirectory: string
): Promise<AgentRunResult> => {
  let tempDirectory: string | null = null;

  try {
    const prompt = await buildValidationPrompt(
      VALIDATOR_PROMPT_FILENAME,
      packet
    );
    const tempFiles = await createSchemaTempFile();
    tempDirectory = tempFiles.directory;
    const outputFile = path.join(tempFiles.directory, "last-message.json");
    // Web access: il sandbox read-only blocca anche la rete su molte versioni
    // del CLI. workspace-write permette network ed e' sicuro perche' la dir
    // di lavoro e' temporanea.
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "--output-schema",
      tempFiles.file,
      "--output-last-message",
      outputFile,
      "-",
    ];

    if (process.env.CODEX_MODEL?.trim()) {
      args.splice(1, 0, "--model", process.env.CODEX_MODEL.trim());
    }

    const result = await runCommand({
      command: "codex",
      args,
      cwd: workingDirectory,
      stdin: prompt,
    });
    const fileOutput = await readFile(outputFile, "utf8").catch(() => "");
    const rawOutput = fileOutput.trim() || result.stdout.trim() || result.stderr.trim();

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
};
