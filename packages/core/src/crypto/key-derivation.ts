import { createHmac, scryptSync } from "node:crypto";
import type { DerivedKey, KeyDerivationParams } from "../types/crypto";
import { ARGON2_DEFAULTS, HKDF_INFO, KEY_LENGTH } from "./constants";
import { generateSalt } from "./random";

/**
 * Derive a master encryption key from a passphrase.
 *
 * Uses scrypt (memory-hard KDF) for deterministic key derivation from passphrase + salt,
 * then HKDF-SHA256 to extract the final 32-byte AES key.
 *
 * This is deterministic: same passphrase + same salt always produces the same key.
 */
export async function deriveMasterKey(
  passphrase: string,
  salt?: Buffer,
  params: KeyDerivationParams = ARGON2_DEFAULTS,
): Promise<DerivedKey> {
  const keySalt = salt ?? generateSalt();

  // Step 1: scrypt (memory-hard, deterministic)
  // Default: N=16384 (2^14), r=8, p=1 ≈ 16MB memory. Good balance of security and speed.
  const N = params.memoryCost;
  const r = 8;
  const p = params.parallelism;
  const scryptKey = scryptSync(passphrase, keySalt, 64, {
    N,
    r,
    p,
    maxmem: 128 * N * r * 2, // 2x the expected memory usage for safety margin
  });

  // Step 2: HKDF to extract the final AES-256 key
  const key = Buffer.from(
    hkdfSha256(scryptKey, keySalt, Buffer.from(HKDF_INFO.masterKey, "utf8"), KEY_LENGTH),
  );

  return { key, salt: keySalt };
}

/**
 * Derive a project-specific encryption key from the master key.
 * Uses HKDF with a project-specific salt to isolate each project's encryption scope.
 */
export function deriveProjectKey(masterKey: Buffer, projectSalt: Buffer): Buffer {
  return Buffer.from(
    hkdfSha256(masterKey, projectSalt, Buffer.from(HKDF_INFO.projectKey, "utf8"), KEY_LENGTH),
  );
}

function hkdfSha256(ikm: Buffer, salt: Buffer, info: Buffer, length: number): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  const blocks: Buffer[] = [];
  let previous = Buffer.alloc(0);
  let counter = 1;

  while (Buffer.concat(blocks).length < length) {
    previous = createHmac("sha256", prk)
      .update(previous)
      .update(info)
      .update(Buffer.from([counter]))
      .digest();
    blocks.push(previous);
    counter += 1;
  }

  return Buffer.concat(blocks).subarray(0, length);
}
