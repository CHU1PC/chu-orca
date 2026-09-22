import * as monaco from 'monaco-editor'
import { languages as coreLanguages } from 'monaco-editor/esm/vs/editor/editor.api.js'
import { buildThemeScopeIndex } from './textmate-scope-resolver'
import { defineOneDarkTheme, convertVsCodeTokenColors } from './textmate-theme'
import { createTextMateTokensProvider } from './textmate-tokens-provider'
import { loadTextMateGrammar, textMateLanguageScopes } from './textmate-language-catalog'
import oneDarkProTheme from './themes/one-dark-pro.json'

let configured = false
const registeredLanguageIds = new Set<string>()
const registrationStartedLanguageIds = new Set<string>()
const ownedProviders = new Map<string, unknown>()
const latestFailures = new Map<string, { languageId: string; message: string }>()
let providerGuardInstalled = false
let internalProviderRegistration = false
const wrappedLanguageTargets: WrappedLanguageTarget[] = []
const scheduledReassertLanguageIds = new Set<string>()
const reassertDelaysMs = [0, 300, 1000, 3000] as const

type ProviderSetter = (this: unknown, ...args: unknown[]) => unknown
type LanguageApi = {
  setTokensProvider: ProviderSetter
  setMonarchTokensProvider: ProviderSetter
}
type WrappedLanguageTarget = {
  languages: LanguageApi
  originalSetTokensProvider: ProviderSetter
  originalSetMonarchTokensProvider: ProviderSetter
}

function isLanguageApi(value: unknown): value is LanguageApi {
  return (
    typeof value === 'object' &&
    value !== null &&
    'setTokensProvider' in value &&
    typeof value.setTokensProvider === 'function' &&
    'setMonarchTokensProvider' in value &&
    typeof value.setMonarchTokensProvider === 'function'
  )
}
export type TextMateDiagnostics = {
  registered: string[]
  active: string[]
  failures: { languageId: string; message: string }[]
  reasserts: Record<string, number>
  wrappedTargets: number
  sameLanguagesObject: boolean
  scheduledReasserts: Record<string, number>
}

const textMateDiagnostics: TextMateDiagnostics = {
  registered: [],
  active: [],
  failures: [],
  reasserts: {},
  wrappedTargets: 0,
  sameLanguagesObject: monaco.languages === coreLanguages,
  scheduledReasserts: {}
}

// 実行中のアプリを再ビルドせず、DevTools から調査できるように公開する。
const globalWithTextMateDiagnostics: typeof globalThis & {
  __orcaTextMate?: TextMateDiagnostics
} = globalThis
try {
  globalWithTextMateDiagnostics.__orcaTextMate = textMateDiagnostics
} catch {
  // 診断情報の公開に失敗してもハイライト設定は続行する。
}

function updateDiagnostics(update: (diagnostics: TextMateDiagnostics) => void): void {
  try {
    update(textMateDiagnostics)
  } catch {
    // DevTools から診断オブジェクトが変更されても設定処理を妨げない。
  }
}

function recordRegistrationStarted(languageId: string): void {
  registrationStartedLanguageIds.add(languageId)
  updateDiagnostics((diagnostics) => {
    diagnostics.registered = [...registrationStartedLanguageIds]
  })
}

function recordProviderActive(): void {
  updateDiagnostics((diagnostics) => {
    diagnostics.active = [...ownedProviders.keys()]
  })
}

function errorMessage(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return 'Unknown error'
  }
}

function recordFailure(languageId: string, error: unknown): void {
  latestFailures.delete(languageId)
  latestFailures.set(languageId, { languageId, message: errorMessage(error) })
  updateDiagnostics((diagnostics) => {
    diagnostics.failures = [...latestFailures.values()]
  })
}

function recordReassert(languageId: string): void {
  updateDiagnostics((diagnostics) => {
    diagnostics.reasserts[languageId] = (diagnostics.reasserts[languageId] ?? 0) + 1
  })
}

function recordScheduledReassert(languageId: string): void {
  updateDiagnostics((diagnostics) => {
    diagnostics.scheduledReasserts[languageId] =
      (diagnostics.scheduledReasserts[languageId] ?? 0) + 1
  })
}

function assertOwnedProviderOnAllTargets(languageId: string): void {
  if (!ownedProviders.has(languageId)) {
    return
  }

  internalProviderRegistration = true
  try {
    for (const target of wrappedLanguageTargets) {
      try {
        target.originalSetTokensProvider.call(
          target.languages,
          languageId,
          ownedProviders.get(languageId)
        )
      } catch (error) {
        recordFailure(languageId, error)
      }
    }
  } finally {
    internalProviderRegistration = false
  }
}

function reassertOwnedProvider(languageId: string): void {
  if (internalProviderRegistration || !ownedProviders.has(languageId)) {
    return
  }

  assertOwnedProviderOnAllTargets(languageId)
  recordReassert(languageId)
}

