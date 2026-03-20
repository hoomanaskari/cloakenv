# Varlock Integration

CloakEnv and Varlock have separate jobs:

- CloakEnv stores secrets locally, encrypts them at rest, enforces approval, and serves approved plaintext only over the local provider.
- Varlock remains the schema-driven runtime and developer-experience layer.

The supported bridge between them is:

- shared `.env.schema` files in `@env-spec` format
- provider API `resolve_environment`
- the official `@cloakenv/varlock-adapter` helper for Node-based Varlock bootstraps
- the official `@cloakenv/varlock-helper` CLI helper for schema-driven `varlock run` workflows

## Supported Paths

### 1. Launch Your Existing Workflow Through CloakEnv

If your existing dev command already initializes Varlock, keep that command and let CloakEnv inject the env first:

```bash
cloakenv run -- bun run dev
```

This is the simplest path when Varlock is already part of the app startup flow.

### 2. Keep `varlock run` And Resolve Sensitive Keys Through CloakEnv

If the application must keep `varlock run` as the top-level command, use
`@cloakenv/varlock-helper` from schema `exec()` resolvers:

```dotenv
# @currentEnv=$APP_ENV
# ---

APP_ENV=development

# @required @sensitive
API_KEY=exec(`./node_modules/.bin/cloakenv-varlock get API_KEY --scope ${APP_ENV}`)

# @required @sensitive
DATABASE_URL=exec(`./node_modules/.bin/cloakenv-varlock get DATABASE_URL --scope ${APP_ENV}`)
```

Then keep the runtime command unchanged:

```bash
varlock run -- bun run dev
```

`@cloakenv/varlock-helper`:

- resolves the full environment for the current project and scope through the local provider
- caches that approved environment locally for the rest of the current Varlock run
- prints the value to stdout for Varlock `exec()` resolution
- avoids hardcoded local script paths in each application repo
- reduces repeated approval prompts to one approval per Varlock run

This is the recommended current path for schema-driven Varlock projects until a
first-class official Varlock plugin path is available.

### 3. Preload Env Before Varlock Reads `process.env`

For Node-based bootstraps, use the adapter package:

```ts
import { prepareVarlockEnvironment } from "@cloakenv/varlock-adapter";

await prepareVarlockEnvironment({
  scope: ".env.local",
});

const { env } = await import("./env");
```

Important: call `prepareVarlockEnvironment()` before importing modules that capture environment variables at import time.

## Adapter Behavior

`@cloakenv/varlock-adapter`:

- calls provider API `resolve_environment`
- forwards requester metadata for approval and audit visibility
- merges approved keys into `process.env`
- returns `{ projectId, projectName, env, requester }` for higher-level runtime setup

`@cloakenv/varlock-helper`:

- calls provider API `resolve_environment`
- reuses a short-lived per-run cache so sibling `exec()` lookups do not re-prompt
- forwards requester metadata for approval and audit visibility
- resolves project context from the current working directory unless `--project` is provided
- is intended for Varlock `exec()` schema usage, not full-process env injection

## Shared Schema Workflow

Keep a single `.env.schema` in `@env-spec` format:

1. CloakEnv uses it for schema import, validation, and schema-only fields.
2. Varlock-compatible tooling uses the same file for runtime typing and validation.

That keeps the schema contract shared without making CloakEnv responsible for Varlock runtime features.

## Foreground And Headless Usage

If the desktop app is unavailable, start the provider in the terminal:

```bash
cloakenv provider start
```

The adapter, helper, and any other provider clients continue using the same socket or pipe contract.
