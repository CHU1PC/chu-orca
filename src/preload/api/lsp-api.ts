// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.
import { ipcRenderer } from 'electron'
import type {
  LspChangeDocumentArgs,
  LspCloseDocumentArgs,
  LspDiagnosticsPayload,
  LspOpenDocumentArgs,
  LspOpenDocumentResult,
  LspRequestArgs
} from '../../shared/lsp-types'

export type LspApi = {
  openDocument: (args: LspOpenDocumentArgs) => Promise<LspOpenDocumentResult>
  changeDocument: (args: LspChangeDocumentArgs) => Promise<void>
  closeDocument: (args: LspCloseDocumentArgs) => Promise<void>
  request: (args: LspRequestArgs) => Promise<unknown>
  onDiagnostics: (callback: (payload: LspDiagnosticsPayload) => void) => () => void
}

export const lspApi: LspApi = {
  openDocument: (args): Promise<LspOpenDocumentResult> =>
    ipcRenderer.invoke('lsp:openDocument', args),
  changeDocument: (args): Promise<void> => ipcRenderer.invoke('lsp:changeDocument', args),
  closeDocument: (args): Promise<void> => ipcRenderer.invoke('lsp:closeDocument', args),
  request: (args): Promise<unknown> => ipcRenderer.invoke('lsp:request', args),
  onDiagnostics: (callback): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: LspDiagnosticsPayload): void =>
      callback(payload)
    ipcRenderer.on('lsp:diagnostics', listener)
    return () => ipcRenderer.removeListener('lsp:diagnostics', listener)
  }
}
