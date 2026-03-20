# Reference Examples

These examples show the intended integration patterns after the provider-first reset.

Use `cloakenv run` for the built-in CLI flow: it resolves an approved env through the provider and then launches the target command locally. Use `resolve_environment` directly only when your runtime must manage env injection or process initialization itself.

All examples assume:

- `cloakenv init` has already been completed
- the desktop app is running, or `cloakenv provider start` is running in another terminal
- secrets already exist for the current project and scope

## 1. `package.json` Workflow

Keep your real app command in an inner script and wrap the outer script with `cloakenv run`.

```json
{
  "scripts": {
    "app:dev": "vite",
    "app:test": "vitest run",
    "dev": "cloakenv run -- npm run app:dev",
    "dev:server": "cloakenv run --scope=server -- npm run app:dev",
    "test:approved": "cloakenv run --scope=test -- npm run app:test",
    "provider": "cloakenv provider start"
  }
}
```

Typical usage:

```bash
npm run dev
npm run dev:server
npm run test:approved
```

Why this shape:

- the inner script stays portable and unaware of CloakEnv
- the outer script is the approval boundary
- scope-specific scripts stay explicit instead of hiding secret selection in application code

## 1B. Keep `varlock run` And Fetch Secrets From CloakEnv

Use this when the app must keep Varlock as the runtime entrypoint instead of wrapping
the outer command with `cloakenv run`.

`.env.schema`:

```dotenv
# @currentEnv=$APP_ENV
# ---

APP_ENV=development

# @required @sensitive
API_KEY=exec(`./node_modules/.bin/cloakenv-varlock get API_KEY --scope ${APP_ENV}`)
```

`package.json`:

```json
{
  "scripts": {
    "dev": "varlock run -- bun run app:dev"
  }
}
```

Requirements:

- the app installs `@cloakenv/varlock-helper`
- the CloakEnv desktop app is running, or `cloakenv provider start` is running elsewhere
- secrets already exist in CloakEnv for the current project and scope
- the first helper lookup resolves the whole scope once, so the run only needs one approval prompt

## 2. Python Workflow

### A. Preferred: let CloakEnv launch Python

```bash
cloakenv run -- python manage.py runserver
cloakenv run --scope=worker -- python worker.py
cloakenv run --scope=test -- python -m pytest
```

This is the simplest path when Python does not need to resolve env values before process startup.

### B. Advanced: resolve env inside Python

Use this when a Python bootstrap needs an approved env map before it initializes the app.

```python
import json
import os
import pathlib
import socket
import sys
import uuid


def provider_endpoint() -> str:
    return (
        os.environ.get("CLOAKENV_PROVIDER_ENDPOINT")
        or os.environ.get("CLOAKENV_APPROVAL_BROKER_ENDPOINT")
        or str(pathlib.Path.home() / ".config" / "cloakenv" / "provider.sock")
    )


def resolve_environment(scope: str | None = None, project_name: str | None = None) -> dict[str, str]:
    if os.name == "nt":
        raise RuntimeError(
            "This example uses the POSIX Unix socket path. On Windows, prefer "
            "`cloakenv run` or connect to the named pipe with a pipe-capable client."
        )

    request = {
        "protocol": "cloakenv-provider",
        "version": 1,
        "type": "request",
        "request": {
            "kind": "resolve_environment",
            "requestId": str(uuid.uuid4()),
            "cwd": os.getcwd(),
            "projectName": project_name,
            "scope": scope,
            "requester": {
                "processName": pathlib.Path(sys.argv[0]).name or "python",
                "processPid": os.getpid(),
                "argv": sys.argv,
                "hasTty": sys.stdin.isatty() or sys.stdout.isatty() or sys.stderr.isatty(),
            },
        },
    }
    request["request"] = {
        key: value for key, value in request["request"].items() if value is not None
    }

    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.connect(provider_endpoint())
        with sock.makefile("rwb") as stream:
            stream.write(json.dumps(request).encode("utf-8"))
            stream.write(b"\n")
            stream.flush()
            response = json.loads(stream.readline().decode("utf-8"))

    if not response["ok"]:
        error = response["error"]
        raise RuntimeError(f'{error["code"]}: {error["message"]}')

    return response["data"]["env"]


os.environ.update(resolve_environment(scope=".env.local"))

from app import create_app

app = create_app()
app.run(port=8000)
```

This keeps the provider approval and audit flow intact while letting Python own the final bootstrap.

## 3. Go Workflow

### A. Preferred: let CloakEnv launch Go

