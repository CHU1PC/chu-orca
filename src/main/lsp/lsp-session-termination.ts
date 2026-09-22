import type { ChildProcessWithoutNullStreams } from '../../shared/child-process/run-process'
import { encodeLspMessage } from './lsp-message-framing'

export const LSP_SHUTDOWN_GRACE_MS = 250
export const LSP_TERM_GRACE_MS = 750

export type LspTerminationTarget = {
  child: ChildProcessWithoutNullStreams
  nextRequestId: number
  terminationTimers: {
    shutdown: NodeJS.Timeout | null
    term: NodeJS.Timeout | null
    kill: NodeJS.Timeout | null
  } | null
}

export function clearTerminationTimers(session: LspTerminationTarget): void {
  const timers = session.terminationTimers
  if (!timers) {
    return
  }
  for (const timer of [timers.shutdown, timers.term, timers.kill]) {
    if (timer) {
      clearTimeout(timer)
    }
  }
  session.terminationTimers = null
}

export function childHasExited(session: LspTerminationTarget): boolean {
  return session.child.exitCode != null || session.child.signalCode != null
}

function sendToChild(session: LspTerminationTarget, message: unknown): void {
  try {
    session.child.stdin.write(encodeLspMessage(message))
  } catch {
    // The child may close its pipe while disposal is being scheduled.
  }
}

export function scheduleChildTermination(session: LspTerminationTarget): void {
  if (childHasExited(session)) {
    return
  }
  sendToChild(session, {
    jsonrpc: '2.0',
    id: session.nextRequestId++,
    method: 'shutdown',
    params: null
  })
  const shutdown = setTimeout(() => {
    if (childHasExited(session)) {
      return
    }
    sendToChild(session, { jsonrpc: '2.0', method: 'exit' })
    const term = setTimeout(() => {
      if (childHasExited(session)) {
        return
      }
      try {
        session.child.kill('SIGTERM')
      } catch {
        return
      }
      const kill = setTimeout(() => {
        if (childHasExited(session)) {
          return
        }
        try {
          session.child.kill('SIGKILL')
        } catch {
          // The child may have exited between the check and kill.
        }
      }, LSP_TERM_GRACE_MS)
      kill.unref()
      if (session.terminationTimers) {
        session.terminationTimers.kill = kill
      }
    }, LSP_TERM_GRACE_MS)
    term.unref()
    if (session.terminationTimers) {
      session.terminationTimers.term = term
    }
  }, LSP_SHUTDOWN_GRACE_MS)
  shutdown.unref()
  session.terminationTimers = { shutdown, term: null, kill: null }
  if (childHasExited(session)) {
    clearTerminationTimers(session)
  }
}
