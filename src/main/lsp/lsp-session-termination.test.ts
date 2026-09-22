import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from '../../shared/child-process/run-process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LspMessageDecoder } from './lsp-message-framing'
import {
  LSP_SHUTDOWN_GRACE_MS,
  LSP_TERM_GRACE_MS,
  childHasExited,
  clearTerminationTimers,
  scheduleChildTermination,
  type LspTerminationTarget
} from './lsp-session-termination'

function createTarget(
  exitCode: number | null = null,
  signalCode: NodeJS.Signals | null = null
): LspTerminationTarget {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fake child is populated with the streams, exit state, and kill method consumed by termination scheduling.
  const child = new EventEmitter() as ChildProcessWithoutNullStreams & EventEmitter
  Object.assign(child, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode,
    signalCode,
    kill: vi.fn(() => true)
  })
  return { child, nextRequestId: 1, terminationTimers: null }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('lsp-session-termination', () => {
  it('recognizes both normal and signal exits', () => {
    expect(childHasExited(createTarget())).toBe(false)
    expect(childHasExited(createTarget(0))).toBe(true)
    expect(childHasExited(createTarget(null, 'SIGTERM'))).toBe(true)
  })

  it('sends shutdown, exit, SIGTERM, and SIGKILL in order', () => {
    vi.useFakeTimers()
    const target = createTarget()
    const decoder = new LspMessageDecoder()
    const messages: unknown[] = []
    target.child.stdin.on('data', (chunk: Buffer) => messages.push(...decoder.push(chunk)))

    scheduleChildTermination(target)
    expect(messages).toEqual([{ jsonrpc: '2.0', id: 1, method: 'shutdown', params: null }])
    vi.advanceTimersByTime(LSP_SHUTDOWN_GRACE_MS)
    expect(messages).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'shutdown', params: null },
      { jsonrpc: '2.0', method: 'exit' }
    ])
    vi.advanceTimersByTime(LSP_TERM_GRACE_MS)
    expect(target.child.kill).toHaveBeenCalledWith('SIGTERM')
    vi.advanceTimersByTime(LSP_TERM_GRACE_MS)
    expect(target.child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('clears all scheduled timers', () => {
    vi.useFakeTimers()
    const target = createTarget()
    scheduleChildTermination(target)
    expect(target.terminationTimers).not.toBeNull()
    clearTerminationTimers(target)
    expect(target.terminationTimers).toBeNull()
  })
})
