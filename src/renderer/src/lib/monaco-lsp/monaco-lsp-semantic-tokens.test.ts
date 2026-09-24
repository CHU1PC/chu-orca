import type { languages } from 'monaco-editor'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LspSemanticTokensLegend } from '../../../../shared/lsp-types'
import {
  resolveSemanticTokenStyle,
  semanticStyleLegendIndex
} from '../monaco-textmate/semantic-token-style'
import { decodeLspSemanticTokens } from './lsp-semantic-token-decoder'

const dockerLegend: LspSemanticTokensLegend = {
  tokenTypes: [
    'keyword',
    'comment',
    'parameter',
    'property',
    'namespace',
    'class',
    'macro',
    'string',
    'variable',
    'operator'
  ],
  tokenModifiers: ['declaration', 'definition', 'deprecated']
}

const mocks = vi.hoisted(() => {
  const entry: {
    sessionId: string
    fileUri: string
    isPrimary: boolean
    semanticTokensLegend?: LspSemanticTokensLegend
  } = {
    sessionId: 'session-1',
    fileUri: 'file:///workspace/Dockerfile',
    isPrimary: true
  }
  return { entry, request: vi.fn(), flush: vi.fn() }
})

vi.mock('./monaco-lsp-documents', () => ({
  getLspEntriesForModelUri: vi.fn(() => [mocks.entry]),
  flushPendingLspChange: mocks.flush
}))

import { ensureCapabilityLspProviders } from './monaco-lsp-capability-providers'
import { registerSemanticTokensProvider } from './monaco-lsp-semantic-tokens'

describe('decodeLspSemanticTokens', () => {
  it('filters unresolved styles and re-encodes deltas after dropped tokens', () => {
    const legend = { ...dockerLegend, tokenTypes: [...dockerLegend.tokenTypes, 'unknownType'] }
    const result = decodeLspSemanticTokens(
      {
        data: [0, 0, 2, 0, 1, 0, 3, 2, 10, 0, 0, 5, 2, 1, 0, 1, 0, 1, 10, 0, 0, 5, 2, 1, 0]
      },
      legend,
      'dockerfile'
    )
    const keywordStyle = resolveSemanticTokenStyle('keyword', ['declaration'], 'dockerfile')
    const commentStyle = resolveSemanticTokenStyle('comment', [], 'dockerfile')

    expect(result?.data).toEqual(
      Uint32Array.from([
        0,
        0,
        2,
        semanticStyleLegendIndex(keywordStyle ?? {}),
        0,
        0,
        8,
        2,
        semanticStyleLegendIndex(commentStyle ?? {}),
        0,
        1,
        5,
        2,
        semanticStyleLegendIndex(commentStyle ?? {}),
        0
      ])
    )
  })

  it('drops an out-of-range token and re-encodes neighbours on the same line', () => {
    const keywordStyle = resolveSemanticTokenStyle('keyword', [], 'dockerfile')
    const commentStyle = resolveSemanticTokenStyle('comment', [], 'dockerfile')
    const result = decodeLspSemanticTokens(
      { data: [0, 2, 2, 0, 0, 0, 4, 1, 10, 0, 0, 3, 3, 1, 0] },
      dockerLegend,
      'dockerfile'
    )

    expect(result?.data).toEqual(
      Uint32Array.from([
        0,
        2,
        2,
        semanticStyleLegendIndex(keywordStyle ?? {}),
        0,
        0,
        7,
        3,
        semanticStyleLegendIndex(commentStyle ?? {}),
        0
      ])
    )
  })

  it('drops an out-of-range token on another line and re-encodes from kept tokens', () => {
    const keywordStyle = resolveSemanticTokenStyle('keyword', [], 'dockerfile')
    const commentStyle = resolveSemanticTokenStyle('comment', [], 'dockerfile')
    const result = decodeLspSemanticTokens(
      { data: [0, 2, 2, 0, 0, 1, 4, 1, 10, 0, 1, 3, 3, 1, 0] },
      dockerLegend,
      'dockerfile'
    )

    expect(result?.data).toEqual(
      Uint32Array.from([
        0,
        2,
        2,
        semanticStyleLegendIndex(keywordStyle ?? {}),
        0,
        2,
        3,
        3,
        semanticStyleLegendIndex(commentStyle ?? {}),
        0
      ])
    )
  })

  it('drops tokens with modifier bits beyond the legend mask', () => {
    const keywordStyle = resolveSemanticTokenStyle('keyword', [], 'dockerfile')
    const commentStyle = resolveSemanticTokenStyle('comment', [], 'dockerfile')
    const result = decodeLspSemanticTokens(
      { data: [0, 1, 2, 0, 0, 0, 4, 1, 0, 8, 0, 2, 3, 1, 0] },
      dockerLegend,
      'dockerfile'
    )

    expect(result?.data).toEqual(
      Uint32Array.from([
        0,
        1,
        2,
        semanticStyleLegendIndex(keywordStyle ?? {}),
        0,
        0,
        6,
        3,
        semanticStyleLegendIndex(commentStyle ?? {}),
        0
      ])
    )
  })

  it('drops zero-length tokens and keeps decoding later tokens', () => {
    const keywordStyle = resolveSemanticTokenStyle('keyword', [], 'dockerfile')
    const commentStyle = resolveSemanticTokenStyle('comment', [], 'dockerfile')
    const result = decodeLspSemanticTokens(
      { data: [0, 1, 2, 0, 0, 0, 3, 0, 1, 0, 0, 4, 1, 1, 0] },
      dockerLegend,
      'dockerfile'
    )

    expect(result?.data).toEqual(
      Uint32Array.from([
        0,
        1,
        2,
        semanticStyleLegendIndex(keywordStyle ?? {}),
        0,
        0,
        7,
        1,
        semanticStyleLegendIndex(commentStyle ?? {}),
        0
      ])
    )
  })

  it('returns null only when the data structure is invalid', () => {
    expect(decodeLspSemanticTokens({ data: [0, 0, 1] }, dockerLegend, 'dockerfile')).toBeNull()
    expect(
      decodeLspSemanticTokens({ data: [0, 0, 1, 0, 0.5] }, dockerLegend, 'dockerfile')
    ).toBeNull()
    expect(
      decodeLspSemanticTokens({ data: [0, -1, 1, 0, 0] }, dockerLegend, 'dockerfile')
    ).toBeNull()
  })
})

