import { describe, expect, test } from "bun:test";
import { KEY_LENGTH } from "../../src/crypto/constants";
import { hmacKey } from "../../src/crypto/hmac";
import { randomBytesBuffer } from "../../src/crypto/random";

const testKey = randomBytesBuffer(KEY_LENGTH);

describe("HMAC-SHA256", () => {
  test("produces 32-byte hash", () => {
    const hash = hmacKey("TEST_KEY", testKey);
    expect(hash.length).toBe(32);
  });

  test("same input = same hash", () => {
    const a = hmacKey("DATABASE_URL", testKey);
    const b = hmacKey("DATABASE_URL", testKey);
    expect(a.equals(b)).toBe(true);
  });

  test("different input = different hash", () => {
    const a = hmacKey("KEY_A", testKey);
    const b = hmacKey("KEY_B", testKey);
    expect(a.equals(b)).toBe(false);
  });

  test("different key = different hash for same input", () => {
    const keyA = randomBytesBuffer(KEY_LENGTH);
    const keyB = randomBytesBuffer(KEY_LENGTH);
    const a = hmacKey("SAME_KEY", keyA);
    const b = hmacKey("SAME_KEY", keyB);
    expect(a.equals(b)).toBe(false);
  });
});
