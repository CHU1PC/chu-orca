// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { editor } from 'monaco-editor'

vi.mock('@/lib/monaco-setup', () => ({
  monaco: {
    editor: { setModelMarkers: vi.fn() },
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 }
  }
}))

import {
  closeLspDocumentForModel,
  getLspEntriesForSessionDocument,
  openLspDocumentForModel
} from './monaco-lsp-documents'

type FakeModel = editor.ITextModel & {
  setFakeValue: (text: string) => void
  contentDispose: ReturnType<typeof vi.fn>
}

function fakeModel(uri: string, text: string): FakeModel {
  let value = text
  let disposed = false
  let disposeListener: (() => void) | null = null
  const contentDispose = vi.fn()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fake model implements every ITextModel member read by the document lifecycle under test.
  return {
    uri: { toString: () => uri },
    getValue: () => value,
    isDisposed: () => disposed,
    onDidChangeContent: () => ({ dispose: contentDispose }),
    onWillDispose: (listener: () => void) => {
      disposeListener = listener
      return { dispose: vi.fn(() => (disposeListener = null)) }
    },
    setFakeValue: (next: string) => {
      value = next
    },
    dispose: () => {
      disposed = true
      disposeListener?.()
    },
    contentDispose
  } as unknown as FakeModel
}

const OPEN_RESULT = {
  fileUri: 'file:///w/src/a.ts',
  sessions: [
    {
      sessionId: 'lsp-1',
      fileUri: 'file:///w/src/a.ts',
      serverId: 'tsgo',
      resolvedCommand: '/bin/tsgo',
      source: 'PATH',
      isPrimary: true,
      pullDiagnostics: false,
      semanticTokensLegend: {
        tokenTypes: ['keyword', 'comment'],
        tokenModifiers: ['declaration']
      },
      documentLinks: { resolveProvider: true }
    },
    {
      sessionId: 'lsp-2',
      fileUri: 'file:///w/src/a.ts',
      serverId: 'ruff',
      resolvedCommand: '/bin/ruff',
      source: 'PATH',
      isPrimary: false,
      pullDiagnostics: false
    }
  ]
}

const openParams = {
  filePath: '/w/src/a.ts',
  rootPath: '/w',
  worktreeId: 'wt-1',
  languageId: 'typescript'
}

function stubLspApi(): {
  openDocument: ReturnType<typeof vi.fn>
  changeDocument: ReturnType<typeof vi.fn>
  closeDocument: ReturnType<typeof vi.fn>
} {
  const api = {
    openDocument: vi.fn().mockResolvedValue(OPEN_RESULT),
    changeDocument: vi.fn().mockResolvedValue(undefined),
    closeDocument: vi.fn().mockResolvedValue(undefined),
    request: vi.fn().mockResolvedValue(null),
    onDiagnostics: vi.fn(() => () => {})
  }
  if (typeof window === 'undefined') {
    Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true })
  }
  Object.assign(window, { api: { lsp: api } })
  return api
}

describe('openLspDocumentForModel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fans diagnostics routing out to every surface of the same server document', async () => {
    stubLspApi()
    const tabModel = fakeModel('file:///w/src/a.ts', 'x')
    const diffModel = fakeModel('diff-section:wt-1:a:0:modified', 'x')
    await openLspDocumentForModel({ ...openParams, model: tabModel })
    await openLspDocumentForModel({ ...openParams, model: diffModel })
    expect(getLspEntriesForSessionDocument('lsp-1', OPEN_RESULT.fileUri)).toHaveLength(2)
    expect(getLspEntriesForSessionDocument('lsp-2', OPEN_RESULT.fileUri)).toHaveLength(2)

    // Why: closing one surface must not delete the other surface's routing.
    closeLspDocumentForModel(tabModel.uri.toString(), () => {})
    const remaining = getLspEntriesForSessionDocument('lsp-1', OPEN_RESULT.fileUri)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].model).toBe(diffModel)
    closeLspDocumentForModel(diffModel.uri.toString(), () => {})
    expect(getLspEntriesForSessionDocument('lsp-1', OPEN_RESULT.fileUri)).toHaveLength(0)
  })

  it('carries semantic token and document link capabilities onto opened entries', async () => {
    stubLspApi()
    const model = fakeModel('file:///w/src/a.ts', 'x')
    const entry = await openLspDocumentForModel({ ...openParams, model })

    expect(entry).toMatchObject({
      semanticTokensLegend: {
        tokenTypes: ['keyword', 'comment'],
        tokenModifiers: ['declaration']
      },
      documentLinks: { resolveProvider: true }
    })
    closeLspDocumentForModel(model.uri.toString(), () => {})
  })

  it('re-syncs text that changed while the open round-trip was in flight', async () => {
    const api = stubLspApi()
    const model = fakeModel('file:///w/src/b.ts', 'before')
    api.openDocument.mockImplementation(async () => {
      model.setFakeValue('after keystrokes')
      return {
        ...OPEN_RESULT,
        fileUri: 'file:///w/src/b.ts',
        sessions: OPEN_RESULT.sessions.map((session) => ({
          ...session,
          fileUri: 'file:///w/src/b.ts'
        }))
      }
    })
    await openLspDocumentForModel({ ...openParams, filePath: '/w/src/b.ts', model })
    await vi.waitFor(() =>
      expect(api.changeDocument).toHaveBeenCalledWith({
        sessionId: 'lsp-1',
        fileUri: 'file:///w/src/b.ts',
        text: 'after keystrokes'
      })
    )
    closeLspDocumentForModel(model.uri.toString(), () => {})
  })

  it('clears markers independently for each server when a model closes', async () => {
    stubLspApi()
    const model = fakeModel('file:///w/src/c.py', 'x')
    await openLspDocumentForModel({
      ...openParams,
      filePath: '/w/src/c.py',
      model,
      languageId: 'python'
    })
    const cleared: string[] = []
    closeLspDocumentForModel(model.uri.toString(), (_model, serverId) => cleared.push(serverId))
    expect(cleared.sort()).toEqual(['ruff', 'tsgo'])
  })

  it('detaches listeners and closes sessions when Monaco disposes the model', async () => {
    const api = stubLspApi()
    const model = fakeModel('file:///w/src/disposed.ts', 'x')
    await openLspDocumentForModel({ ...openParams, filePath: '/w/src/disposed.ts', model })
    await openLspDocumentForModel({ ...openParams, filePath: '/w/src/disposed.ts', model })

    model.dispose()
    model.dispose()

    expect(model.contentDispose).toHaveBeenCalledTimes(2)
    expect(api.closeDocument).toHaveBeenCalledTimes(2)
    expect(getLspEntriesForSessionDocument('lsp-1', OPEN_RESULT.fileUri)).toHaveLength(0)
  })
})
