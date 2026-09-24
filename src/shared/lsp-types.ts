// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.
/** Wire contract for the local LSP bridge (renderer ↔ main). Local workspaces
 *  only — remote/SSH/web surfaces have no `lsp` API and degrade to no LSP. */

export const LSP_REQUEST_METHODS = [
  'textDocument/hover',
  'textDocument/definition',
  'textDocument/references',
  'textDocument/completion',
  'textDocument/diagnostic',
  'textDocument/semanticTokens/full',
  'textDocument/documentLink',
  'documentLink/resolve'
] as const

export type LspRequestMethod = (typeof LSP_REQUEST_METHODS)[number]

export type LspSemanticTokensLegend = {
  tokenTypes: string[]
  tokenModifiers: string[]
}

export type LspDocumentLinkCapabilities = {
  resolveProvider: boolean
}

export type LspOpenDocumentArgs = {
  /** Absolute local path of the file being edited. */
  filePath: string
  /** Absolute local path of the workspace root the server is scoped to. */
  rootPath: string
  /** Monaco language id (e.g. 'typescript', 'python'). */
  languageId: string
  /** Full document text at open time. */
  text: string
}

export type LspOpenDocumentResult = {
  /** One entry per running server, with the primary entry first when present. */
  sessions: LspSessionInfo[]
  /** Canonical file:// URI for filePath, computed by main so both sides agree. */
  fileUri: string | null
  projectToolsSkippedReason?: string
}

export type LspSessionInfo = {
  sessionId: string
  fileUri: string
  serverId: string
  resolvedCommand: string
  source: 'project' | 'PATH'
  isPrimary: boolean
  /** True when the server wants pull diagnostics instead of pushing them. */
  pullDiagnostics: boolean
  semanticTokensLegend?: LspSemanticTokensLegend
  documentLinks?: LspDocumentLinkCapabilities
}

export type LspChangeDocumentArgs = {
  sessionId: string
  fileUri: string
  text: string
}

export type LspCloseDocumentArgs = {
  sessionId: string
  fileUri: string
}

export type LspRequestArgs = {
  sessionId: string
  method: LspRequestMethod
  params: unknown
}

export type LspDiagnosticsPayload = {
  sessionId: string
  fileUri: string
  serverId: string
  diagnostics: unknown[]
}
