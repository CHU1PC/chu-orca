// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.
import { app, BrowserWindow, type WebContents } from 'electron'
import * as electron from 'electron'
import type { Store } from '../persistence'
import {
  LSP_REQUEST_METHODS,
  type LspChangeDocumentArgs,
  type LspCloseDocumentArgs,
  type LspOpenDocumentArgs,
  type LspOpenDocumentResult,
  type LspRequestArgs
} from '../../shared/lsp-types'
import { createLspSessionManager } from '../lsp/lsp-session-manager'
import { resolveAuthorizedPath } from './filesystem-auth'
import { isDescendantOrEqual } from './filesystem-path-containment'
import { isTrustedUIRenderer } from './ui'

type TrackedDocument = { sessionId: string; fileUri: string }

type SenderDocumentState = {
  documents: TrackedDocument[]
  cleanup: () => void
}

const ipcMain = 'ipcMain' in electron ? electron.ipcMain : null

export function registerLspHandlers(store: Store): void {
  const manager = createLspSessionManager()
  const senderDocuments = new Map<WebContents, SenderDocumentState>()

  const removeSenderDocumentState = (sender: WebContents): void => {
    const state = senderDocuments.get(sender)
    if (!state) {
      return
    }
    sender.removeListener('render-process-gone', state.cleanup)
    sender.removeListener('destroyed', state.cleanup)
    senderDocuments.delete(sender)
  }

  const trackDocuments = (sender: WebContents, documents: readonly TrackedDocument[]): void => {
    if (documents.length === 0) {
      return
    }
    let state = senderDocuments.get(sender)
    if (!state) {
      const cleanup = (): void => {
        const current = senderDocuments.get(sender)
        if (!current) {
          return
        }
        senderDocuments.delete(sender)
        sender.removeListener('render-process-gone', cleanup)
        sender.removeListener('destroyed', cleanup)
        for (const document of current.documents) {
          manager.closeDocument(document.sessionId, document.fileUri)
        }
      }
      state = { documents: [], cleanup }
      senderDocuments.set(sender, state)
      sender.once('render-process-gone', cleanup)
      sender.once('destroyed', cleanup)
    }
    state.documents.push(...documents)
  }

  const untrackDocument = (sender: WebContents, sessionId: string, fileUri: string): void => {
    const state = senderDocuments.get(sender)
    if (!state) {
      return
    }
    const index = state.documents.findIndex(
      (document) => document.sessionId === sessionId && document.fileUri === fileUri
    )
    if (index !== -1) {
      state.documents.splice(index, 1)
    }
    if (state.documents.length === 0) {
      removeSenderDocumentState(sender)
    }
  }

  // Why: diagnostics may contain file contents or paths and belong only to the trusted UI renderer.
  manager.onDiagnostics((payload) => {
    for (const window of BrowserWindow.getAllWindows()) {
      const contents = window.webContents
      if (isTrustedUIRenderer(contents)) {
        contents.send('lsp:diagnostics', payload)
      }
    }
  })
  app.on?.('will-quit', () => manager.disposeAll())

  ipcMain?.handle?.(
    'lsp:openDocument',
    async (event, args: LspOpenDocumentArgs): Promise<LspOpenDocumentResult> => {
      if (event.senderFrame !== event.sender.mainFrame) {
        throw new Error('LSP document open must originate from the current main frame')
      }
      const filePath = await resolveAuthorizedPath(args.filePath, store)
      const rootPath = await resolveAuthorizedPath(args.rootPath, store)
      // Why: both paths are individually authorized, but rootPath becomes the
      // server's cwd/workspace — it must actually contain the opened file, or a
      // renderer could scope a code-executing server (gopls, rust-analyzer) to
      // an unrelated allowed root.
      if (!isDescendantOrEqual(filePath, rootPath)) {
        throw new Error('LSP document must be inside its workspace root')
      }
      const result = await manager.openDocument({
        filePath,
        rootPath,
        languageId: args.languageId,
        text: args.text
      })
      trackDocuments(
        event.sender,
        result.sessions.map(({ sessionId, fileUri }) => ({ sessionId, fileUri }))
      )
      return result
    }
  )

  ipcMain?.handle?.('lsp:changeDocument', (event, args: LspChangeDocumentArgs): void => {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new Error('LSP document change must originate from the current main frame')
    }
    manager.changeDocument(args.sessionId, args.fileUri, args.text)
  })

  ipcMain?.handle?.('lsp:closeDocument', (event, args: LspCloseDocumentArgs): void => {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new Error('LSP document close must originate from the current main frame')
    }
    manager.closeDocument(args.sessionId, args.fileUri)
    untrackDocument(event.sender, args.sessionId, args.fileUri)
  })

  ipcMain?.handle?.('lsp:request', (event, args: LspRequestArgs): Promise<unknown> => {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new Error('LSP request must originate from the current main frame')
    }
    if (!LSP_REQUEST_METHODS.includes(args.method)) {
      return Promise.reject(new Error(`Unsupported LSP method: ${String(args.method)}`))
    }
    return manager.request(args.sessionId, args.method, args.params)
  })
}
