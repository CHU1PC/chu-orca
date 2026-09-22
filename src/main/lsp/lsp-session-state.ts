// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.
import type { ChildProcessWithoutNullStreams } from '../../shared/child-process/run-process'

export type PendingRequest = {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

// Why: documentsByUri is keyed by canonicalFileUriKey; keep the exact URI the
// client knows so diagnostics forwarded to the renderer match its lookups.
export type OpenDocumentState = { fileUri: string; version: number; refCount: number }

export type LspSession = {
  sessionId: string
  key: string
  serverId: string
  resolvedCommand: string
  source: 'project' | 'PATH'
  pythonPath?: string
  child: ChildProcessWithoutNullStreams
  nextRequestId: number
  pending: Map<number, PendingRequest>
  documentsByUri: Map<string, OpenDocumentState>
  initialization: Promise<void>
  // Why: pull-model servers (tsgo, TS7) advertise diagnosticProvider and never
  // push; the renderer must know which model this session speaks.
  pullDiagnostics: boolean
  idleTimer: NodeJS.Timeout | null
  terminationTimers: {
    shutdown: NodeJS.Timeout | null
    term: NodeJS.Timeout | null
    kill: NodeJS.Timeout | null
  } | null
  disposed: boolean
}

export type LspDiagnosticsListener = (payload: {
  sessionId: string
  fileUri: string
  serverId: string
  diagnostics: unknown[]
}) => void
