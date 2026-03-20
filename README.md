# CloakEnv

**Your secrets, invisible to AI.**

An encrypted local secret provider for development. No plaintext `.env` files on disk. Native approval for sensitive access. Compatible with `@env-spec` and Varlock-style schemas.

---

## What CloakEnv Is

CloakEnv is a local-first, open-source alternative to using tools like 1Password CLI or AWS Secrets Manager just to handle development secrets on your own machine.

It stores secrets in an encrypted local vault and serves them to approved local processes through the desktop app, instead of leaving them in plaintext `.env` files.

Packaged desktop releases now bundle a matching standalone `cloakenv` CLI. First launch can install that command into your user `PATH` from inside the app, and later app updates automatically refresh app-managed CLI installs.

It is also intentionally compatible with the `@env-spec` schema format. That means:

- You can use CloakEnv directly through the CloakEnv CLI.
- You can keep a shared `.env.schema` contract that remains compatible with Varlock-style tooling.
- CloakEnv stays independently useful even if you never use Varlock.

## Why CloakEnv?

- **Local encrypted replacement for hosted dev secret backends** — good for local development without requiring cloud infrastructure.
- **No plaintext `.env` files on disk** — secrets are encrypted at rest in a local vault.
- **Desktop-owned approval boundary** — sensitive reads and secret injection require explicit native approval.
- **Auditability** — secret access is logged with request context.
- **Cross-runtime default** — the primary workflow is process injection, so Node, Python, Go, Ruby, and shell commands all fit.
- **`@env-spec` / Varlock compatibility** — shared schema contract without making Varlock a hard dependency.

## How You Use It

There are two intended modes:

1. **Direct CloakEnv workflow**

   Store secrets locally and run your app through CloakEnv:

   ```bash
   cloakenv run -- npm run dev
   cloakenv run -- python manage.py runserver
   cloakenv run -- go run ./cmd/api
   ```

2. **Schema-compatible workflow**

   Keep a shared `.env.schema` file in `@env-spec` format so the same project contract can be used by CloakEnv directly and by the supported Varlock integration path.

When the desktop app is unavailable, you can host the same provider contract in the terminal:

```bash
cloakenv provider start
```

For diagnostics:

```bash
cloakenv provider status

# Expire one lease by id
cloakenv provider expire <session-id>

# Or clear all live leases
cloakenv provider expire --all
```

## Quick Start

Install the CLI as `cloakenv`:

```bash
# Global package install
bun install -g @cloakenv/cli

# Or build from this checkout
bun install
bun run cli:build
./apps/cli/dist/index.js --help

# Initialize the vault
cloakenv init

# Store a secret
cloakenv set DATABASE_URL=postgres://localhost:5432/mydb

# List keys
cloakenv list

# Run an app with approved secret injection
cloakenv run -- npm run dev

# Or host the provider in the foreground
cloakenv provider start
```

Standalone binaries are built from the same entrypoint:

```bash
bun run cli:build:standalone:darwin-arm64
./apps/cli/dist/bin/cloakenv-darwin-arm64 --help
```

Installer and release builds are produced into `artifacts/`:

```bash
bun run release:build
```

On supported packaged desktop builds, the first-launch onboarding flow can also install the bundled `cloakenv` command into your terminal `PATH` without dropping into the shell.

## How It Works

```text
Developer or local adapter
        |
        v
  CloakEnv CLI / future client
        |
        v
Local provider socket (desktop-owned)
        |
        v
Native approval dialog
        |
        v
Encrypted SQLite vault
        |
        v
Approved child process / approved env map
```

The important architectural point is that the desktop app owns the approval and secret-serving boundary. The CLI is a client of that boundary, not the trusted execution authority.

## Provider API

Provider API v1 is the stable local contract for approved secret access. It uses newline-delimited JSON over the desktop-owned socket or named pipe and currently exposes:

- `status` for provider diagnostics and active approval-session visibility.
- `resolve_environment` returns `{ projectId, projectName, env }` after native approval.
- `run_process` resolves the environment and streams `run_started`, `stdout`, `stderr`, and `run_exit` messages for the approved child process.

