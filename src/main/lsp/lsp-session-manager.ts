// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.
import { pathToFileURL } from 'node:url'
import type {
  LspOpenDocumentResult,
  LspRequestMethod,
  LspSessionInfo
} from '../../shared/lsp-types'
import { canonicalFileUriKey } from './lsp-file-uri-key'
import { buildLspInitializeParams } from './lsp-initialize-params'
import { encodeLspMessage, LspMessageDecoder } from './lsp-message-framing'
import { parseLspServerCapabilities } from './lsp-server-capabilities'
import {
  getProjectToolsSkippedReason,
  resolveLspServersForLanguage,
  toLspDocumentLanguageId
} from './lsp-server-catalog'
import type { LspServerDescriptor } from './lsp-server-catalog'
import { handleServerMessage, publishClearDiagnostics } from './lsp-session-protocol'
import { spawnLspServer } from './lsp-server-spawn'
import type { SpawnLspServer } from './lsp-server-spawn'
import type { LspDiagnosticsListener, LspSession, OpenDocumentState } from './lsp-session-state'
import {
  childHasExited,
  clearTerminationTimers,
  scheduleChildTermination
} from './lsp-session-termination'
export { LSP_SHUTDOWN_GRACE_MS, LSP_TERM_GRACE_MS } from './lsp-session-termination'

export type { LspDiagnosticsListener } from './lsp-session-state'

const MAX_CONCURRENT_SESSIONS = 6
const REQUEST_TIMEOUT_MS = 15_000
// Why: keep a doc-less server briefly for tab switches, but don't hold
// memory-heavy servers open indefinitely.
const IDLE_SHUTDOWN_MS = 3 * 60_000

export type LspSessionManager = ReturnType<typeof createLspSessionManager>

