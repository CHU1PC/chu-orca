// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.
import type { IDisposable, editor } from 'monaco-editor'
import { monaco } from '@/lib/monaco-setup'
import {
  lspMarkerOwner,
  lspDiagnosticsToMonacoMarkers,
  lspPullDiagnosticsToItems
} from './lsp-monaco-conversion'
import { setLspFileStatus } from './monaco-lsp-status'

// Why: batch keystrokes into one didChange without letting providers observe stale text.
const CHANGE_DEBOUNCE_MS = 250

export type LspDocumentEntry = {
  sessionId: string
  fileUri: string
  filePath: string
  rootPath: string
  worktreeId: string
  serverId: string
  resolvedCommand: string
  source: 'project' | 'PATH'
  isPrimary: boolean
  pullDiagnostics: boolean
  model: editor.ITextModel
  refCount: number
  changeTimer: ReturnType<typeof setTimeout> | null
  lastSync: Promise<void>
  contentListener: IDisposable
}

const entriesByModelUri = new Map<string, LspDocumentEntry[]>()
const entriesBySessionDocument = new Map<string, Set<LspDocumentEntry>>()

function sessionDocumentKey(sessionId: string, fileUri: string): string {
  return `${sessionId} ${fileUri}`
}

function registerSessionDocumentEntry(entry: LspDocumentEntry): void {
  const key = sessionDocumentKey(entry.sessionId, entry.fileUri)
  const entries = entriesBySessionDocument.get(key) ?? new Set()
  entries.add(entry)
  entriesBySessionDocument.set(key, entries)
}

function unregisterSessionDocumentEntry(entry: LspDocumentEntry): void {
  const key = sessionDocumentKey(entry.sessionId, entry.fileUri)
  const entries = entriesBySessionDocument.get(key)
  entries?.delete(entry)
  if (entries?.size === 0) {
    entriesBySessionDocument.delete(key)
  }
}

async function pullDiagnosticsNow(entry: LspDocumentEntry): Promise<void> {
  if (!entry.pullDiagnostics) {
    return
  }
  try {
    const result = await window.api.lsp.request({
      sessionId: entry.sessionId,
      method: 'textDocument/diagnostic',
      params: { textDocument: { uri: entry.fileUri } }
    })
    const items = lspPullDiagnosticsToItems(result)
    if (
      items &&
      !entry.model.isDisposed() &&
      entriesByModelUri.get(entry.model.uri.toString())?.includes(entry)
    ) {
      monaco.editor.setModelMarkers(
        entry.model,
        lspMarkerOwner(entry.serverId),
        lspDiagnosticsToMonacoMarkers(items, monaco.MarkerSeverity, entry.serverId)
      )
    }
  } catch {
    // A dead or slow server must never break editing; markers just go stale.
  }
}

function sendChangeNow(entry: LspDocumentEntry): void {
  if (entry.changeTimer !== null) {
    clearTimeout(entry.changeTimer)
    entry.changeTimer = null
  }
  if (entry.model.isDisposed()) {
    return
  }
  const text = entry.model.getValue()
  entry.lastSync = entry.lastSync
    .then(() =>
      window.api.lsp.changeDocument({ sessionId: entry.sessionId, fileUri: entry.fileUri, text })
    )
    .then(() => pullDiagnosticsNow(entry))
    .catch(() => {})
}

