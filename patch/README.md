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
does not create or write that file. Tilde expansion is not supported. A trusted-roots entry must match the on-disk path case exactly, because realpath does not fold case on macOS, and a case-mismatched entry is silently ignored.

The vendored TextMate asset licenses are listed in [the renderer license file](../src/renderer/src/lib/monaco-textmate/LICENSES.md).

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
- Dockerfile searches each `node_modules/.bin/docker-langserver`, then `PATH`.
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

## Fork CI

The `fork-sync` workflow keeps the fork's `patched` branch rebased onto the
newest stable upstream Orca release tag. It syncs the fork's `main` branch,
rebases in a macOS runner, runs the focused checks and quality gate, builds an
unsigned release, and pushes only after all checks pass. Rebase conflicts and
other failures are recorded in one labelled issue per release tag and stage.

Before enabling the workflow:

1. Create a fine-grained PAT with repository access to the fork only and
   `Contents: write`, `Workflows: write`, and `Issues: write` permissions. Set
   an expiry, and rotate the token before it expires.
2. Add the PAT as the repository secret `FORK_SYNC_TOKEN`.
3. Set the fork's default branch to `patched`; scheduled workflows run from
   the default branch.
4. Enable Issues in `Settings > General > Features`; forks have Issues
   disabled by default.

To run it now, press `Run workflow` in the Actions tab, or run the same thing
from a terminal. Replace `<fork>` with the fork repository in `owner/name`
form:

```sh
gh workflow run fork-sync.yml -R <fork> [-f tag=vX.Y.Z]
```

To recover from a rebase-conflict issue locally, remember that `origin` is the
fork in a fork clone. Add the upstream remote if it is missing, fetch both
release tags from upstream, create a backup branch, rebase, compare the patch
commits, run the checks, and push the resolved branch before closing the issue:

```sh
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/stablyai/orca.git
git fetch upstream tag <old> tag <new> --no-tags
git branch backup patched
git rebase --onto <new> <old> patched
git range-diff <old>..backup <new>..patched
pnpm tc
pnpm test
git push --force-with-lease fork patched
```
