# Orca patch fork

This directory contains the tooling and notes for the private Orca fork.
The repository is based on upstream Orca v1.4.206 and carries a single
`patched` branch with the LSP and TextMate support plus the test-flavour
identity switch. Both flavours build from `patched`; `ORCA_PATCHED_FLAVOR=test`
(set by `build-test.sh`) selects the isolated Orca-Patch identity, and without
it the build is a plain Orca release.

## LSP workspace trust

Executables in `.venv` or `node_modules/.bin` are used only inside workspace
roots that the user has explicitly trusted. The application reads trust
settings from a user-owned configuration file outside this repository and
does not create or write that file. Tilde expansion is not supported.

The LSP code treats nonexistent paths, relative paths, invalid JSON, and
unreadable files as untrusted.

## LSP diagnostics and syntax highlighting

Errors and warnings appear at the end of the relevant line as Monaco `after`
decorations. Information and hint diagnostics retain their squiggles. When
several diagnostics share a line, the most severe diagnostic wins.

The inline diagnostic limits are:

| Constant | Value |
| --- | --- |
| `INLINE_DIAGNOSTIC_MAX_MESSAGE_LENGTH` | 160 characters, truncated with `…` |
| `INLINE_DIAGNOSTIC_MAX_LINES_PER_MODEL` | 200 lines |
| `INLINE_DIAGNOSTIC_ERROR_COLOR_TOKEN` | `--vscode-editorError-foreground`, fallback `#d78787` |
| `INLINE_DIAGNOSTIC_WARNING_COLOR_TOKEN` | `--vscode-editorWarning-foreground`, fallback `#d4ad61` |
| `INLINE_DIAGNOSTIC_LEFT_MARGIN` | `8px` |

The colors use VS Code-compatible Monaco theme tokens so they follow Orca's
light and dark themes. CSS is injected once under feature-specific classes,
and messages use italics and opacity to distinguish them from source code.

## LSP server resolution

For an opened file, the server resolver searches from the file's directory up
to the workspace root and uses the first matching executable.

- Python searches each `.venv/bin/<command>`, then `PATH`.
- TypeScript and JavaScript search each `node_modules/.bin/<command>`, then `PATH`.
- Go and Rust search `PATH`.
- Pyright receives the same `.venv/bin/python` selected for Python servers.
- Python starts Pyright as the primary server and every available Ruff server
  as an additional diagnostics server.

Add a server in `src/main/lsp/lsp-server-catalog.ts` by adding one catalog
entry with its `serverId`, command, and arguments. Use `localCommandDirectory`
when a search should not use the language-specific default directory.

When a server closes, the client sends LSP `shutdown` and `exit`, waits up to
250 ms before SIGTERM, and waits another 750 ms before SIGKILL. The timers are
unref'ed, so an unresponsive server cannot keep the process alive indefinitely.

## Build

Install dependencies once from the repository root:

```sh
corepack pnpm install --frozen-lockfile
```

Build the test flavour from the `patched` branch:

```sh
./patch/build-test.sh
```

The test flavour uses `Orca-Patch`, bundle identifier
`com.chu1.orca-patch`, and an isolated application data directory. It also
disables updater, CLI shim, agent hook, and protocol-handler registration.

Build the release flavour from the `patched` branch:

```sh
./patch/build-release.sh
```

Both scripts require a clean Git worktree and remove stale
`dist/mac-arm64` and `dist/mac-arm64.tmp` output before building. The test
script verifies the built app's `CFBundleIdentifier`.

The scripts in this directory are copied from the workspace setup directory
for convenience. The outer setup directories are not part of this Git
repository.
