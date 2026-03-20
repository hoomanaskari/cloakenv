# Provider Client Contract

This document describes the supported client contract for runtimes that are not the built-in `cloakenv` CLI reference client.

Use it when you are writing:

- a Python, Go, Ruby, shell, or editor integration
- a local launcher that needs approved env resolution
- an adapter such as the Varlock integration path

## Choose The Right Request

- Use `run_process` when you explicitly want the provider to own process launch, stdio streaming, and child lifetime.
- Use `resolve_environment` when your runtime or adapter needs an approved plaintext env map and will launch or initialize the target process itself.

The built-in `cloakenv run` CLI now uses `resolve_environment` and launches locally so approved dev servers can keep running even if the desktop UI exits. `resolve_environment` is also the stable adapter surface for non-Node runtimes.

## Transport Contract

- Endpoint discovery: read `CLOAKENV_PROVIDER_ENDPOINT`, otherwise use the platform default from [docs/provider-api.md](./provider-api.md).
- Transport: Unix domain socket on POSIX, named pipe on Windows.
- Framing: newline-delimited JSON.
- Connection model: one request per connection.
- Request IDs: client-generated and single-use. Replays are rejected.

## Required Request Shape

Every request envelope uses:

```json
{
  "protocol": "cloakenv-provider",
  "version": 1,
  "type": "request",
  "request": {}
}
```

The inner `request` object must include:

- `kind`
- `requestId`
- `cwd`

Recommended fields for all external clients:

- `projectName`: set this when the client already knows the intended CloakEnv project.
- `scope`: set the exact environment or scope the client needs. If omitted, the provider falls back to the project's configured default scope.
- `requester`: include `{ processName, processPid, argv, hasTty }` so approval prompts and audit logs show who asked.

## Approval And Audit Expectations

The provider owns approval, policy, and audit. Clients must not try to replace that logic.

Client responsibilities:

- send accurate `cwd`, `scope`, and `requester` metadata
- treat returned env maps as ephemeral plaintext
- avoid caching resolved secrets across unrelated commands or sessions
- surface provider-denied errors to the developer without hiding the original message

If the user enables provider sessions, CloakEnv may reuse an already approved session for repeated `run_process` or `resolve_environment` requests with the same project, scope, working directory, process name, and argv fingerprint. Clients should still treat the returned env map as ephemeral and should not add their own long-lived cache on top.

Operators may explicitly invalidate those leases through `expire_session`, the desktop provider console, or the `cloakenv provider expire ...` CLI flow.

## Response Handling

`resolve_environment` returns a single `response` message. Success data is:

```json
{
  "projectId": "proj_123",
  "projectName": "app",
  "env": {
    "API_KEY": "..."
  }
}
```

`run_process` first returns a successful `response`, then streams:

- `run_started`
- `stdout`
- `stderr`
- `run_exit`

Stream payloads use base64-encoded chunks for binary-safe transport.

`status` returns a single diagnostic snapshot. Use it for tooling health checks and human-facing status screens, not as an approval substitute.

`expire_session` returns a mutation result with:

- `expired`
- `remaining`
- `expiredSessionId`

## Error Handling

Treat the `response.error.code` field as machine-readable and the `message` as user-facing.

Common codes:

- `approval_denied`
- `project_not_found`
- `no_secrets`
- `request_replayed`
- `request_already_bound`
- `spawn_failed`

If the endpoint is unavailable, prompt the developer to start either:

- the CloakEnv desktop app
- `cloakenv provider start` for foreground/headless usage

## Foreground Provider Mode

When the desktop UI is unavailable, CloakEnv can host the same provider contract in the terminal:

```bash
cloakenv provider start
```

This mode keeps the same socket or pipe contract. The only difference is that approvals happen in the terminal instead of a native desktop dialog.

## Project Boundary

Provider requests resolve exactly one CloakEnv project at a time. Cross-project secret references remain intentionally out of scope because they blur approval, audit, and least-privilege boundaries. If a workflow needs values from multiple projects, the caller should make separate provider requests and compose them explicitly at the caller layer.

## Adapter Checklist

Before considering a client integration complete, verify that it:

- uses `resolve_environment` instead of scraping local files
- passes `requester` metadata
- handles provider-unavailable errors cleanly
- does not persist plaintext env files as an intermediate step
- documents that approval happens in CloakEnv, not inside the client
