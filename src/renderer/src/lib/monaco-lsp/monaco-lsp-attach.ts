// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.
import type { editor } from 'monaco-editor'
import { monaco } from '@/lib/monaco-setup'
import {
  closeLspDocumentForModel,
  getLspEntriesForModelUri,
  openLspDocumentForModel
} from './monaco-lsp-documents'
import {
  clearLspMarkers,
  ensureInlineDiagnosticsForModel,
  ensureLspSupportForLanguage
} from './monaco-lsp-providers'

/** Open `model` as an LSP document and lazily register the language's
 *  providers; returns the detach cleanup. Shared by the file editor and the
 *  diff viewer's modified pane. */
export function attachMonacoLspDocument(params: {
  model: editor.ITextModel
  editor: editor.ICodeEditor
  filePath: string
  rootPath: string
  worktreeId: string
  languageId: string
}): () => void {
  const modelUri = params.model.uri.toString()
  const clear = (staleModel: editor.ITextModel, serverId: string): void =>
    clearLspMarkers(monaco, staleModel, serverId)
  let closed = false
  let opened = false
  let detachInlineDiagnostics = (): void => {}
  void openLspDocumentForModel({
    model: params.model,
    filePath: params.filePath,
    rootPath: params.rootPath,
    worktreeId: params.worktreeId,
    languageId: params.languageId
  }).then((entry) => {
    if (!entry) {
      return
    }
    if (closed) {
      // Why: the surface unmounted while the open round-trip was in flight.
      closeLspDocumentForModel(modelUri, clear)
      return
    }
    opened = true
    ensureLspSupportForLanguage(monaco, params.languageId, getLspEntriesForModelUri(modelUri))
    detachInlineDiagnostics = ensureInlineDiagnosticsForModel(monaco, params.editor, params.model)
  })
  return () => {
    closed = true
    detachInlineDiagnostics()
    if (opened) {
      closeLspDocumentForModel(modelUri, clear)
    }
  }
}
