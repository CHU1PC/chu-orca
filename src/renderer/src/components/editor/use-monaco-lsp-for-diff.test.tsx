// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import type { editor } from 'monaco-editor'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type TestState = {
  worktreesByRepo: Record<string, { id: string; path: string }[]>
  connectionId: string | null | undefined
}

const store = vi.hoisted(() => {
  const current: { value: TestState } = {
    value: {
      worktreesByRepo: { repo: [{ id: 'wt-1', path: '/workspace' }] },
      connectionId: null
    }
  }
  const listeners = new Set<() => void>()
  return {
    current,
    listeners,
    setConnectionId(connectionId: string | null | undefined): void {
      current.value = { ...current.value, connectionId }
      for (const listener of listeners) {
        listener()
      }
    }
  }
})

const mocks = vi.hoisted(() => ({ attach: vi.fn() }))

vi.mock('@/store', async () => {
  const React = await import('react')
  return {
    useAppStore: (selector: (state: TestState) => unknown): unknown => {
      const snapshot = React.useSyncExternalStore(
        (listener) => {
          store.listeners.add(listener)
          return () => store.listeners.delete(listener)
        },
        () => store.current.value,
        () => store.current.value
      )
      return selector(snapshot)
    }
  }
})

vi.mock('@/store/slices/worktree-helpers', () => ({
  findWorktreeById: (worktreesByRepo: TestState['worktreesByRepo'], worktreeId: string) =>
    Object.values(worktreesByRepo)
      .flat()
      .find((worktree) => worktree.id === worktreeId)
}))

vi.mock('@/lib/connection-context', () => ({
  getConnectionIdFromState: (state: TestState) => state.connectionId
}))

vi.mock('@/lib/monaco-lsp/monaco-lsp-attach', () => ({
  attachMonacoLspDocument: mocks.attach
}))

import { useMonacoLspForDiff } from './use-monaco-lsp-for-diff'

function fakeEditor(): editor.ICodeEditor {
  const model = { isDisposed: () => false }
  const mountedEditor = { getModel: () => model }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture implements getModel, the only editor member read by this hook.
  return mountedEditor as unknown as editor.ICodeEditor
}

describe('useMonacoLspForDiff', () => {
  beforeEach(() => {
    mocks.attach.mockReset().mockReturnValue(vi.fn())
    store.setConnectionId(null)
    Object.assign(window, { api: { lsp: {} } })
  })

  it('reattaches the modified pane when the owning connection changes back to local', () => {
    const modifiedEditor = fakeEditor()
    const { unmount } = renderHook(() =>
      useMonacoLspForDiff({
        modifiedEditor,
        relativePath: 'src/a.ts',
        worktreeId: 'wt-1',
        language: 'typescript',
        modelIdentity: 'model-1'
      })
    )
    expect(mocks.attach).toHaveBeenCalledTimes(1)

    act(() => store.setConnectionId('ssh-1'))
    expect(mocks.attach).toHaveBeenCalledTimes(1)

    act(() => store.setConnectionId(null))
    expect(mocks.attach).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('does not attach while the worktree connection is unresolved', () => {
    store.setConnectionId(undefined)
    const { unmount } = renderHook(() =>
      useMonacoLspForDiff({
        modifiedEditor: fakeEditor(),
        relativePath: 'src/a.ts',
        worktreeId: 'wt-1',
        language: 'typescript',
        modelIdentity: 'model-1'
      })
    )

    expect(mocks.attach).not.toHaveBeenCalled()
    unmount()
  })
})
