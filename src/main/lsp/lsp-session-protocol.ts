// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.
import { canonicalFileUriKey } from './lsp-file-uri-key'
import type { LspDiagnosticsListener, LspSession } from './lsp-session-state'

type SendMessage = (session: LspSession, message: unknown) => void

type LspServerMessage = {
  id?: number | string
  method?: string
  result?: unknown
  error?: { message?: string }
  params?: { uri?: string; diagnostics?: unknown[]; items?: unknown[] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isLspServerMessage(message: unknown): message is LspServerMessage {
  if (!isRecord(message)) {
    return false
  }
  if ('id' in message && typeof message.id !== 'number' && typeof message.id !== 'string') {
    return false
  }
  if ('method' in message && typeof message.method !== 'string') {
    return false
  }
  if ('params' in message && (message.params === null || typeof message.params !== 'object')) {
    return false
  }
  if (
    'result' in message &&
    message.result !== null &&
    !['boolean', 'number', 'object', 'string'].includes(typeof message.result)
  ) {
    return false
  }
  if ('error' in message) {
    if (!isRecord(message.error)) {
      return false
    }
    if ('message' in message.error && typeof message.error.message !== 'string') {
      return false
    }
  }
  if (isRecord(message.params)) {
    if ('uri' in message.params && typeof message.params.uri !== 'string') {
      return false
    }
    if ('diagnostics' in message.params && !Array.isArray(message.params.diagnostics)) {
      return false
    }
    if ('items' in message.params && !Array.isArray(message.params.items)) {
      return false
    }
  }
  return true
}

function serverConfiguration(session: LspSession, section: unknown): unknown {
  return section === 'python' && session.pythonPath ? { pythonPath: session.pythonPath } : null
}

export function handleServerMessage(
  session: LspSession,
  message: unknown,
  send: SendMessage,
  diagnosticsListeners: ReadonlySet<LspDiagnosticsListener>
): void {
  if (!isLspServerMessage(message)) {
    return
  }
  const parsed = message
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
        serverConfiguration(session, isRecord(item) && 'section' in item ? item.section : undefined)
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
