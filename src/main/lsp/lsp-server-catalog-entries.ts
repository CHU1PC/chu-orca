// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.
import type { LspServerDescriptor } from './lsp-server-catalog'

export type LspServerCatalogEntry = {
  languages: readonly string[]
  /** Tried in order; the first available primary command wins. */
  candidates: readonly LspServerDescriptor[]
  /** Every available descriptor is started for diagnostics only. */
  additionalServers?: readonly LspServerDescriptor[]
  localCommandDirectory?: 'python-venv' | 'node-modules' | 'path-only'
}

/** Servers Orca knows how to drive. Nothing is bundled. */
export const LSP_SERVER_CATALOG: readonly LspServerCatalogEntry[] = [
  {
    languages: ['typescript', 'javascript'],
    candidates: [
      // Why: tsgo is the fast path and the only server that works in tsserver-less TS7 repos.
      { serverId: 'tsgo', command: 'tsgo', args: ['--lsp', '--stdio'] },
      {
        serverId: 'typescript-language-server',
        command: 'typescript-language-server',
        args: ['--stdio']
      }
    ],
    localCommandDirectory: 'node-modules'
  },
  {
    languages: ['dockerfile'],
    candidates: [
      { serverId: 'dockerfile-language-server', command: 'docker-langserver', args: ['--stdio'] }
    ],
    localCommandDirectory: 'node-modules'
  },
  {
    languages: ['python'],
    candidates: [{ serverId: 'pyright', command: 'pyright-langserver', args: ['--stdio'] }],
    additionalServers: [{ serverId: 'ruff', command: 'ruff', args: ['server'] }],
    localCommandDirectory: 'python-venv'
  },
  { languages: ['go'], candidates: [{ serverId: 'gopls', command: 'gopls', args: [] }] },
  {
    languages: ['rust'],
    candidates: [{ serverId: 'rust-analyzer', command: 'rust-analyzer', args: [] }]
  }
]
