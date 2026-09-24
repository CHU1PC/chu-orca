import type { languages } from 'monaco-editor'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  entry: {
    sessionId: 'session-1',
    fileUri: 'file:///workspace/Dockerfile',
    isPrimary: true,
    documentLinks: { resolveProvider: true }
  },
  request: vi.fn(),
  flush: vi.fn(),
  openUrl: vi.fn()
}))

vi.mock('./monaco-lsp-documents', () => ({
  getLspEntriesForModelUri: vi.fn(() => [mocks.entry]),
  flushPendingLspChange: mocks.flush
}))

import {
  registerDocumentLinkOpener,
  registerDocumentLinksProvider
} from './monaco-lsp-document-links'

function fakeMonaco(): {
  monaco: unknown
  provider: languages.LinkProvider | undefined
  opener: { open: (resource: { toString: () => string }) => Promise<boolean> } | undefined
} {
  let provider: languages.LinkProvider | undefined
  let opener: { open: (resource: { toString: () => string }) => Promise<boolean> } | undefined
  return {
    monaco: {
      editor: {
        registerLinkOpener: vi.fn((value: typeof opener) => {
          opener = value
          return { dispose: vi.fn() }
        })
      },
      languages: {
        registerLinkProvider: vi.fn((_language: string, value: languages.LinkProvider) => {
          provider = value
          return { dispose: vi.fn() }
        })
      }
    },
    get provider() {
      return provider
    },
    get opener() {
      return opener
    }
  }
}

function installWindowApi(): void {
  if (typeof window === 'undefined') {
    Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true })
  }
  Object.assign(window, {
    api: { lsp: { request: mocks.request }, shell: { openUrl: mocks.openUrl } }
  })
}

describe('document link provider', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.flush.mockResolvedValue(undefined)
    mocks.request.mockResolvedValue([])
    installWindowApi()
  })

  it('converts link ranges and resolves with the original LSP link', async () => {
    const fake = fakeMonaco()
    const rawLink = {
      range: { start: { line: 2, character: 4 }, end: { line: 2, character: 12 } },
      data: { reference: 'manual' }
    }
    mocks.request.mockResolvedValueOnce([rawLink]).mockResolvedValueOnce({
      ...rawLink,
      target: 'https://docs.example.test/reference'
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture supplies the Monaco registration methods used by this provider.
    registerDocumentLinksProvider(fake.monaco as never, 'dockerfile')

    const provided = await fake.provider?.provideLinks(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture model supplies the URI read by the provider.
      { uri: { toString: () => 'file:///workspace/Dockerfile' } } as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture token supplies the cancellation flag read by Monaco's provider contract.
      { isCancellationRequested: false } as never
    )
    const link = provided?.links[0]
    expect(link).toMatchObject({
      range: {
        startLineNumber: 3,
        startColumn: 5,
        endLineNumber: 3,
        endColumn: 13
      }
    })
    expect(link).toHaveProperty('rawLspLink', rawLink)
    expect(link?.url).toBeUndefined()

    if (!link) {
      throw new Error('Expected a document link')
    }
    const resolved = await fake.provider?.resolveLink?.(
      link,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture token supplies the cancellation flag read by Monaco's provider contract.
      { isCancellationRequested: false } as never
    )
    expect(resolved?.url?.toString()).toBe('https://docs.example.test/reference')
    expect(mocks.request).toHaveBeenLastCalledWith({
      sessionId: 'session-1',
      method: 'documentLink/resolve',
      params: rawLink
    })
  })

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'command:foo'])(
    'does not expose resolved target %s',
    async (target) => {
      const fake = fakeMonaco()
      const rawLink = {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
        data: { id: target }
      }
      mocks.request.mockResolvedValueOnce([rawLink]).mockResolvedValueOnce({ ...rawLink, target })
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture supplies the Monaco registration methods used by this provider.
      registerDocumentLinksProvider(fake.monaco as never, 'dockerfile')
      const provided = await fake.provider?.provideLinks(
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture model supplies the URI read by the provider.
        { uri: { toString: () => 'file:///workspace/Dockerfile' } } as never,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture token supplies the cancellation flag read by Monaco's provider contract.
        { isCancellationRequested: false } as never
      )
      const link = provided?.links[0]
      if (!link) {
        throw new Error('Expected a document link')
      }
      const resolved = await fake.provider?.resolveLink?.(
        link,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture token supplies the cancellation flag read by Monaco's provider contract.
        { isCancellationRequested: false } as never
      )
      expect(resolved?.url).toBeUndefined()
    }
  )

  it('routes only HTTP and HTTPS opens through the shell bridge', async () => {
    const fake = fakeMonaco()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture supplies the Monaco link-opener API.
    registerDocumentLinkOpener(fake.monaco as never)
    await expect(fake.opener?.open({ toString: () => 'file:///etc/passwd' })).resolves.toBe(false)
    await expect(fake.opener?.open({ toString: () => 'javascript:alert(1)' })).resolves.toBe(false)
    await expect(fake.opener?.open({ toString: () => 'command:foo' })).resolves.toBe(false)
    await expect(fake.opener?.open({ toString: () => 'https://docs.example.test' })).resolves.toBe(
      true
    )
    expect(mocks.openUrl).toHaveBeenCalledWith('https://docs.example.test/')
    expect(mocks.openUrl).toHaveBeenCalledTimes(1)
  })

  it('falls back when the shell bridge rejects an HTTP open', async () => {
    const fake = fakeMonaco()
    mocks.openUrl.mockRejectedValueOnce(new Error('shell unavailable'))
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture supplies the Monaco link-opener API.
    registerDocumentLinkOpener(fake.monaco as never)

    await expect(fake.opener?.open({ toString: () => 'https://docs.example.test' })).resolves.toBe(
      false
    )
    expect(mocks.openUrl).toHaveBeenCalledWith('https://docs.example.test/')
  })

  it('falls back when the shell bridge is unavailable', async () => {
    const fake = fakeMonaco()
    Object.defineProperty(window.api, 'shell', { value: undefined, configurable: true })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture supplies the Monaco link-opener API.
    registerDocumentLinkOpener(fake.monaco as never)

    await expect(fake.opener?.open({ toString: () => 'https://docs.example.test' })).resolves.toBe(
      false
    )
    expect(mocks.openUrl).not.toHaveBeenCalled()
  })
})
