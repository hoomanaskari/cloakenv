import { randomInt } from "node:crypto";
import { WORDLIST } from "./wordlist";

/**
 * Generate a random passphrase from the curated word list.
 * Default: 4 words separated by hyphens.
 */
export function generatePassphrase(wordCount = 4): string {
  const words: string[] = [];

  for (let i = 0; i < wordCount; i++) {
    const index = randomInt(0, WORDLIST.length);
    words.push(WORDLIST[index]);
  }

  return words.join("-");
}
