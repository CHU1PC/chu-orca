import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TextMateDiagnostics } from './monaco-textmate-setup'
import type * as MonacoTextMateSetup from './monaco-textmate-setup'

declare global {
  var __orcaTextMate: TextMateDiagnostics
}

type FakeModel = { getLanguageId: () => string }
type ModelLanguageChangedCallback = (event: { model: FakeModel; oldLanguage: string }) => void

const {
  changeLanguageCallbacks,
  createLanguageApi,
  createModelCallbacks,
  currentCoreLanguages,
  existingModels,
  loadGrammarMock,
  monaco,
  rejectPythonGrammar
} = vi.hoisted(() => {
  const makeLanguageApi = () => ({
    setTokensProvider: vi.fn((_languageId: string, _provider: unknown) => ({
      dispose: vi.fn()
    })),
    setMonarchTokensProvider: vi.fn((_languageId: string, _provider: unknown) => ({
      dispose: vi.fn()
    }))
  })
  const initialMonacoLanguages = makeLanguageApi()
  const initialCoreLanguages = makeLanguageApi()
  const currentCoreLanguages = { value: initialCoreLanguages }
  const existingModels: FakeModel[] = []
  const createModelCallbacks: ((model: FakeModel) => void)[] = []
  const changeLanguageCallbacks: ModelLanguageChangedCallback[] = []
  const rejectPythonGrammar = { value: false }
  const loadGrammarMock = vi.fn(async (scopeName: string) => {
    if (rejectPythonGrammar.value && scopeName === 'source.python') {
      throw new Error('grammar failed')
    }
    return { scopeName }
  })
  const monaco = {
    editor: {
      getModels: vi.fn(() => existingModels),
      onDidCreateModel: vi.fn((callback: (model: FakeModel) => void) => {
        createModelCallbacks.push(callback)
        return { dispose: vi.fn() }
      }),
      onDidChangeModelLanguage: vi.fn((callback: ModelLanguageChangedCallback) => {
        changeLanguageCallbacks.push(callback)
        return { dispose: vi.fn() }
      })
    },
    languages: initialMonacoLanguages
  }

  return {
    changeLanguageCallbacks,
    createLanguageApi: makeLanguageApi,
    createModelCallbacks,
    currentCoreLanguages,
    existingModels,
    loadGrammarMock,
    monaco,
    rejectPythonGrammar
  }
})

vi.mock('monaco-editor', () => monaco)
vi.mock('monaco-editor/esm/vs/editor/editor.api.js', () => ({
  get languages() {
    return currentCoreLanguages.value
  }
}))
vi.mock('./textmate-language-catalog', () => ({
  loadTextMateGrammar: loadGrammarMock,
  textMateLanguageScopes: {
    typescript: 'source.ts',
    javascript: 'source.js',
    python: 'source.python'
  }
}))
vi.mock('./textmate-scope-resolver', () => ({
  buildThemeScopeIndex: vi.fn(() => ({}))
}))
vi.mock('./textmate-theme', () => ({
  convertVsCodeTokenColors: vi.fn(() => []),
  defineOneDarkTheme: vi.fn()
}))
vi.mock('./textmate-tokens-provider', () => ({
  createTextMateTokensProvider: vi.fn(
    async (options: {
      scopeName: string
      loadGrammar: (scopeName: string) => Promise<unknown>
    }) => {
      await options.loadGrammar(options.scopeName)
      return { getInitialState: vi.fn(), tokenize: vi.fn() }
    }
  )
}))

