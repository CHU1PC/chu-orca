import type { languages } from 'monaco-editor'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  entry: {
    sessionId: 'session-1',
    fileUri: 'file:///workspace/a.ts',
    filePath: '/workspace/a.ts',
    rootPath: '/workspace',
    worktreeId: 'wt-1',
    serverId: 'tsgo',
    resolvedCommand: '/bin/tsgo',
    source: 'PATH' as const,
    isPrimary: true,
    pullDiagnostics: false,
    model: { uri: { toString: () => 'file:///workspace/a.ts' }, isDisposed: () => false },
    refCount: 1,
    changeTimer: null,
    lastSync: Promise.resolve(),
    contentListener: null,
    modelDispose: null
  },
  request: vi.fn(),
  flush: vi.fn(),
  trackModel: vi.fn()
}))

vi.mock('./monaco-lsp-documents', () => ({
  getLspEntryForModelUri: vi.fn(() => mocks.entry),
  getLspEntriesForSessionDocument: vi.fn(() => [mocks.entry]),
  flushPendingLspChange: mocks.flush
}))

vi.mock('./monaco-lsp-inline-diagnostics', () => ({
  createInlineDiagnosticsWiring: vi.fn(() => ({
    trackModel: mocks.trackModel,
    dispose: vi.fn()
  }))
}))

import {
  ensureInlineDiagnosticsForModel,
  ensureLspSupportForLanguage
} from './monaco-lsp-providers'

type ProviderSet = {
  hover?: languages.HoverProvider
  definition?: languages.DefinitionProvider
  references?: languages.ReferenceProvider
  completion?: languages.CompletionItemProvider
}

function fakeMonaco(): {
  monaco: unknown
  providers: ProviderSet
  setMarkers: ReturnType<typeof vi.fn>
} {
  const providers: ProviderSet = {}
  const setMarkers = vi.fn()
  const disposable = () => ({ dispose: vi.fn() })
  const monaco = {
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
    Uri: { parse: (value: string) => ({ toString: () => value }) },
    editor: {
      getModelMarkers: vi.fn(() => []),
      onDidChangeMarkers: vi.fn(() => disposable()),
      registerEditorOpener: vi.fn(() => disposable()),
      setModelMarkers: setMarkers
    },
    languages: {
      CompletionItemKind: { Text: 18, Function: 1 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      registerHoverProvider: vi.fn((_language: string, provider: languages.HoverProvider) => {
        providers.hover = provider
        return disposable()
      }),
      registerDefinitionProvider: vi.fn(
        (_language: string, provider: languages.DefinitionProvider) => {
          providers.definition = provider
          return disposable()
        }
      ),
      registerReferenceProvider: vi.fn(
        (_language: string, provider: languages.ReferenceProvider) => {
          providers.references = provider
          return disposable()
        }
      ),
      registerCompletionItemProvider: vi.fn(
        (_language: string, provider: languages.CompletionItemProvider) => {
          providers.completion = provider
          return disposable()
        }
      )
    }
  }
  return { monaco, providers, setMarkers }
}

function installWindowApi(): void {
  if (typeof window === 'undefined') {
    Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true })
  }
  Object.assign(window, {
    api: { lsp: { request: mocks.request, onDiagnostics: vi.fn(() => () => {}) } }
  })
}

describe('ensureLspSupportForLanguage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.flush.mockResolvedValue(undefined)
    mocks.request.mockResolvedValue({ contents: 'hover' })
    installWindowApi()
  })

  it('registers each language once and reuses the global wiring', () => {
    const first = fakeMonaco()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture contains every Monaco member read by ensureLspSupportForLanguage.
    ensureLspSupportForLanguage(first.monaco as never, 'typescript')
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture contains every Monaco member read by ensureLspSupportForLanguage.
    ensureLspSupportForLanguage(first.monaco as never, 'typescript')

    expect(first.providers.hover).toBeDefined()
    expect(first.providers.definition).toBeDefined()
    expect(first.providers.references).toBeDefined()
    expect(first.providers.completion).toBeDefined()
  })

  it('routes diagnostics to every live model entry', () => {
    const first = fakeMonaco()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture contains every Monaco member read by ensureLspSupportForLanguage.
    ensureLspSupportForLanguage(first.monaco as never, 'python')
    const diagnostics = vi.mocked(window.api.lsp.onDiagnostics).mock.calls[0]?.[0]
    diagnostics?.({
      sessionId: 'session-1',
      fileUri: 'file:///workspace/a.ts',
      serverId: 'tsgo',
      diagnostics: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: 'bad'
        }
      ]
    })

    expect(first.setMarkers).toHaveBeenCalledWith(
      mocks.entry.model,
      'orca-lsp:tsgo',
      expect.arrayContaining([expect.objectContaining({ message: 'bad' })])
    )
  })

  it('returns the active inline diagnostics cleanup for a registered Monaco instance', () => {
    const first = fakeMonaco()
    mocks.trackModel.mockReturnValue(vi.fn())
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture contains every Monaco member read by ensureLspSupportForLanguage.
    ensureLspSupportForLanguage(first.monaco as never, 'json')

    const cleanup = ensureInlineDiagnosticsForModel(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture editor has the members used by the inline wiring.
      first.monaco as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture editor has the members used by the inline wiring.
      {} as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture model has the members used by the inline wiring.
      mocks.entry.model as never
    )

    expect(mocks.trackModel).toHaveBeenCalled()
    expect(cleanup).toBeDefined()
  })
})
