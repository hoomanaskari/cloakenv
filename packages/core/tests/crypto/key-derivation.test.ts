import { describe, expect, test } from "bun:test";
import { KEY_LENGTH } from "../../src/crypto/constants";
import { deriveMasterKey, deriveProjectKey } from "../../src/crypto/key-derivation";
import { generateSalt } from "../../src/crypto/random";

// Use fast params for tests (N=1024 instead of 65536)
const FAST_PARAMS = { memoryCost: 1024, timeCost: 1, parallelism: 1 };

describe("Key Derivation", () => {
  test("deriveMasterKey produces 32-byte key", async () => {
    const { key, salt } = await deriveMasterKey("test-passphrase", undefined, FAST_PARAMS);
    expect(key.length).toBe(KEY_LENGTH);
    expect(salt.length).toBe(32);
  });

  test("same passphrase + same salt = same key", async () => {
    const salt = generateSalt();
    const a = await deriveMasterKey("my-passphrase", salt, FAST_PARAMS);
    const b = await deriveMasterKey("my-passphrase", salt, FAST_PARAMS);
    expect(a.key.equals(b.key)).toBe(true);
  });

  test("same passphrase + different salt = different key", async () => {
    const a = await deriveMasterKey("my-passphrase", generateSalt(), FAST_PARAMS);
    const b = await deriveMasterKey("my-passphrase", generateSalt(), FAST_PARAMS);
    expect(a.key.equals(b.key)).toBe(false);
  });

  test("different passphrase + same salt = different key", async () => {
    const salt = generateSalt();
    const a = await deriveMasterKey("passphrase-one", salt, FAST_PARAMS);
    const b = await deriveMasterKey("passphrase-two", salt, FAST_PARAMS);
    expect(a.key.equals(b.key)).toBe(false);
  });

  test("deriveProjectKey produces 32-byte key", async () => {
    const { key: masterKey } = await deriveMasterKey("test", undefined, FAST_PARAMS);
    const projectSalt = generateSalt();
    const projectKey = deriveProjectKey(masterKey, projectSalt);
    expect(projectKey.length).toBe(KEY_LENGTH);
  });

  test("different project salts produce different keys", async () => {
    const { key: masterKey } = await deriveMasterKey("test", undefined, FAST_PARAMS);
    const a = deriveProjectKey(masterKey, generateSalt());
    const b = deriveProjectKey(masterKey, generateSalt());
    expect(a.equals(b)).toBe(false);
  });
});
