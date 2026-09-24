import type * as MonacoNamespace from 'monaco-editor'
import type { LspDocumentEntry } from './monaco-lsp-documents'
import {
  registerDocumentLinkOpener,
  registerDocumentLinksProvider
} from './monaco-lsp-document-links'
import { registerSemanticTokensProvider } from './monaco-lsp-semantic-tokens'
import { createMonacoProviderRegistry } from './monaco-provider-registrations'

type MonacoApi = typeof MonacoNamespace

const providerRegistry = createMonacoProviderRegistry<MonacoApi>()
let documentLinkOpenerRegistered = false
const semanticLanguages = new Set<string>()
const documentLinkLanguages = new Set<string>()

export function ensureCapabilityLspProviders(
  monaco: MonacoApi,
  languageId: string,
  entries: readonly Pick<LspDocumentEntry, 'semanticTokensLegend' | 'documentLinks'>[]
): void {
  providerRegistry.resetIfMonacoChanged(monaco, () => {
    semanticLanguages.clear()
    documentLinkLanguages.clear()
    documentLinkOpenerRegistered = false
  })
  if (
    entries.some((entry) => entry.semanticTokensLegend !== undefined) &&
    !semanticLanguages.has(languageId)
  ) {
    providerRegistry.push(registerSemanticTokensProvider(monaco, languageId))
    semanticLanguages.add(languageId)
  }
  if (
    entries.some((entry) => entry.documentLinks !== undefined) &&
    !documentLinkLanguages.has(languageId)
  ) {
    providerRegistry.push(registerDocumentLinksProvider(monaco, languageId))
    documentLinkLanguages.add(languageId)
    if (!documentLinkOpenerRegistered) {
      providerRegistry.push(registerDocumentLinkOpener(monaco))
      documentLinkOpenerRegistered = true
    }
  }
}
