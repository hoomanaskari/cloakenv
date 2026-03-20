import { createHash } from "node:crypto";

export interface HibpResult {
  isPwned: boolean;
  count: number;
}

/**
 * Check if a passphrase has appeared in known data breaches.
 * Uses the Have I Been Pwned Passwords API with k-anonymity.
 * Only the first 5 characters of the SHA-1 hash are sent to the API.
 */
export async function checkPwnedPassphrase(passphrase: string): Promise<HibpResult> {
  const sha1 = createHash("sha1").update(passphrase).digest("hex").toUpperCase();

  const prefix = sha1.substring(0, 5);
  const suffix = sha1.substring(5);

  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: {
        "User-Agent": "CloakEnv-Password-Check",
      },
    });

    if (!response.ok) {
      // API error — fail open (don't block the user)
      return { isPwned: false, count: 0 };
    }

    const text = await response.text();

    for (const line of text.split("\n")) {
      const [hash, countStr] = line.trim().split(":");
      if (hash === suffix) {
        return { isPwned: true, count: parseInt(countStr, 10) };
      }
    }

    return { isPwned: false, count: 0 };
  } catch {
    // Network error — fail open
    return { isPwned: false, count: 0 };
  }
}