type SemanticProvider = languages.DocumentSemanticTokensProvider

function fakeMonaco(): {
  monaco: unknown
  provider: SemanticProvider | undefined
  register: ReturnType<typeof vi.fn>
} {
  let provider: SemanticProvider | undefined
  const disposable = { dispose: vi.fn() }
  const register = vi.fn((_language: string, value: SemanticProvider) => {
    provider = value
    return disposable
  })
  return {
    monaco: { languages: { registerDocumentSemanticTokensProvider: register } },
    get provider() {
      return provider
    },
    register
  }
}

function installWindowApi(): void {
  if (typeof window === 'undefined') {
    Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true })
  }
  Object.assign(window, { api: { lsp: { request: mocks.request } } })
}

describe('semantic token provider registration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.entry.semanticTokensLegend = undefined
    mocks.flush.mockResolvedValue(undefined)
    mocks.request.mockResolvedValue({ data: [0, 0, 2, 0, 0] })
    installWindowApi()
  })

  it('registers only after an opened entry advertises semantic tokens', () => {
    const unsupported = fakeMonaco()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture supplies the language registration API used by this provider helper.
    ensureCapabilityLspProviders(unsupported.monaco as never, 'dockerfile', [mocks.entry])
    expect(unsupported.register).not.toHaveBeenCalled()

    const supported = fakeMonaco()
    mocks.entry.semanticTokensLegend = dockerLegend
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture supplies the language registration API used by this provider helper.
    ensureCapabilityLspProviders(supported.monaco as never, 'dockerfile', [mocks.entry])
    expect(supported.register).toHaveBeenCalledTimes(1)
  })

  it('requests full tokens and returns null when the server request fails', async () => {
    const fake = fakeMonaco()
    mocks.entry.semanticTokensLegend = dockerLegend
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture supplies the language registration API used by this provider helper.
    registerSemanticTokensProvider(fake.monaco as never, 'dockerfile')
    const model = {
      uri: { toString: () => 'file:///workspace/Dockerfile' },
      getLanguageId: () => 'dockerfile'
    }
    mocks.request.mockRejectedValue(new Error('server stopped'))

    await expect(
      fake.provider?.provideDocumentSemanticTokens(
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture model provides the URI and language methods used by this provider.
        model as never,
        null,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture token only supplies the cancellation flag read by Monaco's provider contract.
        { isCancellationRequested: false } as never
      )
    ).resolves.toBeNull()
    expect(mocks.request).toHaveBeenCalledWith({
      sessionId: 'session-1',
      method: 'textDocument/semanticTokens/full',
      params: { textDocument: { uri: 'file:///workspace/Dockerfile' } }
    })
  })
})