export async function openLspDocumentForModel(params: {
  model: editor.ITextModel
  filePath: string
  rootPath: string
  worktreeId: string
  languageId: string
}): Promise<LspDocumentEntry | null> {
  const { model, filePath, rootPath, worktreeId, languageId } = params
  const modelUri = model.uri.toString()
  const existing = entriesByModelUri.get(modelUri)
  if (existing) {
    for (const entry of existing) {
      entry.refCount++
    }
    return existing.find((entry) => entry.isPrimary) ?? existing[0] ?? null
  }
  setLspFileStatus(filePath, { state: 'starting', servers: [] })
  const openedText = model.getValue()
  let opened: { sessions?: {
    sessionId: string
    fileUri: string
    serverId: string
    resolvedCommand: string
    source: 'project' | 'PATH'
    isPrimary: boolean
    pullDiagnostics: boolean
  }[]; fileUri?: string | null; projectToolsSkippedReason?: string }
  try {
    opened = await window.api.lsp.openDocument({ filePath, rootPath, languageId, text: openedText })
  } catch {
    setLspFileStatus(filePath, null)
    return null
  }
  const sessionInfos = opened?.sessions ?? []
  if (sessionInfos.length === 0) {
    if (opened.projectToolsSkippedReason) {
      setLspFileStatus(filePath, {
        state: 'running',
        servers: [],
        projectToolsSkippedReason: opened.projectToolsSkippedReason
      })
    } else {
      setLspFileStatus(filePath, null)
    }
    return null
  }
  const raced = entriesByModelUri.get(modelUri)
  if (raced) {
    for (const session of sessionInfos) {
      void window.api.lsp
        .closeDocument({ sessionId: session.sessionId, fileUri: session.fileUri })
        .catch(() => {})
    }
    for (const entry of raced) {
      entry.refCount++
    }
    return raced.find((entry) => entry.isPrimary) ?? raced[0] ?? null
  }
  const entries: LspDocumentEntry[] = []
  for (const session of sessionInfos) {
    const entry: LspDocumentEntry = {
      sessionId: session.sessionId,
      fileUri: session.fileUri,
      filePath,
      rootPath,
      worktreeId,
      serverId: session.serverId,
      resolvedCommand: session.resolvedCommand,
      source: session.source,
      isPrimary: session.isPrimary,
      pullDiagnostics: session.pullDiagnostics,
      model,
      refCount: 1,
      changeTimer: null,
      lastSync: Promise.resolve(),
      contentListener: undefined as unknown as IDisposable
    }
    entry.contentListener = model.onDidChangeContent(() => {
      if (entry.changeTimer !== null) {
        clearTimeout(entry.changeTimer)
      }
      entry.changeTimer = setTimeout(() => sendChangeNow(entry), CHANGE_DEBOUNCE_MS)
    })
    entries.push(entry)
  }
  entriesByModelUri.set(modelUri, entries)
  for (const entry of entries) {
    registerSessionDocumentEntry(entry)
  }
  setLspFileStatus(filePath, {
    state: 'running',
    servers: entries.map(({ serverId, resolvedCommand, source }) => ({
      serverId,
      resolvedCommand,
      source
    })),
    ...(opened.projectToolsSkippedReason
      ? { projectToolsSkippedReason: opened.projectToolsSkippedReason }
      : {})
  })
  if (!model.isDisposed() && model.getValue() !== openedText) {
    for (const entry of entries) {
      sendChangeNow(entry)
    }
  }
  for (const entry of entries) {
    void pullDiagnosticsNow(entry)
  }
  return entries.find((entry) => entry.isPrimary) ?? entries[0] ?? null
}

export function flushPendingLspChange(entry: LspDocumentEntry): Promise<void> {
  if (entry.changeTimer !== null) {
    sendChangeNow(entry)
  }
  return entry.lastSync
}

export function getLspEntryForModelUri(modelUri: string): LspDocumentEntry | null {
  const entries = entriesByModelUri.get(modelUri) ?? []
  return entries.find((entry) => entry.isPrimary) ?? null
}

export function getLspEntriesForModelUri(modelUri: string): LspDocumentEntry[] {
  return [...(entriesByModelUri.get(modelUri) ?? [])]
}

export function getLspEntriesForSessionDocument(
  sessionId: string,
  fileUri: string
): LspDocumentEntry[] {
  return [...(entriesBySessionDocument.get(sessionDocumentKey(sessionId, fileUri)) ?? [])]
}

export function closeLspDocumentForModel(
  modelUri: string,
  clearMarkers: (model: editor.ITextModel, serverId: string) => void
): void {
  const entries = entriesByModelUri.get(modelUri)
  if (!entries) {
    return
  }
  for (const entry of entries) {
    entry.refCount--
  }
  if (entries.some((entry) => entry.refCount > 0)) {
    return
  }
  entriesByModelUri.delete(modelUri)
  setLspFileStatus(entries[0]?.filePath ?? '', null)
  for (const entry of entries) {
    unregisterSessionDocumentEntry(entry)
    entry.contentListener.dispose()
    if (entry.changeTimer !== null) {
      clearTimeout(entry.changeTimer)
      entry.changeTimer = null
    }
    if (!entry.model.isDisposed()) {
      clearMarkers(entry.model, entry.serverId)
    }
    void window.api.lsp
      .closeDocument({ sessionId: entry.sessionId, fileUri: entry.fileUri })
      .catch(() => {})
  }
}
