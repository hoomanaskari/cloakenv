# KDF Benchmark Baseline

This document records the current CloakEnv key-derivation baseline for the default local vault path.

## Current Choice

- KDF: `scrypt + HKDF-SHA256`
- `scrypt` params: `N=16384`, `r=8`, `p=1`
- Approximate `scrypt` memory cost: ~16 MiB
- HKDF info labels:
  - `cloakenv-master-key-v1`
  - `cloakenv-project-key-v1`

The intent is still interactive local use: strong enough to resist cheap brute force while keeping vault unlock and provider-driven secret access responsive on a developer workstation.

## Repeatable Benchmark

Run:

```bash
bun run kdf:benchmark
```

The script lives at [packages/core/scripts/benchmark-kdf.ts](/Users/hooman/Sites/cloakenv/packages/core/scripts/benchmark-kdf.ts) and prints a JSON snapshot with timing and machine metadata.

## Baseline Snapshot

Captured on March 13, 2026.

- Machine: Apple M4 Max
- OS: macOS 15.3 / Darwin 25.3.0
- Runtime: Bun 1.3.9
- Iterations: 10
- Warmups: 3

| Metric | Time |
| --- | --- |
| Min | 15.39 ms |
| Median | 15.84 ms |
| Mean | 15.80 ms |
| P95 | 15.99 ms |
| Max | 15.99 ms |

## Decision

This baseline does not justify changing the current KDF.

Reasons:

- ~16 ms mean derivation time is still comfortably interactive on current hardware.
- The current settings preserve the intended memory-hard behavior without noticeably degrading local CLI or provider workflows.
- There is no current evidence in this repo that moving to a heavier default or a different KDF would pay for its migration and compatibility cost.

## Revisit Triggers

Re-run the benchmark and revisit the defaults when one of these changes:

- the KDF implementation changes
- the passphrase/unlock path becomes noticeably slower in day-to-day use
- the supported hardware profile changes materially
- a security review produces a concrete recommendation to raise or lower the cost factors
