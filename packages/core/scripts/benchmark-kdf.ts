import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { KDF_DEFAULTS } from "../src/crypto/constants";
import { deriveMasterKey } from "../src/crypto/key-derivation";

interface BenchmarkResult {
  iterations: number;
  warmups: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
}

const warmups = readIntegerFlag("--warmups", 3);
const iterations = readIntegerFlag("--iterations", 10);

await main();

async function main(): Promise<void> {
  const samples: number[] = [];

  for (let index = 0; index < warmups; index += 1) {
    await deriveOnce();
  }

  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    await deriveOnce();
    samples.push(performance.now() - start);
  }

  const result = summarize(samples, iterations, warmups);
  const output = {
    capturedAt: new Date().toISOString(),
    runtime: `Bun ${Bun.version}`,
    platform: `${process.platform} ${process.arch}`,
    cpu: cpus()[0]?.model ?? "Unknown CPU",
    params: {
      kdf: "scrypt + HKDF-SHA256",
      memoryCost: KDF_DEFAULTS.memoryCost,
      blockSize: 8,
      parallelism: KDF_DEFAULTS.parallelism,
      derivedBytes: 64,
    },
    result,
  };

  console.log(JSON.stringify(output, null, 2));
}

async function deriveOnce(): Promise<void> {
  await deriveMasterKey("benchmark-passphrase");
}

function summarize(
  samples: number[],
  iterationsCount: number,
  warmupCount: number,
): BenchmarkResult {
  const sorted = [...samples].sort((left, right) => left - right);
  const total = samples.reduce((sum, sample) => sum + sample, 0);
  return {
    iterations: iterationsCount,
    warmups: warmupCount,
    minMs: round(sorted[0] ?? 0),
    maxMs: round(sorted[sorted.length - 1] ?? 0),
    meanMs: round(total / Math.max(samples.length, 1)),
    medianMs: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
  };
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }

  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1));
  return values[index] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function readIntegerFlag(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return fallback;
  }

  const rawValue = process.argv[index + 1];
  const parsed = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
