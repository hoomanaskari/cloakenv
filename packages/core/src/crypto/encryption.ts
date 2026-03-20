import { createCipheriv, createDecipheriv } from "node:crypto";
import type { EncryptedPayload } from "../types/crypto";
import { ALGORITHM, TAG_LENGTH } from "./constants";
import { generateIv } from "./random";

/**
 * Encrypt plaintext using AES-256-GCM.
 * Each call generates a unique IV, so the same plaintext produces different ciphertext.
 */
export function encrypt(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = generateIv();
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  const tag = cipher.getAuthTag();

  return { ciphertext, iv, tag };
}

/**
 * Decrypt an AES-256-GCM encrypted payload.
 * Throws if the ciphertext, IV, or auth tag have been tampered with.
 */
export function decrypt(payload: EncryptedPayload, key: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, key, payload.iv, {
    authTagLength: TAG_LENGTH,
  });

  decipher.setAuthTag(payload.tag);

  const plaintext = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);

  return plaintext.toString("utf8");
}
