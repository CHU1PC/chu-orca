// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.
import { canonicalFileUriKey } from './lsp-file-uri-key'
import type { LspDiagnosticsListener, LspSession } from './lsp-session-state'

type SendMessage = (session: LspSession, message: unknown) => void

function serverConfiguration(session: LspSession, section: unknown): unknown {
  return section === 'python' && session.pythonPath ? { pythonPath: session.pythonPath } : null
}

export function handleServerMessage(
  session: LspSession,
  message: unknown,
  send: SendMessage,
  diagnosticsListeners: ReadonlySet<LspDiagnosticsListener>
): void {
  const parsed = message as {
    id?: number | string
    method?: string
    result?: unknown
    error?: { message?: string }
    params?: { uri?: string; diagnostics?: unknown[]; items?: unknown[] }
  }
  if (parsed.id !== undefined && parsed.method === undefined) {
    const pending = session.pending.get(Number(parsed.id))
    if (!pending) {
      return
    }
    session.pending.delete(Number(parsed.id))
    clearTimeout(pending.timer)
    if (parsed.error) {
      pending.reject(new Error(parsed.error.message ?? 'LSP request failed'))
    } else {
      pending.resolve(parsed.result ?? null)
    }
    return
  }
  if (parsed.method === 'textDocument/publishDiagnostics' && parsed.params?.uri) {
    const document = session.documentsByUri.get(canonicalFileUriKey(parsed.params.uri))
    if (!document) {
      return
    }
    for (const listener of diagnosticsListeners) {
      listener({
        sessionId: session.sessionId,
        fileUri: document.fileUri,
        serverId: session.serverId,
        diagnostics: parsed.params.diagnostics ?? []
      })
    }
    return
  }
  if (parsed.id === undefined || parsed.method === undefined) {
    return
  }
  const configurationItems = parsed.params?.items
  if (parsed.method === 'workspace/configuration' && Array.isArray(configurationItems)) {
    send(session, {
      jsonrpc: '2.0',
      id: parsed.id,
      result: configurationItems.map((item) =>
        serverConfiguration(session, (item as { section?: unknown })?.section)
      )
    })
    return
  }
  if (
    parsed.method === 'client/registerCapability' ||
    parsed.method === 'window/workDoneProgress/create'
  ) {
    send(session, { jsonrpc: '2.0', id: parsed.id, result: null })
    return
  }
  send(session, {
    jsonrpc: '2.0',
    id: parsed.id,
    error: { code: -32601, message: `Method not found: ${parsed.method}` }
  })
}

export function publishClearDiagnostics(
  session: LspSession,
  diagnosticsListeners: ReadonlySet<LspDiagnosticsListener>
): void {
  for (const document of session.documentsByUri.values()) {
    for (const listener of diagnosticsListeners) {
      listener({
        sessionId: session.sessionId,
        fileUri: document.fileUri,
        serverId: session.serverId,
        diagnostics: []
      })
    }
  }
}
