import { describe, expect, test } from "bun:test";
import { parseEnvSpec } from "../../src/schema/parser";

const SAMPLE_SCHEMA = `# @defaultSensitive=true
# @defaultRequired=infer

# Application environment flag
# @type=enum(development, staging, production)
# @sensitive=false
NODE_ENV=development

# Server port
# @type=port
# @sensitive=false
PORT=3000

# Database connection string
# @type=url
# @required
# @sensitive
DATABASE_URL=

# Stripe secret key with prefix validation
# @type=string(startsWith=sk_)
# @required
# @sensitive
STRIPE_SECRET_KEY=

# Public key (not sensitive, safe for client bundles)
# @type=string(startsWith=pk_)
# @sensitive=false
STRIPE_PUBLISHABLE_KEY=
`;

describe("@env-spec Parser", () => {
  test("parses root decorators", () => {
    const result = parseEnvSpec(SAMPLE_SCHEMA);
    expect(result.rootDecorators.defaultSensitive).toBe(true);
    expect(result.rootDecorators.defaultRequired).toBe("infer");
  });

  test("parses all entries", () => {
    const result = parseEnvSpec(SAMPLE_SCHEMA);
    expect(result.entries.length).toBe(5);
    expect(result.entries.map((e) => e.key)).toEqual([
      "NODE_ENV",
      "PORT",
      "DATABASE_URL",
      "STRIPE_SECRET_KEY",
      "STRIPE_PUBLISHABLE_KEY",
    ]);
  });

  test("parses enum type", () => {
    const result = parseEnvSpec(SAMPLE_SCHEMA);
    const nodeEnv = result.entries[0];
    expect(nodeEnv.type?.name).toBe("enum");
    expect(Object.keys(nodeEnv.type?.params)).toContain("development");
    expect(Object.keys(nodeEnv.type?.params)).toContain("staging");
    expect(Object.keys(nodeEnv.type?.params)).toContain("production");
  });

  test("parses simple type", () => {
    const result = parseEnvSpec(SAMPLE_SCHEMA);
    const port = result.entries[1];
    expect(port.type?.name).toBe("port");
    expect(Object.keys(port.type?.params).length).toBe(0);
  });

  test("parses parameterized type", () => {
    const result = parseEnvSpec(SAMPLE_SCHEMA);
    const stripeKey = result.entries[3];
    expect(stripeKey.type?.name).toBe("string");
    expect(stripeKey.type?.params.startsWith).toBe("sk_");
  });

  test("parses sensitivity", () => {
    const result = parseEnvSpec(SAMPLE_SCHEMA);
    expect(result.entries[0].sensitive).toBe(false); // NODE_ENV
    expect(result.entries[2].sensitive).toBe(true); // DATABASE_URL
    expect(result.entries[4].sensitive).toBe(false); // STRIPE_PUBLISHABLE_KEY
  });

  test("parses required flag", () => {
    const result = parseEnvSpec(SAMPLE_SCHEMA);
    expect(result.entries[2].required).toBe(true); // DATABASE_URL
    expect(result.entries[3].required).toBe(true); // STRIPE_SECRET_KEY
  });

  test("parses default values", () => {
    const result = parseEnvSpec(SAMPLE_SCHEMA);
    expect(result.entries[0].defaultValue).toBe("development");
    expect(result.entries[1].defaultValue).toBe("3000");
    expect(result.entries[2].defaultValue).toBeNull(); // Empty
  });

  test("parses descriptions", () => {
    const result = parseEnvSpec(SAMPLE_SCHEMA);
    expect(result.entries[0].description).toBe("Application environment flag");
    expect(result.entries[2].description).toBe("Database connection string");
  });

  test("handles empty content", () => {
    const result = parseEnvSpec("");
    expect(result.entries.length).toBe(0);
  });

  test("handles content with no decorators", () => {
    const result = parseEnvSpec("API_KEY=abc123\nDB_HOST=localhost\n");
    expect(result.entries.length).toBe(2);
    expect(result.entries[0].key).toBe("API_KEY");
    expect(result.entries[0].defaultValue).toBe("abc123");
  });
});
