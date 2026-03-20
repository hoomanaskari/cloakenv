import { evaluatePassphrase, generatePassphrase } from "@cloakenv/core";
import type { Command } from "commander";

export function registerGeneratePassphraseCommand(program: Command): void {
  program
    .command("generate-passphrase")
    .description("Generate a random four-word passphrase")
    .option("--words <n>", "Number of words", "4")
    .action((options: { words: string }) => {
      const wordCount = parseInt(options.words, 10);
      const passphrase = generatePassphrase(wordCount);
      const strength = evaluatePassphrase(passphrase);

      console.log(`\n  ${passphrase}\n`);
      console.log(`  Strength: ${strength.score}/4`);
      console.log(`  Crack time (offline): ${strength.crackTimesDisplay.offlineSlowHashing}`);

      if (!strength.isAcceptable) {
        console.log("\n  Tip: Try more words for a stronger passphrase.");
      }
    });
}
