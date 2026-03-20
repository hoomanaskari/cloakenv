# CloakEnv TODO

Status is based on the current repo against the provider-first PRD in `PRD.md`.

Items prefixed with `[UI]` require UI, UX, or visual design work, even if they also include backend changes.

## Direction Locked

- [x] Reposition CloakEnv as an independent local encrypted secret provider with a minimal CLI.
  CloakEnv should own local storage, approval, audit, backup, and provider access.

- [x] Treat Varlock as a first-class compatibility target, not the required runtime foundation.
  Shared `@env-spec` schemas are the contract; CloakEnv should remain useful without Varlock.

- [x] Update the PRD, README, and TODOs to reflect this direction.

## Highest Priority

- [x] Promote the current approval broker into a stable provider API over Unix domain sockets / Windows named pipes.
  The current broker is CloakEnv-private and action-shaped. It needs to become a supported local provider contract.

- [x] Add an approved environment-resolution primitive separate from process spawning.
  `cloakenv run` should remain the default workflow, but future adapters need something like `resolveEnvironment(project, scope)` instead of only `run`.

- [x] Make `cloakenv run` a thin reference client of the provider API.
  The CLI should use the same provider contract that future adapters and language-specific clients use.

- [x] Make the CLI installable as a real `cloakenv` executable outside the workspace.
  The package.json workflow, docs, and integration story all depend on this.

- [x] Adopt the official `@env-spec` parser package or otherwise close the compatibility gap.
  Shared schema compatibility is the bridge to Varlock and should not depend on a custom subset parser.

- [x] [UI] Support first-class schema entries without stored secret values.
  Schema must be a real project contract, not metadata that only exists after a secret row has been created.

## High Priority

- [x] Deliver one-click platform installers for macOS, Windows, and Linux.
  A raw standalone binary is not enough for the intended zero-terminal UX. Installers should bundle the desktop app and matching CLI, make `cloakenv` available on `PATH`, and handle platform-native integration.

- [x] [UI] Add first-launch desktop onboarding for vault initialization and backup-path setup.
  Users should not need to drop into the terminal to finish setup after installing the app. Either choose a sane default backup directory automatically or collect it in the GUI before first write flows.

- [x] Add release automation for installer artifacts and bundled CLI distribution.
  Releases should produce platform-specific installer outputs instead of expecting users to manually wire raw binaries into `PATH`.

- [x] Design and document the provider client contract for non-Node runtimes.
  Python, Go, Ruby, Rust, and shell users need a clear integration story that does not assume Node.

- [x] Add a headless / foreground provider mode.
  The tray app remains the primary UX, but a non-GUI mode helps Linux, testing, and server-like local workflows.

- [x] Add an official Varlock integration path.
  Most likely this is an adapter package or documented composition flow once the provider API is stable.

- [x] [UI] Complete desktop schema import via file picker.
  The schema panel should import existing `.env.schema` files, not only edit and export metadata.

- [x] [UI] Add richer scoped access policy management.
  Basic scope filtering exists, but policy definition, defaults, and per-client visibility need a fuller model.

- [x] [UI] Redesign plaintext `.env` export into an explicit restore/offboarding workflow.
  Keep it as an anti-lock-in feature, but frame it as "Restore `.env` files" or "Exit CloakEnv for this project", not as a normal export path.

- [x] Preserve original imported filenames when restoring plaintext `.env` files.
  Use stored source-file metadata when available, and fall back to `.env` / `.env.<scope>` naming only for scopes created inside CloakEnv.

## Medium Priority

- [x] Add reference examples for `package.json`, Python, Go, and shell workflows.

- [x] [UI] Add provider session support for hot-reloading development servers if repeated approvals become too noisy.

- [x] [UI] Improve provider status and diagnostics in the desktop UI and CLI.

- [x] Revisit cross-project secret references only if the provider model still needs them.
  Reviewed on March 13, 2026: provider requests stay explicitly single-project, and any multi-project composition remains caller-owned.

- [x] Benchmark and document the current KDF choice over time.
  Baseline and rerun workflow now live in `docs/kdf-benchmark.md` and `packages/core/scripts/benchmark-kdf.ts`.

## Guardrails

- Do not turn CloakEnv into a second full schema/runtime ecosystem that tries to out-Varlock Varlock.

- Do not make cloud secret providers a required dependency for local development.

- Do not promote plaintext `.env` generation to the primary workflow.

- Do keep a clear migration reversal / anti-lock-in path for users who want to leave CloakEnv.

## Already Done

- [x] Core encrypted local vault exists with SQLite-backed storage and AES-256-GCM encryption.

- [x] Per-project key derivation and multi-project secret isolation exist.

- [x] OS keychain-backed local vault auth exists, with passphrase mode support in CLI context initialization.

- [x] `.env.cloaked` export/import flows exist in both core and exposed CLI / desktop paths.

- [x] Passphrase strength scoring via zxcvbn exists.

- [x] Audit logging exists with request lifecycle capture in storage.

- [x] Secret history/versioning exists and is exposed through CLI and desktop history views.

- [x] Desktop app shell exists with ElectroBun main process, typed RPC bridge, BrowserWindow, and tray integration.

- [x] A local approval broker already exists between the CLI and the desktop app.
  Sensitive commands already route through a dedicated local IPC channel owned by the desktop main process.

- [x] Sensitive actions execute in the desktop app after fresh native approval.
  `get`, `history`, `list --show-values`, `run`, and `export` are already brokered and approval-gated.

- [x] One-request approval consumption and replay protection already exist.

- [x] Auto-backup is enforced across CLI and desktop mutation paths.

- [x] Project auto-detection exists, including `.git` root detection and `.cloakenv` marker support for monorepo sub-projects.

- [x] CLI basics are implemented: `init`, `set`, `get`, `list`, `remove`, `run`, `export`, `import`, `history`, `audit`, `config show`, `config backup-path`, `project create/list/rename/remove/switch`, `schema export/import/diff/validate`, and `generate-passphrase`.

- [x] Desktop project workflow exists for folder picking, `.env` file scanning, import preview, import execution, and optional move-to-trash cleanup.

- [x] Desktop project sidebar exists with create/select/remove flows.

- [x] Desktop secret manager basics exist with listing, add, delete, reveal, copy, and history access.

- [x] Environment/scope listing and filtering exist in the desktop data model and RPC surface.

- [x] Schema commands and schema-aware write validation exist.
  The current implementation can export/import/diff/validate schema files and warns on invalid `cloakenv set` values.
