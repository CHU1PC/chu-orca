import type { editor } from 'monaco-editor'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  ensureSupport: vi.fn(),
  ensureInline: vi.fn(),
  clearMarkers: vi.fn()
}))

vi.mock('@/lib/monaco-setup', () => ({
  monaco: { MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 } }
}))

vi.mock('./monaco-lsp-documents', () => ({
  openLspDocumentForModel: mocks.open,
  closeLspDocumentForModel: mocks.close,
  getLspEntriesForModelUri: vi.fn(() => [])
}))

vi.mock('./monaco-lsp-providers', () => ({
  ensureLspSupportForLanguage: mocks.ensureSupport,
  ensureInlineDiagnosticsForModel: mocks.ensureInline,
  clearLspMarkers: mocks.clearMarkers
}))

import { attachMonacoLspDocument } from './monaco-lsp-attach'

function fixture(): {
  model: editor.ITextModel
  editor: editor.ICodeEditor
  params: Parameters<typeof attachMonacoLspDocument>[0]
} {
  const model = {
    uri: { toString: () => 'file:///workspace/a.ts' },
    isDisposed: () => false
  }
  const mountedEditor = { getModel: () => model, updateOptions: vi.fn() }
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture implements every member read by attachMonacoLspDocument and its mocked collaborators.
    model: model as unknown as editor.ITextModel,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture implements every member read by attachMonacoLspDocument and its mocked collaborators.
    editor: mountedEditor as unknown as editor.ICodeEditor,
    params: {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture implements every member read by attachMonacoLspDocument and its mocked collaborators.
      model: model as unknown as editor.ITextModel,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture implements every member read by attachMonacoLspDocument and its mocked collaborators.
      editor: mountedEditor as unknown as editor.ICodeEditor,
      filePath: '/workspace/a.ts',
      rootPath: '/workspace',
      worktreeId: 'wt-1',
      languageId: 'typescript'
    }
  }
}

describe('attachMonacoLspDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.open.mockResolvedValue({ sessionId: 'session-1' })
    mocks.ensureInline.mockReturnValue(vi.fn())
  })

  it('opens the document and wires providers after the open round-trip', async () => {
    const { params } = fixture()
    const detach = attachMonacoLspDocument(params)

    await vi.waitFor(() =>
      expect(mocks.ensureSupport).toHaveBeenCalledWith(expect.anything(), 'typescript', [])
    )
    expect(mocks.open).toHaveBeenCalledWith({
      model: params.model,
      filePath: '/workspace/a.ts',
      rootPath: '/workspace',
      worktreeId: 'wt-1',
      languageId: 'typescript'
    })
    expect(mocks.ensureInline).toHaveBeenCalledWith(expect.anything(), params.editor, params.model)

    detach()
    expect(mocks.close).toHaveBeenCalledWith('file:///workspace/a.ts', expect.any(Function))
  })

  it('closes a document that finishes opening after detach', async () => {
    const { params } = fixture()
    let resolveOpen: (value: unknown) => void = () => {}
    mocks.open.mockReturnValue(
      new Promise((resolve) => {
        resolveOpen = resolve
      })
    )

    const detach = attachMonacoLspDocument(params)
    detach()
    resolveOpen({ sessionId: 'session-1' })
    await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1))
    expect(mocks.ensureSupport).not.toHaveBeenCalled()
    expect(mocks.ensureInline).not.toHaveBeenCalled()
  })
})