function runScheduledReassert(languageId: string): void {
  try {
    assertOwnedProviderOnAllTargets(languageId)
    recordScheduledReassert(languageId)
  } catch (error) {
    recordFailure(languageId, error)
  }
}

function scheduleReasserts(languageId: string): void {
  if (scheduledReassertLanguageIds.has(languageId)) {
    return
  }
  scheduledReassertLanguageIds.add(languageId)

  for (const delay of reassertDelaysMs) {
    try {
      setTimeout(() => runScheduledReassert(languageId), delay)
    } catch (error) {
      recordFailure(languageId, error)
    }
  }
}

// Monaco が basic-languages の Monarch を遅延 import して後から登録し直すため、先に登録した TextMate の provider が奪われる。
function installProviderGuard(): void {
  if (providerGuardInstalled) {
    return
  }

  const languageApis: unknown[] = [monaco.languages, coreLanguages]
  for (const languages of languageApis) {
    if (!isLanguageApi(languages)) {
      continue
    }
    if (wrappedLanguageTargets.some((target) => target.languages === languages)) {
      continue
    }

    const originalSetTokensProvider = languages.setTokensProvider
    const originalSetMonarchTokensProvider = languages.setMonarchTokensProvider
    const target: WrappedLanguageTarget = {
      languages,
      originalSetTokensProvider,
      originalSetMonarchTokensProvider
    }
    wrappedLanguageTargets.push(target)

    languages.setTokensProvider = function (this: unknown, ...args: unknown[]): unknown {
      const languageId = args[0]
      const disposable = originalSetTokensProvider.apply(this, args)
      if (!internalProviderRegistration && typeof languageId === 'string') {
        reassertOwnedProvider(languageId)
      }
      return disposable
    }

    languages.setMonarchTokensProvider = function (this: unknown, ...args: unknown[]): unknown {
      const languageId = args[0]
      const disposable = originalSetMonarchTokensProvider.apply(this, args)
      if (!internalProviderRegistration && typeof languageId === 'string') {
        reassertOwnedProvider(languageId)
      }
      return disposable
    }
  }

  providerGuardInstalled = true
  updateDiagnostics((diagnostics) => {
    diagnostics.wrappedTargets = wrappedLanguageTargets.length
    diagnostics.sameLanguagesObject = monaco.languages === coreLanguages
  })
}

function registerTextMateProvider(languageId: string, provider: unknown): unknown {
  internalProviderRegistration = true
  let firstDisposable: unknown
  let registrationError: unknown
  let hasRegistrationError = false
  try {
    for (const [index, target] of wrappedLanguageTargets.entries()) {
      try {
        const disposable = target.originalSetTokensProvider.call(
          target.languages,
          languageId,
          provider
        )
        if (index === 0) {
          firstDisposable = disposable
        }
      } catch (error) {
        if (!hasRegistrationError) {
          hasRegistrationError = true
          registrationError = error
        }
      }
    }
    if (hasRegistrationError) {
      throw registrationError
    }

    ownedProviders.set(languageId, provider)
    recordProviderActive()
    scheduleReasserts(languageId)
    return firstDisposable
  } finally {
    internalProviderRegistration = false
  }
}

async function registerLanguage(
  languageId: string,
  scopeName: string,
  themeScopeIndex: ReturnType<typeof buildThemeScopeIndex>
): Promise<void> {
  const provider = await createTextMateTokensProvider({
    scopeName,
    themeScopeIndex,
    loadGrammar: loadTextMateGrammar
  })
  registerTextMateProvider(languageId, provider)
}

function ensureLanguageProvider(
  languageId: string,
  themeScopeIndex: ReturnType<typeof buildThemeScopeIndex>
): void {
  if (!Object.hasOwn(textMateLanguageScopes, languageId)) {
    return
  }
  if (registeredLanguageIds.has(languageId)) {
    return
  }

  registeredLanguageIds.add(languageId)
  recordRegistrationStarted(languageId)
  const scopeName = textMateLanguageScopes[languageId]
  void registerLanguage(languageId, scopeName, themeScopeIndex).catch((error: unknown) => {
    recordFailure(languageId, error)
    registeredLanguageIds.delete(languageId)
  })
}

export function configureMonacoTextMate(): void {
  if (configured) {
    return
  }
  configured = true
  installProviderGuard()

  try {
    defineOneDarkTheme(monaco)
    const themeScopeIndex = buildThemeScopeIndex(
      convertVsCodeTokenColors(oneDarkProTheme.tokenColors)
    )
    for (const model of monaco.editor.getModels()) {
      ensureLanguageProvider(model.getLanguageId(), themeScopeIndex)
    }
    monaco.editor.onDidCreateModel((model) => {
      ensureLanguageProvider(model.getLanguageId(), themeScopeIndex)
    })
    monaco.editor.onDidChangeModelLanguage(({ model }) => {
      ensureLanguageProvider(model.getLanguageId(), themeScopeIndex)
    })
  } catch {
    // ハイライト設定の失敗でエディターの起動を妨げない。
  }
}
