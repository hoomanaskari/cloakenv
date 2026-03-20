import { describe, expect, test } from "bun:test";
import { KEY_LENGTH } from "../../src/crypto/constants";
import { decrypt, encrypt } from "../../src/crypto/encryption";
import { randomBytesBuffer } from "../../src/crypto/random";

const testKey = randomBytesBuffer(KEY_LENGTH);

describe("AES-256-GCM Encryption", () => {
  test("encrypts and decrypts plaintext correctly", () => {
    const plaintext = "hello-world-secret-value";
    const payload = encrypt(plaintext, testKey);
    const decrypted = decrypt(payload, testKey);
    expect(decrypted).toBe(plaintext);
  });

  test("handles empty string", () => {
    const payload = encrypt("", testKey);
    const decrypted = decrypt(payload, testKey);
    expect(decrypted).toBe("");
  });

  test("handles unicode characters", () => {
    const plaintext = "こんにちは世界 🔐 émojis & spëcial çhars";
    const payload = encrypt(plaintext, testKey);
    const decrypted = decrypt(payload, testKey);
    expect(decrypted).toBe(plaintext);
  });

  test("handles long strings", () => {
    const plaintext = "x".repeat(100_000);
    const payload = encrypt(plaintext, testKey);
    const decrypted = decrypt(payload, testKey);
    expect(decrypted).toBe(plaintext);
  });

  test("produces different ciphertext for same plaintext (unique IV)", () => {
    const plaintext = "same-input";
    const a = encrypt(plaintext, testKey);
    const b = encrypt(plaintext, testKey);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.iv.equals(b.iv)).toBe(false);
  });

  test("produces correct IV length (12 bytes)", () => {
    const payload = encrypt("test", testKey);
    expect(payload.iv.length).toBe(12);
  });

  test("produces correct tag length (16 bytes)", () => {
    const payload = encrypt("test", testKey);
    expect(payload.tag.length).toBe(16);
  });

  test("throws on tampered ciphertext", () => {
    const payload = encrypt("secret", testKey);
    payload.ciphertext[0] ^= 0xff; // Flip a byte
    expect(() => decrypt(payload, testKey)).toThrow();
  });

  test("throws on tampered auth tag", () => {
    const payload = encrypt("secret", testKey);
    payload.tag[0] ^= 0xff;
    expect(() => decrypt(payload, testKey)).toThrow();
  });

  test("throws on tampered IV", () => {
    const payload = encrypt("secret", testKey);
    payload.iv[0] ^= 0xff;
    expect(() => decrypt(payload, testKey)).toThrow();
  });

  test("throws on wrong key", () => {
    const payload = encrypt("secret", testKey);
    const wrongKey = randomBytesBuffer(KEY_LENGTH);
    expect(() => decrypt(payload, wrongKey)).toThrow();
  });
});
