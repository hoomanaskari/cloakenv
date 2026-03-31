# CloakEnv

**Your secrets, invisible to AI.**

CloakEnv is a local-first desktop app and CLI for development secrets. It keeps secrets encrypted in a local vault, asks for approval before sensitive reads, and injects approved values into local processes without relying on plaintext `.env` files.

If you are evaluating the project for the first time, start with [Quick Start](#quick-start).

## What It Does

- Stores secrets in an encrypted local vault.
- Backs up vault changes to an encrypted `.cloaked` file in a folder you choose.
- Serves approved secrets to local processes through a local provider socket or named pipe.
- Lets you run existing commands through `cloakenv run -- ...`.
- Supports shared `.env.schema` files in `@env-spec` format.
- Works with direct CloakEnv usage and the Varlock integration path in this repo.

## Current Status

The repo already includes:

- A desktop app built with ElectroBun and a React UI.
- A standalone `cloakenv` CLI.
- Local provider mode with desktop approvals or terminal approvals.
- Project detection, scoped environments, audit logs, backup/import/export, and schema workflows.
- Varlock bridge packages in `packages/varlock-adapter` and `packages/varlock-helper`.

What it is not:

- A hosted secret manager.
- A cloud sync service.
- A replacement for every runtime feature in Varlock.

## Quick Start

### Option A: use a packaged desktop build

1. Launch the CloakEnv app.
2. Complete onboarding:
   - choose a backup directory
   - set an auto-backup passphrase
   - optionally install the bundled `cloakenv` command into your `PATH`
   - optionally import existing plaintext `.env` files
3. Open a terminal in your project and use the CLI examples below.

Packaged desktop builds can install and update an app-managed `cloakenv` command for you.

### Option B: run from source

Requirements:

- [Bun](https://bun.sh)
- macOS, Linux, or Windows

Install dependencies:

```bash
bun install
```

Run the desktop app:

```bash
bun run dev
```

Use the CLI from source:

```bash
bun run cli -- --help
```

Build the standalone CLI:

```bash
bun run cli:build
./apps/cli/dist/index.js --help
```

Build release artifacts:

```bash
bun run release:build
```

Artifacts are written to `artifacts/`.

## GitHub Releases

CloakEnv publishes desktop installers, updater feeds, and standalone CLI binaries through GitHub Releases.

Release rules:

- the source of truth is the root [`package.json`](./package.json) version
- a Git tag must match that version in `vX.Y.Z` form
- packaged builds published by CI point their updater at:
  `https://github.com/<owner>/<repo>/releases/latest/download`

To cut the first stable release:

```bash
git tag v1.0.5
git push origin v1.0.5
```

The release workflow will:

- validate that the pushed tag matches `package.json`
- build macOS, Linux, and Windows release artifacts
- upload them to a GitHub Release named after the tag
- publish stable updater assets that the in-app updater can fetch from the latest release

All CLI examples below assume `cloakenv` is available in your shell. If you are running from a source checkout and have not installed the CLI into your `PATH` yet, replace:

```bash
cloakenv ...
```

with:

```bash
bun run cli -- ...
```

## First-Time Setup

The easiest first run is:

```bash
cloakenv init
```

`cloakenv init` will:

- require a backup directory
- require an auto-backup passphrase when auto-backup is enabled
- detect the current project when possible
- optionally bootstrap from `.env.schema` if the file exists

After that:

```bash
cloakenv set DATABASE_URL=postgres://localhost:5432/mydb
cloakenv list
```

To run your app with approved secret injection:

```bash
cloakenv run -- npm run dev
cloakenv run -- python manage.py runserver
cloakenv run -- go run ./cmd/api
```

`cloakenv run` requires the desktop app to be running, or a foreground provider in another terminal:

```bash
cloakenv provider start
```

Useful diagnostics:

```bash
cloakenv provider status
cloakenv provider expire --all
```

## Typical CLI Workflow

Store or update a secret:

```bash
cloakenv set API_KEY=your-secret
```

Read one secret with approval:

```bash
cloakenv get API_KEY
```

List keys:

```bash
cloakenv list
```

List keys and values with approval:

```bash
cloakenv list --show-values
```

Inspect audit history:

```bash
cloakenv audit --limit 20
```

Generate a strong passphrase:

```bash
cloakenv generate-passphrase
```

## Existing `.env` Files

If you already have plaintext `.env` files, the desktop onboarding flow and project UI can detect and import them into the vault. After import, the app can move the original plaintext files to trash.

That is the recommended migration path for a first-time user coming from `.env`, `.env.local`, or similar files.

## Projects And Scopes

CloakEnv tries to detect the current project from:

1. a `.cloakenv` marker file
2. a Git root
3. a supported manifest such as `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, or `bunfig.toml`

If detection is wrong or you are inside a monorepo, use explicit project commands:

```bash
cloakenv project create my-app
cloakenv project list
cloakenv project switch my-app
```

Scopes let you separate values such as `default`, `development`, `test`, or `.env.local`:

```bash
cloakenv set --scope test API_KEY=test-secret
cloakenv run --scope test -- bun test
```

## Backup And Recovery

Every mutating workflow expects a configured backup directory. Backups are encrypted `.cloaked` files.

Export:

```bash
cloakenv export --output ./vault.env.cloaked
```

Import:

```bash
cloakenv import ./vault.env.cloaked
```

Configuration helpers:

```bash
cloakenv config backup-path /path/to/backups
cloakenv config backup-passphrase
cloakenv config show
cloakenv config provider-session 15
```

## Schema Support

CloakEnv supports the `@env-spec` schema format used by `.env.schema`.

Export a schema from the current project:

```bash
cloakenv schema export
```

Import an existing schema:

```bash
cloakenv schema import
```

Compare stored schema metadata with a file:

```bash
cloakenv schema diff
```

Validate stored values:

```bash
cloakenv schema validate
```

Imported schema entries are stored even when no secret value exists yet, so the UI and CLI can manage schema-only fields.

## Varlock Compatibility

CloakEnv and Varlock are meant to be complementary:

- CloakEnv owns local encrypted storage, approval, audit, and provider access.
- Varlock remains the schema-driven runtime layer.
- `@env-spec` is the shared contract.

Supported integration paths in this repo:

- `cloakenv run -- ...` around an existing app command
- `@cloakenv/varlock-adapter` for Node-based bootstraps
- `@cloakenv/varlock-helper` for schema-driven `varlock run` workflows

See [docs/varlock-integration.md](docs/varlock-integration.md) for full examples.

## How It Works

```text
Developer or local adapter
        |
        v
  CloakEnv CLI / client
        |
        v
Local provider socket or named pipe
        |
        v
Desktop approval dialog or terminal approval
        |
        v
Encrypted local vault
        |
        v
Approved child process / approved env map
```

In the normal desktop flow, the app owns the approval boundary. In headless or fallback usage, `cloakenv provider start` hosts the same provider contract with terminal approvals.

## Security Model

| Layer | Protection |
| --- | --- |
| Encryption at rest | AES-256-GCM |
| Key derivation | scrypt + HKDF-SHA256 |
| Local key storage | OS keychain / secret service / credential manager |
| Transport | Unix domain socket or Windows named pipe |
| Approval | Native approval in desktop mode, terminal approval in foreground provider mode |
| Audit | Request and decision logging |
| Primary defense | No plaintext `.env` file in normal CloakEnv workflows |

Local storage paths used by default:

- Vault database: `~/.config/cloakenv/vault.db`
- Provider endpoint on Unix: `~/.config/cloakenv/provider.sock`

## Development

Run tests:

```bash
bun test --recursive
```

Typecheck:

```bash
bun run typecheck
```

Lint:

```bash
bun run lint
```

Repo layout:

```text
cloakenv/
├── apps/cli/                 # CLI entrypoint
├── apps/web/                 # Desktop UI
├── packages/core/            # Vault, crypto, provider client/types, schema support
├── packages/varlock-adapter/ # Node adapter for Varlock-style bootstraps
├── packages/varlock-helper/  # Helper CLI for schema-driven Varlock workflows
└── src/bun/                  # Desktop main process and local provider service
```

## Additional Docs

- [docs/provider-api.md](docs/provider-api.md)
- [docs/provider-client-contract.md](docs/provider-client-contract.md)
- [docs/reference-examples.md](docs/reference-examples.md)
- [docs/varlock-integration.md](docs/varlock-integration.md)
- [docs/kdf-benchmark.md](docs/kdf-benchmark.md)

## License

MIT. See [LICENSE](LICENSE).
