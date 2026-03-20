import { createHmac } from "node:crypto";
import { HMAC_ALGORITHM } from "./constants";

/**
 * Compute HMAC-SHA256 of a plaintext key name using the project key.
 * Used for O(1) secret lookups without decrypting all rows.
 */
export function hmacKey(plaintext: string, key: Buffer): Buffer {
  return createHmac(HMAC_ALGORITHM, key).update(plaintext).digest();
}
