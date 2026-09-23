import { describe, expect, it, vi } from 'vitest'
import { registerDockerfileLanguageFeatures } from './dockerfile-monaco-providers'
import type { languages } from 'monaco-editor'

function fakeMonaco() {
  let foldingProvider: languages.FoldingRangeProvider | undefined
  let definitionProvider: languages.DefinitionProvider | undefined
  const foldingRegistration = { dispose: vi.fn() }
  const definitionRegistration = { dispose: vi.fn() }
  const monaco = {
    languages: {
      registerFoldingRangeProvider: vi.fn(
        (_language: string, provider: languages.FoldingRangeProvider) => {
          foldingProvider = provider
          return foldingRegistration
        }
      ),
      registerDefinitionProvider: vi.fn(
        (_language: string, provider: languages.DefinitionProvider) => {
          definitionProvider = provider
          return definitionRegistration
        }
      )
    }
  }
  return {
    monaco,
    foldingRegistration,
    definitionRegistration,
    getProviders: () => ({ foldingProvider, definitionProvider })
  }
}

function fakeModel(value: string) {
  return {
    uri: { toString: () => 'file:///Dockerfile' },
    getValue: () => value,
    getLineMaxColumn: (lineNumber: number) => value.split('\n')[lineNumber - 1]?.length + 1
  }
}

function register(fixture: ReturnType<typeof fakeMonaco>): void {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fake contains the two Monaco registration methods used by this test.
  registerDockerfileLanguageFeatures(fixture.monaco as never)
}

describe('Dockerfile Monaco providers', () => {
  it('registers folding and definition providers once per Monaco instance', () => {
    const fixture = fakeMonaco()
    register(fixture)
    register(fixture)
    expect(fixture.monaco.languages.registerFoldingRangeProvider).toHaveBeenCalledTimes(1)
    expect(fixture.monaco.languages.registerDefinitionProvider).toHaveBeenCalledTimes(1)
  })

  it('keeps registration idempotent across module re-evaluation', async () => {
    const fixture = fakeMonaco()
    const firstModule = await import('./dockerfile-monaco-providers')
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fake contains the two Monaco registration methods used by this test.
    firstModule.registerDockerfileLanguageFeatures(fixture.monaco as never)
    vi.resetModules()
    const secondModule = await import('./dockerfile-monaco-providers')
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fake contains the two Monaco registration methods used by this test.
    secondModule.registerDockerfileLanguageFeatures(fixture.monaco as never)
    expect(fixture.monaco.languages.registerFoldingRangeProvider).toHaveBeenCalledTimes(1)
    expect(fixture.monaco.languages.registerDefinitionProvider).toHaveBeenCalledTimes(1)
  })

  it('folds each Dockerfile stage', () => {
    const fixture = fakeMonaco()
    register(fixture)
    const { foldingProvider } = fixture.getProviders()
    const ranges = foldingProvider?.provideFoldingRanges(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture implements the model methods read by the folding provider.
      fakeModel('FROM one\nRUN one\nFROM two\nRUN two') as never,
      {},
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The provider does not read the cancellation token in this test.
      undefined as never
    )
    expect(ranges).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 4 }
    ])
  })

  it('returns a definition for a stage reference', () => {
    const fixture = fakeMonaco()
    register(fixture)
    const { definitionProvider } = fixture.getProviders()
    const text = 'FROM node AS build\nCOPY --from=build /a /b'
    const column = text.split('\n')[1].indexOf('build') + 1
    const definition = definitionProvider?.provideDefinition(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture implements the model methods read by the definition provider.
      fakeModel(text) as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture position only needs lineNumber and column for this provider.
      { lineNumber: 2, column } as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The provider does not read the cancellation token in this test.
      undefined as never
    )
    expect(definition).toMatchObject({ range: { startLineNumber: 1 } })
  })
})