function model(languageId: string): FakeModel {
  return { getLanguageId: () => languageId }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

async function importSetup(): Promise<typeof MonacoTextMateSetup> {
  vi.resetModules()
  return import('./monaco-textmate-setup')
}

function diagnostics(): {
  registered: string[]
  active: string[]
  failures: { languageId: string; message: string }[]
  reasserts: Record<string, number>
  wrappedTargets: number
  sameLanguagesObject: boolean
  scheduledReasserts: Record<string, number>
} {
  return globalThis.__orcaTextMate
}

beforeEach(() => {
  vi.useRealTimers()
  const monacoLanguages = createLanguageApi()
  monaco.languages = monacoLanguages
  currentCoreLanguages.value = createLanguageApi()
  existingModels.length = 0
  createModelCallbacks.length = 0
  changeLanguageCallbacks.length = 0
  rejectPythonGrammar.value = false
  vi.clearAllMocks()
})

describe('configureMonacoTextMate', () => {
  it('registers through both distinct language APIs and reasserts foreign calls on either one', async () => {
    vi.useFakeTimers()
    const monacoLanguages = monaco.languages
    const coreLanguageApi = currentCoreLanguages.value
    const originalMonacoSetTokensProvider = monacoLanguages.setTokensProvider
    const originalCoreSetTokensProvider = coreLanguageApi.setTokensProvider
    existingModels.push(model('typescript'))

    const { configureMonacoTextMate } = await importSetup()
    configureMonacoTextMate()
    await flushPromises()

    expect(originalMonacoSetTokensProvider).toHaveBeenCalledTimes(1)
    expect(originalCoreSetTokensProvider).toHaveBeenCalledTimes(1)
    const ownProvider = originalMonacoSetTokensProvider.mock.calls[0][1]
    expect(ownProvider).toBe(originalCoreSetTokensProvider.mock.calls[0][1])
    expect(diagnostics()).toMatchObject({
      active: ['typescript'],
      failures: [],
      reasserts: {},
      scheduledReasserts: {},
      wrappedTargets: 2,
      sameLanguagesObject: false
    })

    monacoLanguages.setTokensProvider('typescript', { kind: 'foreign-tokens' })
    expect(originalMonacoSetTokensProvider).toHaveBeenCalledTimes(3)
    expect(originalCoreSetTokensProvider).toHaveBeenCalledTimes(2)
    expect(originalMonacoSetTokensProvider.mock.calls.at(-1)?.[1]).toBe(ownProvider)
    expect(originalCoreSetTokensProvider.mock.calls.at(-1)?.[1]).toBe(ownProvider)

    coreLanguageApi.setMonarchTokensProvider('typescript', { kind: 'foreign-monarch' })
    expect(originalMonacoSetTokensProvider).toHaveBeenCalledTimes(4)
    expect(originalCoreSetTokensProvider).toHaveBeenCalledTimes(3)
    expect(diagnostics().reasserts).toEqual({ typescript: 2 })
  })

  it('runs exactly four scheduled reasserts at 0, 300, 1000, and 3000 ms', async () => {
    vi.useFakeTimers()
    const monacoLanguages = monaco.languages
    const coreLanguageApi = currentCoreLanguages.value
    const originalMonacoSetTokensProvider = monacoLanguages.setTokensProvider
    const originalCoreSetTokensProvider = coreLanguageApi.setTokensProvider
    existingModels.push(model('typescript'))

    const { configureMonacoTextMate } = await importSetup()
    configureMonacoTextMate()
    configureMonacoTextMate()
    await flushPromises()
    expect(originalMonacoSetTokensProvider).toHaveBeenCalledTimes(1)
    expect(originalCoreSetTokensProvider).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(0)
    expect(diagnostics().scheduledReasserts).toEqual({ typescript: 1 })
    expect(originalMonacoSetTokensProvider).toHaveBeenCalledTimes(2)
    expect(originalCoreSetTokensProvider).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(299)
    expect(diagnostics().scheduledReasserts).toEqual({ typescript: 1 })
    await vi.advanceTimersByTimeAsync(1)
    expect(diagnostics().scheduledReasserts).toEqual({ typescript: 2 })
    await vi.advanceTimersByTimeAsync(700)
    expect(diagnostics().scheduledReasserts).toEqual({ typescript: 3 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(diagnostics().scheduledReasserts).toEqual({ typescript: 4 })
    await vi.advanceTimersByTimeAsync(10000)
    expect(diagnostics().scheduledReasserts).toEqual({ typescript: 4 })
    expect(originalMonacoSetTokensProvider).toHaveBeenCalledTimes(5)
    expect(originalCoreSetTokensProvider).toHaveBeenCalledTimes(5)
    expect(diagnostics().reasserts).toEqual({})
  })

  it('wraps a shared language API only once', async () => {
    vi.useFakeTimers()
    const sharedLanguages = createLanguageApi()
    monaco.languages = sharedLanguages
    currentCoreLanguages.value = sharedLanguages
    const originalSetTokensProvider = sharedLanguages.setTokensProvider
    existingModels.push(model('typescript'))

    const { configureMonacoTextMate } = await importSetup()
    configureMonacoTextMate()
    await flushPromises()

    expect(originalSetTokensProvider).toHaveBeenCalledTimes(1)
    expect(diagnostics()).toMatchObject({ wrappedTargets: 1, sameLanguagesObject: true })

    sharedLanguages.setTokensProvider('typescript', { kind: 'foreign' })
    expect(originalSetTokensProvider).toHaveBeenCalledTimes(3)
    expect(diagnostics().reasserts).toEqual({ typescript: 1 })
  })

  it('keeps model-driven registration for existing, created, and relabeled models', async () => {
    vi.useFakeTimers()
    const monacoLanguages = monaco.languages
    const coreLanguageApi = currentCoreLanguages.value
    const originalMonacoSetTokensProvider = monacoLanguages.setTokensProvider
    const originalCoreSetTokensProvider = coreLanguageApi.setTokensProvider
    existingModels.push(model('typescript'))

    const { configureMonacoTextMate } = await importSetup()
    configureMonacoTextMate()
    await flushPromises()
    createModelCallbacks[0](model('javascript'))
    changeLanguageCallbacks[0]({ model: model('python'), oldLanguage: 'typescript' })
    await flushPromises()

    expect(originalMonacoSetTokensProvider.mock.calls.map(([languageId]) => languageId)).toEqual([
      'typescript',
      'javascript',
      'python'
    ])
    expect(originalCoreSetTokensProvider.mock.calls.map(([languageId]) => languageId)).toEqual([
      'typescript',
      'javascript',
      'python'
    ])
    createModelCallbacks[0](model('unknown'))
    changeLanguageCallbacks[0]({ model: model('unknown'), oldLanguage: 'typescript' })
    await flushPromises()
    expect(originalMonacoSetTokensProvider.mock.calls).toHaveLength(3)
    expect(originalCoreSetTokensProvider.mock.calls).toHaveLength(3)
  })

  it('records rejected grammar loads without activating or scheduling the language', async () => {
    vi.useFakeTimers()
    const monacoLanguages = monaco.languages
    const coreLanguageApi = currentCoreLanguages.value
    const originalMonacoSetTokensProvider = monacoLanguages.setTokensProvider
    const originalCoreSetTokensProvider = coreLanguageApi.setTokensProvider
    rejectPythonGrammar.value = true
    existingModels.push(model('python'))

    const { configureMonacoTextMate } = await importSetup()
    configureMonacoTextMate()
    await flushPromises()

    expect(originalMonacoSetTokensProvider).not.toHaveBeenCalled()
    expect(originalCoreSetTokensProvider).not.toHaveBeenCalled()
    expect(diagnostics()).toMatchObject({
      registered: ['python'],
      active: [],
      scheduledReasserts: {},
      wrappedTargets: 2,
      sameLanguagesObject: false
    })
    expect(diagnostics().failures).toEqual([{ languageId: 'python', message: 'grammar failed' }])
  })
})
