import { zxcvbn, zxcvbnOptions } from "@zxcvbn-ts/core";
import * as zxcvbnCommonPackage from "@zxcvbn-ts/language-common";
import * as zxcvbnEnPackage from "@zxcvbn-ts/language-en";

// Initialize zxcvbn with dictionaries
const options = {
  translations: zxcvbnEnPackage.translations,
  graphs: zxcvbnCommonPackage.adjacencyGraphs,
  dictionary: {
    ...zxcvbnCommonPackage.dictionary,
    ...zxcvbnEnPackage.dictionary,
  },
};

zxcvbnOptions.setOptions(options);

export interface StrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  crackTimesDisplay: {
    onlineThrottling: string;
    onlineNoThrottling: string;
    offlineSlowHashing: string;
    offlineFastHashing: string;
  };
  feedback: {
    warning: string;
    suggestions: string[];
  };
  isAcceptable: boolean;
}

/**
 * Evaluate passphrase strength using zxcvbn.
 * Returns score 0-4. CloakEnv requires score 4 for .cloaked exports.
 */
export function evaluatePassphrase(passphrase: string): StrengthResult {
  const result = zxcvbn(passphrase);

  return {
    score: result.score as 0 | 1 | 2 | 3 | 4,
    crackTimesDisplay: {
      onlineThrottling: String(result.crackTimesDisplay.onlineThrottling100PerHour),
      onlineNoThrottling: String(result.crackTimesDisplay.onlineNoThrottling10PerSecond),
      offlineSlowHashing: String(result.crackTimesDisplay.offlineSlowHashing1e4PerSecond),
      offlineFastHashing: String(result.crackTimesDisplay.offlineFastHashing1e10PerSecond),
    },
    feedback: {
      warning: result.feedback.warning ?? "",
      suggestions: result.feedback.suggestions ?? [],
    },
    isAcceptable: result.score >= 4,
  };
}
