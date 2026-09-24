import type * as MonacoNamespace from 'monaco-editor'
import type { IDisposable, editor, languages } from 'monaco-editor'
import { lspRangeToMonaco } from './lsp-monaco-conversion'
import { flushPendingLspChange, getLspEntriesForModelUri } from './monaco-lsp-documents'
import type { LspDocumentEntry } from './monaco-lsp-documents'
import { isLspRange, isRecord } from './lsp-message-guards'
import type { LspRange } from './lsp-message-guards'

type MonacoApi = typeof MonacoNamespace
type LspDocumentLink = {
  range: LspRange
  target?: string
  tooltip?: string
  data?: unknown
  [key: string]: unknown
}
type LspLinkSession = { sessionId: string; fileUri: string; resolveProvider: boolean }
type LspBackedLink = languages.ILink & {
  rawLspLink: LspDocumentLink
  lspSession: LspLinkSession
}

function isLspDocumentLink(value: unknown): value is LspDocumentLink {
  if (!isRecord(value) || !isLspRange(value.range)) {
    return false
  }
  return (
    (value.target === undefined || typeof value.target === 'string') &&
    (value.tooltip === undefined || typeof value.tooltip === 'string')
  )
}

function safeHttpUrl(target: string | undefined): string | null {
  if (!target) {
    return null
  }
  try {
    const url = new URL(target)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function findDocumentLinkEntry(model: editor.ITextModel): LspDocumentEntry | null {
  const entries = getLspEntriesForModelUri(model.uri.toString()).filter(
    (entry) => entry.documentLinks !== undefined
  )
  return entries.find((entry) => entry.isPrimary) ?? entries[0] ?? null
}

function isLspBackedLink(link: languages.ILink | undefined): link is LspBackedLink {
  return (
    link !== undefined &&
    'rawLspLink' in link &&
    isLspDocumentLink(link.rawLspLink) &&
    'lspSession' in link &&
    isRecord(link.lspSession) &&
    typeof link.lspSession.sessionId === 'string' &&
    typeof link.lspSession.fileUri === 'string' &&
    typeof link.lspSession.resolveProvider === 'boolean'
  )
}

export function registerDocumentLinkOpener(monaco: MonacoApi): IDisposable {
  return monaco.editor.registerLinkOpener({
    open: async (resource) => {
      const url = safeHttpUrl(resource.toString())
      if (!url) {
        return false
      }
      if (typeof window.api?.shell?.openUrl !== 'function') {
        return false
      }
      try {
        await window.api.shell.openUrl(url)
        return true
      } catch {
        // The shell bridge may be unavailable in renderer-only surfaces.
        return false
      }
    }
  })
}

export function registerDocumentLinksProvider(monaco: MonacoApi, languageId: string): IDisposable {
  const provider: languages.LinkProvider = {
    provideLinks: async (model) => {
      const entry = findDocumentLinkEntry(model)
      if (!entry?.documentLinks) {
        return { links: [] }
      }
      try {
        await flushPendingLspChange(entry)
        const result = await window.api.lsp.request({
          sessionId: entry.sessionId,
          method: 'textDocument/documentLink',
          params: { textDocument: { uri: entry.fileUri } }
        })
        const links = Array.isArray(result) ? result.filter(isLspDocumentLink) : []
        return {
          links: links.map((rawLspLink): LspBackedLink => {
            const link: LspBackedLink = {
              range: lspRangeToMonaco(rawLspLink.range),
              rawLspLink,
              lspSession: {
                sessionId: entry.sessionId,
                fileUri: entry.fileUri,
                resolveProvider: entry.documentLinks?.resolveProvider === true
              }
            }
            const url = safeHttpUrl(rawLspLink.target)
            if (url) {
              link.url = url
            }
            if (rawLspLink.tooltip !== undefined) {
              link.tooltip = rawLspLink.tooltip
            }
            return link
          })
        }
      } catch {
        return { links: [] }
      }
    },
    resolveLink: async (link) => {
      if (!isLspBackedLink(link) || link.url || !link.lspSession.resolveProvider) {
        return link
      }
      try {
        const result = await window.api.lsp.request({
          sessionId: link.lspSession.sessionId,
          method: 'documentLink/resolve',
          params: link.rawLspLink
        })
        if (!isRecord(result) || typeof result.target !== 'string') {
          return link
        }
        const url = safeHttpUrl(result.target)
        return url ? { ...link, url } : link
      } catch {
        return link
      }
    }
  }
  return monaco.languages.registerLinkProvider(languageId, provider)
}
