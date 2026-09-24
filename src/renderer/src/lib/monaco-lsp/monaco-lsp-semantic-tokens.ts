import type * as MonacoNamespace from 'monaco-editor'
import type { IDisposable, editor, languages } from 'monaco-editor'
import { SEMANTIC_STYLE_LEGEND } from '../monaco-textmate/semantic-token-style'
import { decodeLspSemanticTokens } from './lsp-semantic-token-decoder'
import { flushPendingLspChange, getLspEntriesForModelUri } from './monaco-lsp-documents'

type MonacoApi = typeof MonacoNamespace

function findSemanticTokenEntry(model: editor.ITextModel) {
  const entries = getLspEntriesForModelUri(model.uri.toString()).filter(
    (entry) => entry.semanticTokensLegend !== undefined
  )
  return entries.find((entry) => entry.isPrimary) ?? entries[0] ?? null
}

export function registerSemanticTokensProvider(monaco: MonacoApi, languageId: string): IDisposable {
  const provider: languages.DocumentSemanticTokensProvider = {
    getLegend: () => ({ tokenTypes: [...SEMANTIC_STYLE_LEGEND], tokenModifiers: [] }),
    provideDocumentSemanticTokens: async (model) => {
      const entry = findSemanticTokenEntry(model)
      if (!entry?.semanticTokensLegend) {
        return null
      }
      try {
        await flushPendingLspChange(entry)
        const result = await window.api.lsp.request({
          sessionId: entry.sessionId,
          method: 'textDocument/semanticTokens/full',
          params: { textDocument: { uri: entry.fileUri } }
        })
        return decodeLspSemanticTokens(result, entry.semanticTokensLegend, model.getLanguageId())
      } catch {
        return null
      }
    },
    releaseDocumentSemanticTokens: () => {}
  }
  return monaco.languages.registerDocumentSemanticTokensProvider(languageId, provider)
}