export function createLspSessionManager(deps?: {
  spawnServer?: SpawnLspServer
  probeCommand?: (command: string) => Promise<boolean>
  trustedRootsFilePath?: string
}) {
  const sessionsByKey = new Map<string, LspSession>()
  const sessionsById = new Map<string, LspSession>()
  const diagnosticsListeners = new Set<LspDiagnosticsListener>()
  let nextSessionNumber = 1

  function send(session: LspSession, message: unknown): void {
    if (!session.disposed) {
      session.child.stdin.write(encodeLspMessage(message))
    }
  }

  function sendRequest(session: LspSession, method: string, params: unknown): Promise<unknown> {
    if (session.disposed) {
      return Promise.reject(new Error('LSP session is closed'))
    }
    const id = session.nextRequestId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(id)
        reject(new Error(`LSP request timed out: ${method}`))
      }, REQUEST_TIMEOUT_MS)
      session.pending.set(id, { resolve, reject, timer })
      send(session, { jsonrpc: '2.0', id, method, params })
    })
  }

  function disposeSession(session: LspSession, error?: Error, alreadyExited = false): void {
    if (session.disposed) {
      return
    }
    const childExited = alreadyExited || childHasExited(session)
    clearTerminationTimers(session)
    publishClearDiagnostics(session, diagnosticsListeners)
    session.disposed = true
    if (session.idleTimer) {
      clearTimeout(session.idleTimer)
      session.idleTimer = null
    }
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error ?? new Error('LSP session closed'))
    }
    session.pending.clear()
    session.documentsByUri.clear()
    sessionsByKey.delete(session.key)
    sessionsById.delete(session.sessionId)
    if (!childExited) {
      scheduleChildTermination(session)
    }
  }

  function scheduleIdleShutdown(session: LspSession): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer)
    }
    session.idleTimer = setTimeout(() => {
      if (session.documentsByUri.size === 0) {
        disposeSession(session)
      }
    }, IDLE_SHUTDOWN_MS)
  }

  function createSession(
    descriptor: LspServerDescriptor,
    rootPath: string,
    key: string
  ): LspSession {
    const child = (deps?.spawnServer ?? spawnLspServer)(descriptor, rootPath)
    const session: LspSession = {
      sessionId: `lsp-${nextSessionNumber++}`,
      key,
      serverId: descriptor.serverId,
      resolvedCommand: descriptor.resolvedCommand ?? descriptor.command,
      source: descriptor.source ?? 'PATH',
      pythonPath: descriptor.pythonPath,
      child,
      nextRequestId: 1,
      pending: new Map(),
      documentsByUri: new Map(),
      initialization: Promise.resolve(),
      pullDiagnostics: false,
      idleTimer: null,
      terminationTimers: null,
      disposed: false
    }
    const decoder = new LspMessageDecoder()
    child.stdout.on('data', (chunk: Buffer) => {
      for (const message of decoder.push(chunk)) {
        handleServerMessage(session, message, send, diagnosticsListeners)
      }
    })
    child.on('error', (error) => {
      clearTerminationTimers(session)
      disposeSession(session, error)
    })
    child.on('exit', () => {
      clearTerminationTimers(session)
      disposeSession(session, new Error('LSP server exited'), true)
    })
    child.stdin.on('error', () => disposeSession(session, new Error('LSP server pipe closed')))

    session.initialization = sendRequest(
      session,
      'initialize',
      buildLspInitializeParams(rootPath)
    ).then((result) => {
      Object.assign(session, parseLspServerCapabilities(result))
      send(session, { jsonrpc: '2.0', method: 'initialized', params: {} })
    })
    session.initialization.catch(() => {})
    return session
  }

  const noSession: LspOpenDocumentResult = { sessions: [], fileUri: null }

  async function openDocument(args: {
    filePath: string
    rootPath: string
    languageId: string
    text: string
  }): Promise<LspOpenDocumentResult> {
    const descriptors = await resolveLspServersForLanguage(
      args.languageId,
      args.filePath,
      args.rootPath,
      deps?.probeCommand,
      { trustedRootsFilePath: deps?.trustedRootsFilePath }
    )
    const projectToolsSkippedReason = getProjectToolsSkippedReason(
      args.languageId,
      args.filePath,
      args.rootPath,
      { trustedRootsFilePath: deps?.trustedRootsFilePath }
    )
    if (descriptors.length === 0) {
      return projectToolsSkippedReason ? { ...noSession, projectToolsSkippedReason } : noSession
    }
    const fileUri = pathToFileURL(args.filePath).toString()
    const sessions: LspSessionInfo[] = []
    for (const descriptor of descriptors) {
      const key = `${descriptor.serverId} ${args.rootPath} ${descriptor.resolvedCommand ?? descriptor.command}`
      let session = sessionsByKey.get(key)
      if (!session || session.disposed) {
        if (sessionsByKey.size >= MAX_CONCURRENT_SESSIONS) {
          continue
        }
        session = createSession(descriptor, args.rootPath, key)
        sessionsByKey.set(key, session)
        sessionsById.set(session.sessionId, session)
      }
      try {
        await session.initialization
      } catch {
        disposeSession(session)
        continue
      }
      if (session.disposed) {
        continue
      }
      if (session.idleTimer) {
        clearTimeout(session.idleTimer)
        session.idleTimer = null
      }
      const documentKey = canonicalFileUriKey(fileUri)
      const existing = session.documentsByUri.get(documentKey)
      if (existing) {
        existing.refCount++
        sendDidChange(session, existing.fileUri, existing, args.text)
      } else {
        session.documentsByUri.set(documentKey, { fileUri, version: 1, refCount: 1 })
        send(session, {
          jsonrpc: '2.0',
          method: 'textDocument/didOpen',
          params: {
            textDocument: {
              uri: fileUri,
              languageId: toLspDocumentLanguageId(args.languageId, args.filePath),
              version: 1,
              text: args.text
            }
          }
        })
      }
      sessions.push({
        sessionId: session.sessionId,
        fileUri,
        serverId: session.serverId,
        resolvedCommand: session.resolvedCommand,
        source: session.source,
        isPrimary: descriptor.role !== 'diagnostics-only',
        pullDiagnostics: session.pullDiagnostics,
        ...(session.semanticTokensLegend
          ? { semanticTokensLegend: session.semanticTokensLegend }
          : {}),
        ...(session.documentLinks ? { documentLinks: session.documentLinks } : {})
      })
    }
    return sessions.length > 0
      ? { sessions, fileUri, ...(projectToolsSkippedReason ? { projectToolsSkippedReason } : {}) }
      : projectToolsSkippedReason
        ? { ...noSession, projectToolsSkippedReason }
        : noSession
  }

  function sendDidChange(
    session: LspSession,
    fileUri: string,
    document: OpenDocumentState,
    text: string
  ): void {
    document.version++
    send(session, {
      jsonrpc: '2.0',
      method: 'textDocument/didChange',
      params: {
        textDocument: { uri: fileUri, version: document.version },
        contentChanges: [{ text }]
      }
    })
  }

  function changeDocument(sessionId: string, fileUri: string, text: string): void {
    const session = sessionsById.get(sessionId)
    const document = session?.documentsByUri.get(canonicalFileUriKey(fileUri))
    if (!session || !document) {
      return
    }
    sendDidChange(session, document.fileUri, document, text)
  }

  function closeDocument(sessionId: string, fileUri: string): void {
    const session = sessionsById.get(sessionId)
    const documentKey = canonicalFileUriKey(fileUri)
    const document = session?.documentsByUri.get(documentKey)
    if (!session || !document) {
      return
    }
    document.refCount--
    if (document.refCount > 0) {
      return
    }
    session.documentsByUri.delete(documentKey)
    send(session, {
      jsonrpc: '2.0',
      method: 'textDocument/didClose',
      params: { textDocument: { uri: document.fileUri } }
    })
    if (session.documentsByUri.size === 0) {
      scheduleIdleShutdown(session)
    }
  }

  function request(sessionId: string, method: LspRequestMethod, params: unknown): Promise<unknown> {
    const session = sessionsById.get(sessionId)
    if (!session) {
      return Promise.reject(new Error('Unknown LSP session'))
    }
    return sendRequest(session, method, params)
  }

  function onDiagnostics(listener: LspDiagnosticsListener): () => void {
    diagnosticsListeners.add(listener)
    return () => diagnosticsListeners.delete(listener)
  }

  function disposeAll(): void {
    for (const session of sessionsById.values()) {
      disposeSession(session)
    }
  }

  return { openDocument, changeDocument, closeDocument, request, onDiagnostics, disposeAll }
}
