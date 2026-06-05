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

// 210s: i completamenti legittimi stanno entro ~120s. Se codex entra nel suo
// stato "appeso" (loop di tool / ragionamento), meglio fallire in 3,5 min che
// in 6: gemini+claude (affidabili, anch'essi con web) reggono la verifica e
// l'aggregatore gestisce un codex failed come non-approvato.
const CODEX_VALIDATOR_TIMEOUT_MS = 210_000;

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
      // model_reasoning_effort=medium: il default GLOBALE di Pietro e' "xhigh"
      // (il piu' lento). Lo forziamo a medium: basta per controllare claim.
      // tools.web_search=true: il validatore DEVE poter verificare online.
      // --output-schema: vincola la risposta finale allo schema JSON. Oltre a
      //   garantire output parsabile, IMPEDISCE a codex di divagare/loopare
      //   all'infinito (era la causa dei timeout intermittenti a 360s: il
      //   modello entrava in un loop di tool/ragionamento senza un formato di
      //   uscita obbligato).
      // --ephemeral: niente file di sessione su disco (CODEX_HOME di Pietro ha
      //   75MB di logs + 28MB di state); riduce I/O e contaminazione.
      const args = [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        // Su Windows la sandbox OS-level di Codex (workspace-write) spesso non e'
        // supportata e Codex esce in errore: li' usiamo danger-full-access (gira
        // sulla macchina locale di Pietro, accettabile). Mac/Linux invariati.
        process.platform === "win32" ? "danger-full-access" : "workspace-write",
        "--ephemeral",
        "-c",
        "model_reasoning_effort=medium",
        "-c",
        "tools.web_search=true",
        "--output-schema",
        tempFiles.file,
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
