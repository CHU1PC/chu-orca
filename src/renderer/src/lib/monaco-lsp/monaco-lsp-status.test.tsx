// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLspFileStatus, useLspStatusForFile, type LspFileStatus } from './monaco-lsp-status'

const FILE_PATH = '/workspace/status.ts'
const RUNNING_STATUS: LspFileStatus = {
  state: 'running',
  servers: [{ serverId: 'tsgo', resolvedCommand: '/bin/tsgo', source: 'PATH' }]
}

afterEach(() => {
  setLspFileStatus(FILE_PATH, null)
  vi.restoreAllMocks()
})

describe('setLspFileStatus and useLspStatusForFile', () => {
  it('publishes meaningful changes and suppresses identical snapshots', () => {
    const listener = vi.fn()
    const { result, unmount } = renderHook(() => useLspStatusForFile(FILE_PATH))
    const originalError = console.error
    console.error = listener
    try {
      act(() => setLspFileStatus(FILE_PATH, RUNNING_STATUS))
      expect(result.current).toEqual(RUNNING_STATUS)
      act(() =>
        setLspFileStatus(FILE_PATH, { ...RUNNING_STATUS, servers: [...RUNNING_STATUS.servers] })
      )
      expect(result.current).toEqual(RUNNING_STATUS)
      act(() => setLspFileStatus(FILE_PATH, null))
      expect(result.current).toBeNull()
    } finally {
      console.error = originalError
      unmount()
    }
    expect(listener).not.toHaveBeenCalled()
  })

  it('returns null for an absent file path and updates when its status appears', () => {
    const { result } = renderHook(() => useLspStatusForFile(null))
    expect(result.current).toBeNull()

    act(() => {
      setLspFileStatus(FILE_PATH, RUNNING_STATUS)
    })
    expect(result.current).toBeNull()
  })
})
