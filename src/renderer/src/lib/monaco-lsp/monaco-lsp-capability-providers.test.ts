import { describe, expect, it, vi } from 'vitest'
import type { LspDocumentEntry } from './monaco-lsp-documents'

vi.mock('./monaco-lsp-documents', () => ({
  flushPendingLspChange: vi.fn(),
  getLspEntriesForModelUri: vi.fn(() => [])
}))

import { ensureCapabilityLspProviders } from './monaco-lsp-capability-providers'

function fakeMonaco() {
  const disposables: { dispose: ReturnType<typeof vi.fn> }[] = []
  const makeDisposable = () => {
    const disposable = { dispose: vi.fn() }
    disposables.push(disposable)
    return disposable
  }
  const semanticRegistrations = vi.fn((_language: string, _provider: unknown) => makeDisposable())
  const linkRegistrations = vi.fn((_language: string, _provider: unknown) => makeDisposable())
  const openerRegistrations = vi.fn((_opener: unknown) => makeDisposable())
  return {
    monaco: {
      languages: {
        registerDocumentSemanticTokensProvider: semanticRegistrations,
        registerLinkProvider: linkRegistrations
      },
      editor: { registerLinkOpener: openerRegistrations }
    },
    semanticRegistrations,
    linkRegistrations,
    openerRegistrations,
    disposables
  }
}

const supportedEntry: Pick<LspDocumentEntry, 'semanticTokensLegend' | 'documentLinks'> = {
  semanticTokensLegend: { tokenTypes: ['keyword'], tokenModifiers: [] },
  documentLinks: { resolveProvider: true }
}

describe('ensureCapabilityLspProviders', () => {
  it('registers providers once per language and the opener once per Monaco', () => {
    const fake = fakeMonaco()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture supplies the Monaco registration methods used by this module.
    ensureCapabilityLspProviders(fake.monaco as never, 'dockerfile', [supportedEntry])
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture supplies the Monaco registration methods used by this module.
    ensureCapabilityLspProviders(fake.monaco as never, 'dockerfile', [supportedEntry])

    expect(fake.semanticRegistrations).toHaveBeenCalledTimes(1)
    expect(fake.linkRegistrations).toHaveBeenCalledTimes(1)
    expect(fake.openerRegistrations).toHaveBeenCalledTimes(1)

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture supplies the Monaco registration methods used by this module.
    ensureCapabilityLspProviders(fake.monaco as never, 'yaml', [supportedEntry])
    expect(fake.semanticRegistrations).toHaveBeenCalledTimes(2)
    expect(fake.semanticRegistrations).toHaveBeenLastCalledWith('yaml', expect.any(Object))
    expect(fake.linkRegistrations).toHaveBeenCalledTimes(2)
    expect(fake.linkRegistrations).toHaveBeenLastCalledWith('yaml', expect.any(Object))
    expect(fake.openerRegistrations).toHaveBeenCalledTimes(1)
  })

  it('disposes every registration when the Monaco instance changes', () => {
    const first = fakeMonaco()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture supplies the Monaco registration methods used by this module.
    ensureCapabilityLspProviders(first.monaco as never, 'dockerfile', [supportedEntry])
    const second = fakeMonaco()

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture supplies the Monaco registration methods used by this module.
    ensureCapabilityLspProviders(second.monaco as never, 'dockerfile', [supportedEntry])

    expect(first.disposables).toHaveLength(3)
    for (const disposable of first.disposables) {
      expect(disposable.dispose).toHaveBeenCalledTimes(1)
    }
    expect(second.semanticRegistrations).toHaveBeenCalledTimes(1)
    expect(second.linkRegistrations).toHaveBeenCalledTimes(1)
    expect(second.openerRegistrations).toHaveBeenCalledTimes(1)
  })
})