```bash
cloakenv run -- go run ./cmd/api
cloakenv run --scope=test -- go test ./...
cloakenv run --scope=worker -- go run ./cmd/worker
```

### B. Advanced: resolve env inside Go

Use this when Go needs the approved env map before constructing the process tree.

```go
package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type providerEnvelope struct {
	Protocol string          `json:"protocol"`
	Version  int             `json:"version"`
	Type     string          `json:"type"`
	Request  providerRequest `json:"request"`
}

type providerRequest struct {
	Kind       string           `json:"kind"`
	RequestID  string           `json:"requestId"`
	Cwd        string           `json:"cwd"`
	ProjectName string          `json:"projectName,omitempty"`
	Scope      string           `json:"scope,omitempty"`
	Requester  providerRequester `json:"requester"`
}

type providerRequester struct {
	ProcessName string   `json:"processName"`
	ProcessPID  int      `json:"processPid"`
	Argv        []string `json:"argv"`
	HasTTY      bool     `json:"hasTty"`
}

type providerResponse struct {
	OK    bool `json:"ok"`
	Data  struct {
		Env map[string]string `json:"env"`
	} `json:"data"`
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func providerEndpoint() (string, error) {
	if endpoint := os.Getenv("CLOAKENV_PROVIDER_ENDPOINT"); endpoint != "" {
		return endpoint, nil
	}
	if endpoint := os.Getenv("CLOAKENV_APPROVAL_BROKER_ENDPOINT"); endpoint != "" {
		return endpoint, nil
	}
	if runtime.GOOS == "windows" {
		return `\\.\pipe\cloakenv-provider`, nil
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".config", "cloakenv", "provider.sock"), nil
}

func hasTTY() bool {
	for _, file := range []*os.File{os.Stdin, os.Stdout, os.Stderr} {
		if info, err := file.Stat(); err == nil && (info.Mode()&os.ModeCharDevice) != 0 {
			return true
		}
	}
	return false
}

func resolveEnvironment(scope string) (map[string]string, error) {
	endpoint, err := providerEndpoint()
	if err != nil {
		return nil, err
	}
	if runtime.GOOS == "windows" {
		return nil, errors.New("this example only implements the Unix socket client path")
	}

	cwd, err := os.Getwd()
	if err != nil {
		return nil, err
	}

	request := providerEnvelope{
		Protocol: "cloakenv-provider",
		Version:  1,
		Type:     "request",
		Request: providerRequest{
			Kind:      "resolve_environment",
			RequestID: fmt.Sprintf("go-%d-%d", os.Getpid(), time.Now().UnixNano()),
			Cwd:       cwd,
			Scope:     scope,
			Requester: providerRequester{
				ProcessName: filepath.Base(os.Args[0]),
				ProcessPID:  os.Getpid(),
				Argv:        os.Args,
				HasTTY:      hasTTY(),
			},
		},
	}

	conn, err := net.Dial("unix", endpoint)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	if err := json.NewEncoder(conn).Encode(request); err != nil {
		return nil, err
	}

	line, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil {
		return nil, err
	}

	var response providerResponse
	if err := json.Unmarshal([]byte(strings.TrimSpace(line)), &response); err != nil {
		return nil, err
	}
	if !response.OK {
		return nil, fmt.Errorf("%s: %s", response.Error.Code, response.Error.Message)
	}

	return response.Data.Env, nil
}

func main() {
	env, err := resolveEnvironment(".env.local")
	if err != nil {
		panic(err)
	}

	for key, value := range env {
		if err := os.Setenv(key, value); err != nil {
			panic(err)
		}
	}

	fmt.Println("approved env injected into Go process")
}
```

When you only need process launch semantics, `cloakenv run -- go run ./cmd/api` remains the better default.

## 4. Shell Workflow

Wrap existing shell entrypoints instead of generating `.env` files.

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

exec cloakenv run --scope=ops -- ./scripts/local-ops.sh "$@"
```

That keeps the real shell logic in `scripts/local-ops.sh` while making the wrapper the explicit approval boundary.

For ad hoc commands:

```bash
cloakenv run -- bash -lc 'python manage.py migrate && npm run dev'
cloakenv run --scope=staging -- ./scripts/check-health.sh
```

## Choosing Between The Two Models

Prefer `cloakenv run` when:

- you only need approved process launch
- you want the same workflow across Node, Python, Go, and shell
- you do not need to inspect env values before the process starts

Prefer `resolve_environment` when:

- your runtime must initialize libraries before launching child processes
- you are building an adapter such as the Varlock integration
- you can keep the returned env map ephemeral and avoid writing plaintext `.env` files
