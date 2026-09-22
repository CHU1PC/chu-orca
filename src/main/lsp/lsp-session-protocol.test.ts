import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from '../../shared/child-process/run-process'
import { describe, expect, it, vi } from 'vitest'
import type { LspSession } from './lsp-session-state'
import { handleServerMessage } from './lsp-session-protocol'

function createSession(): LspSession {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fake child is populated with the three streams and kill-related fields required by LspSession consumers in this test.
  const child = new EventEmitter() as ChildProcessWithoutNullStreams & EventEmitter
  Object.assign(child, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn()
  })
  return {
    sessionId: 'session-1',
    key: 'server /workspace',
    serverId: 'example',
    resolvedCommand: '/bin/example',
    source: 'PATH',
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
}

describe('handleServerMessage', () => {
  it('drops malformed server values and continues handling valid responses', () => {
    const session = createSession()
    const resolve = vi.fn()
    const reject = vi.fn()
    const timer = setTimeout(() => {}, 1_000)
    session.pending.set(1, {
      resolve,
      reject,
      timer
    })
    const send = vi.fn()

    const malformed: unknown[] = [
      null,
      [],
      { id: true },
      { method: 1 },
      { params: null },
      { result: Symbol('not-json') },
      { error: 'not-an-error-object' },
      { method: 'textDocument/publishDiagnostics', params: { uri: 3 } },
      { method: 'textDocument/publishDiagnostics', params: { diagnostics: {} } },
      { method: 'workspace/configuration', params: { items: {} } }
    ]
    for (const message of malformed) {
      expect(() => handleServerMessage(session, message, send, new Set())).not.toThrow()
    }
    expect(resolve).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()

    handleServerMessage(session, { id: 1, result: { ok: true } }, send, new Set())
    expect(resolve).toHaveBeenCalledWith({ ok: true })
    clearTimeout(timer)
  })

  it('preserves diagnostics and server-request responses for valid messages', () => {
    const session = createSession()
    session.pythonPath = '/workspace/.venv/bin/python'
    const diagnostics = vi.fn()
    const send = vi.fn()
    session.documentsByUri.set('file:///workspace/example.ts', {
      fileUri: 'file:///workspace/example.ts',
      version: 1,
      refCount: 1
    })

    handleServerMessage(
      session,
      {
        method: 'textDocument/publishDiagnostics',
        params: { uri: 'file:///workspace/example.ts', diagnostics: [{ message: 'boom' }] }
      },
      send,
      new Set([diagnostics])
    )
    expect(diagnostics).toHaveBeenCalledWith({
      sessionId: 'session-1',
      fileUri: 'file:///workspace/example.ts',
      serverId: 'example',
      diagnostics: [{ message: 'boom' }]
    })

    handleServerMessage(
      session,
      { id: 7, method: 'workspace/configuration', params: { items: [{ section: 'python' }] } },
      send,
      new Set()
    )
    expect(send).toHaveBeenLastCalledWith(session, {
      jsonrpc: '2.0',
      id: 7,
      result: [{ pythonPath: '/workspace/.venv/bin/python' }]
    })
  })
})
