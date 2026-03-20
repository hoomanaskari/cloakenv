import { resolve } from "node:path";
import {
  checkPwnedPassphrase,
  DEFAULT_CLOAKED_BACKUP_FILENAME,
  evaluatePassphrase,
  getProcessContext,
} from "@cloakenv/core";
import type { Command } from "commander";
import { formatSensitiveRequestError, invokeSensitiveRequest } from "../utils/approval-broker";
import { confirm } from "../utils/prompt";

export function registerExportCommand(program: Command): void {
  program
    .command("export")
    .description("Export vault to an encrypted .cloaked file")
    .option("--project <name>", "Export only a specific project")
    .option("--output <path>", "Output file path", DEFAULT_CLOAKED_BACKUP_FILENAME)
    .action(async (options: { project?: string; output: string }) => {
      // Get passphrase for encryption
      process.stdout.write("Enter export passphrase: ");
      const passphrase = readLine();
      if (!passphrase) {
        console.error("Passphrase is required for export.");
        process.exit(1);
      }

      // Check strength
      const strength = evaluatePassphrase(passphrase);
      if (!strength.isAcceptable) {
        console.error(`\nPassphrase too weak (score: ${strength.score}/4, required: 4/4).`);
        if (strength.feedback.warning) {
          console.error(`Warning: ${strength.feedback.warning}`);
        }
        if (strength.feedback.suggestions.length > 0) {
          console.error(`Suggestions: ${strength.feedback.suggestions.join(". ")}`);
        }
        console.error(
          "\nTip: Use a passphrase of 4+ random words (e.g., 'cloakenv generate-passphrase')",
        );
        process.exit(1);
      }

      const hibp = await checkPwnedPassphrase(passphrase);
      if (hibp.isPwned) {
        console.error(
          `\nWarning: this export passphrase appears in known data breaches (${hibp.count.toLocaleString()} match${hibp.count === 1 ? "" : "es"} in Have I Been Pwned).`,
        );
        console.error("Choose a fresh passphrase if you plan to keep this backup long-term.");

        if (process.stdin.isTTY && process.stdout.isTTY) {
          const shouldContinue = confirm("Continue with this passphrase anyway?", false);
          if (!shouldContinue) {
            console.error("Export cancelled.");
            process.exit(1);
          }
        }
      }

      const outputPath = resolve(options.output);
      const requester = getProcessContext();

      try {
        await invokeSensitiveRequest<{ path: string }>({
          kind: "export",
          requestId: crypto.randomUUID(),
          projectName: options.project,
          cwd: process.cwd(),
          requester,
          outputPath,
          passphrase,
        });
      } catch (error) {
        console.error(formatSensitiveRequestError(error));
        process.exit(1);
      }

      console.log(`\nExported to: ${outputPath}`);
      console.log("This file is safe to commit to Git or store anywhere.");
      console.log("Keep your passphrase secure — it's the only way to decrypt this file.");
    });
}

function readLine(): string | null {
  try {
    const buf = new Uint8Array(1024);
    const n = require("node:fs").readSync(0, buf);
    return new TextDecoder().decode(buf.subarray(0, n)).trim() || null;
  } catch {
    return null;
  }
}