The built-in `cloakenv run` command now uses `resolve_environment` and then launches the target command locally. That keeps long-running dev servers alive if the desktop UI exits after approval, while the provider still owns approval and env resolution.

When repeated dev-server restarts become noisy, the provider can hold a short-lived approval session for matching `run_process` or `resolve_environment` requests. The lease stays bound to the same project, scope, folder, and requester command fingerprint.

See [docs/provider-api.md](docs/provider-api.md) for the wire protocol, [docs/provider-client-contract.md](docs/provider-client-contract.md) for adapter expectations and non-Node client guidance, and [docs/reference-examples.md](docs/reference-examples.md) for concrete `package.json`, Python, Go, and shell workflows.

## Security Model

| Layer | Protection |
|-------|------------|
| **Encryption at rest** | AES-256-GCM |
| **Key derivation** | scrypt + HKDF-SHA256 |
| **Local key storage** | OS keychain / secret service / credential manager |
| **Transport** | Unix domain socket or Windows named pipe |
| **Approval** | Native per-request approval for sensitive actions |
| **Execution** | Desktop app executes approved sensitive operations |
| **Audit** | Request / grant / deny / execute logging |
| **Primary defense** | No plaintext `.env` file on disk |

See [docs/kdf-benchmark.md](docs/kdf-benchmark.md) for the current benchmark baseline and the repeatable benchmark script.

## How It Fits With Varlock

CloakEnv and Varlock should be complementary:

- **Varlock** is the schema-driven runtime and developer-experience layer.
- **CloakEnv** is the encrypted local storage, approval, audit, and local secret-provider layer.
- **`@env-spec`** is the shared contract between them.

Current repo status:

- Schema export/import/diff/validate flows already exist.
- CloakEnv direct usage already exists through `run`, `get`, `history`, and related commands.
- Foreground provider mode now exists through `cloakenv provider start`.
- Official Varlock integration paths now exist through `@cloakenv/varlock-adapter`, `@cloakenv/varlock-helper`, and [docs/varlock-integration.md](docs/varlock-integration.md).
- The schema-driven `@cloakenv/varlock-helper` path now batch-resolves one approved environment per Varlock run instead of prompting once per secret.

## Current Scope

CloakEnv is deliberately trying to be a small, focused product:

- It should own local vault storage, backup, approval, audit, and secret serving.
- It should keep a minimal CLI.
- It should not try to rebuild every Varlock runtime feature inside CloakEnv.
- It should keep project boundaries explicit; cross-project secret references remain out of scope unless the provider model proves they are necessary.

## Project Structure

```text
cloakenv/
├── packages/core/   # Encryption, vault, schema, provider protocol types
├── packages/varlock-adapter/  # Varlock-oriented provider preload helper
├── packages/varlock-helper/   # Varlock schema exec helper for `varlock run`
├── apps/cli/        # Minimal CloakEnv CLI client
├── apps/web/        # React desktop UI
└── src/bun/         # ElectroBun desktop main process and local provider service
```

## Development

```bash
# Install dependencies
bun install

# Run all tests
bun test --recursive

# Build release installers and the standalone CLI artifact for the current platform
bun run release:build

# Run the desktop app
bun run dev

# Run the web UI only
bun run dev:web

# Use the CLI from source
bun run cli -- --help
```

## Backup and Recovery

Encrypted backups use the `.cloaked` format. The default filename is `vault.env.cloaked`.

```bash
# Export
bun run cli -- export

# Import
bun run cli -- import /path/to/vault.env.cloaked
```

## Schema Support

CloakEnv uses the `@env-spec` schema format.

```bash
# Generate schema from the current project
bun run cli -- schema export

# Bootstrap from an existing schema
bun run cli -- schema import

# Compare schema and vault state
bun run cli -- schema diff

# Validate stored values against schema rules
bun run cli -- schema validate
```

Imported schema entries are stored project-wide even when no secret value exists yet, so the desktop UI and CLI can manage schema-only fields as part of the vault contract.

## License

MIT — see [LICENSE](LICENSE).

---

*Built for local development. No cloud requirement. No plaintext secret files. No need to choose between direct use and schema compatibility.*
