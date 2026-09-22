import { describe, expect, it } from 'vitest'
import type { OpenDocumentState, PendingRequest } from './lsp-session-state'

describe('LSP session state contracts', () => {
  it('represents a document and a pending request without changing their fields', () => {
    const document: OpenDocumentState = {
      fileUri: 'file:///workspace/example.ts',
      version: 3,
      refCount: 2
    }
    const timer = setTimeout(() => {}, 1_000)
    const pending: PendingRequest = {
      resolve: () => {},
      reject: () => {},
      timer
    }

    expect(document).toEqual({
      fileUri: 'file:///workspace/example.ts',
      version: 3,
      refCount: 2
    })
    expect(pending.timer).toBe(timer)
    clearTimeout(timer)
  })
})
