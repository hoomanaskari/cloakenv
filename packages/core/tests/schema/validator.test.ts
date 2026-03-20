import { describe, expect, test } from "bun:test";
import { validateValue } from "../../src/schema/validator";

describe("Schema Validator", () => {
  test("validates string type with startsWith", () => {
    const type = { name: "string", params: { startsWith: "sk_" } };
    expect(validateValue("sk_test_123", type).valid).toBe(true);
    expect(validateValue("pk_test_123", type).valid).toBe(false);
  });

  test("validates string type with minLength", () => {
    const type = { name: "string", params: { minLength: "5" } };
    expect(validateValue("abcde", type).valid).toBe(true);
    expect(validateValue("abc", type).valid).toBe(false);
  });

  test("validates number type", () => {
    const type = { name: "number", params: {} };
    expect(validateValue("42", type).valid).toBe(true);
    expect(validateValue("3.14", type).valid).toBe(true);
    expect(validateValue("not-a-number", type).valid).toBe(false);
  });

  test("validates number with range", () => {
    const type = { name: "number", params: { min: "0", max: "100" } };
    expect(validateValue("50", type).valid).toBe(true);
    expect(validateValue("150", type).valid).toBe(false);
    expect(validateValue("-5", type).valid).toBe(false);
  });

  test("validates boolean type", () => {
    const type = { name: "boolean", params: {} };
    expect(validateValue("true", type).valid).toBe(true);
    expect(validateValue("false", type).valid).toBe(true);
    expect(validateValue("1", type).valid).toBe(true);
    expect(validateValue("maybe", type).valid).toBe(false);
  });

  test("validates url type", () => {
    const type = { name: "url", params: {} };
    expect(validateValue("https://example.com", type).valid).toBe(true);
    expect(validateValue("not-a-url", type).valid).toBe(false);
  });

  test("validates enum type", () => {
    const type = {
      name: "enum",
      params: { development: "true", staging: "true", production: "true" },
    };
    expect(validateValue("development", type).valid).toBe(true);
    expect(validateValue("testing", type).valid).toBe(false);
  });

  test("validates email type", () => {
    const type = { name: "email", params: {} };
    expect(validateValue("user@example.com", type).valid).toBe(true);
    expect(validateValue("not-email", type).valid).toBe(false);
  });

  test("validates port type", () => {
    const type = { name: "port", params: {} };
    expect(validateValue("3000", type).valid).toBe(true);
    expect(validateValue("80", type).valid).toBe(true);
    expect(validateValue("99999", type).valid).toBe(false);
    expect(validateValue("abc", type).valid).toBe(false);
  });

  test("validates uuid type", () => {
    const type = { name: "uuid", params: {} };
    expect(validateValue("550e8400-e29b-41d4-a716-446655440000", type).valid).toBe(true);
    expect(validateValue("not-a-uuid", type).valid).toBe(false);
  });

  test("validates semver type", () => {
    const type = { name: "semver", params: {} };
    expect(validateValue("1.2.3", type).valid).toBe(true);
    expect(validateValue("1.0.0-beta.1", type).valid).toBe(true);
    expect(validateValue("not-semver", type).valid).toBe(false);
  });

  test("unknown types pass validation", () => {
    const type = { name: "custom_type", params: {} };
    expect(validateValue("anything", type).valid).toBe(true);
  });
});
