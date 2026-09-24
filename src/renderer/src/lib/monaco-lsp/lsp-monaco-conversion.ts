// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.
/** Pure LSP↔Monaco shape converters. LSP is 0-based, Monaco 1-based; both use
 *  UTF-16 columns, so only the off-by-one shift is needed. Monaco enum objects
 *  are passed in by the caller so conversion logic stays node-testable. */

import type { IRange } from 'monaco-editor'
import {
  isLspCompletionItem,
  isLspDiagnostic,
  isLspMarkedString,
  isLspRange,
  isRecord
} from './lsp-message-guards'
import type { LspMarkupContent, LspMarkedString, LspPosition, LspRange } from './lsp-message-guards'

export type { LspPosition, LspRange } from './lsp-message-guards'

export const LSP_MARKER_OWNER = 'orca-lsp'

export function lspMarkerOwner(serverId: string): string {
  return `${LSP_MARKER_OWNER}:${serverId}`
}

export function lspServerDisplayName(serverId: string): string {
  return (
    {
      pyright: 'Pyright',
      ruff: 'Ruff',
      tsgo: 'TSGo',
      'typescript-language-server': 'TypeScript'
    }[serverId] ?? serverId
  )
}

export function toLspPosition(position: { lineNumber: number; column: number }): LspPosition {
  return { line: position.lineNumber - 1, character: position.column - 1 }
}

export function lspRangeToMonaco(range: LspRange): IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1
  }
}

function markedStringToMarkdown(content: LspMarkedString | LspMarkupContent): string {
  if (typeof content === 'string') {
    return content
  }
  if ('language' in content && content.language) {
    return `\`\`\`${content.language}\n${content.value}\n\`\`\``
  }
  return content.value
}

export function lspHoverToMonaco(
  result: unknown
): { contents: { value: string }[]; range?: IRange } | null {
  if (
    !isRecord(result) ||
    (!isLspMarkedString(result.contents) && !Array.isArray(result.contents))
  ) {
    return null
  }
  const parts = Array.isArray(result.contents)
    ? result.contents.filter(isLspMarkedString)
    : [result.contents]
  const contents = parts
    .map(markedStringToMarkdown)
    .filter((value) => value.trim().length > 0)
    .map((value) => ({ value }))
  if (contents.length === 0) {
    return null
  }
  return isLspRange(result.range)
    ? { contents, range: lspRangeToMonaco(result.range) }
    : { contents }
}

export function lspDefinitionToLocations(result: unknown): { uri: string; range: IRange }[] {
  if (!result) {
    return []
  }
  const items = Array.isArray(result) ? result : [result]
  return items.flatMap((item) => {
    if (!isRecord(item)) {
      return []
    }
    const targetUri = item.targetUri
    const targetRange = item.targetRange
    if (typeof targetUri === 'string' && isLspRange(targetRange)) {
      const targetSelectionRange = isLspRange(item.targetSelectionRange)
        ? item.targetSelectionRange
        : targetRange
      return [
        {
          uri: targetUri,
          range: lspRangeToMonaco(targetSelectionRange)
        }
      ]
    }
    if (typeof item.uri === 'string' && isLspRange(item.range)) {
      return [{ uri: item.uri, range: lspRangeToMonaco(item.range) }]
    }
    return []
  })
}

// LSP CompletionItemKind codes (1-based) by Monaco kind name.
const LSP_COMPLETION_KIND_NAMES: readonly string[] = [
  'Text',
  'Method',
  'Function',
  'Constructor',
  'Field',
  'Variable',
  'Class',
  'Interface',
  'Module',
  'Property',
  'Unit',
  'Value',
  'Enum',
  'Keyword',
  'Snippet',
  'Color',
  'File',
  'Reference',
  'Folder',
  'EnumMember',
  'Constant',
  'Struct',
  'Event',
  'Operator',
  'TypeParameter'
]

export type MonacoCompletionSuggestion = {
  label: string
  kind: number
  detail?: string
  documentation?: { value: string }
  sortText?: string
  filterText?: string
  insertText: string
  insertTextRules?: number
  range: IRange
}

export function lspCompletionToMonaco(
  result: unknown,
  defaultRange: IRange,
  enums: { kinds: Record<string, number>; snippetRule: number }
): { suggestions: MonacoCompletionSuggestion[]; incomplete: boolean } {
  const items = Array.isArray(result)
    ? result.filter(isLspCompletionItem)
    : isRecord(result) && Array.isArray(result.items)
      ? result.items.filter(isLspCompletionItem)
      : []
  const incomplete = isRecord(result) && result.isIncomplete === true
  const suggestions = items.map((item): MonacoCompletionSuggestion => {
    const editRange = item.textEdit?.range ?? item.textEdit?.insert
    const kindName = LSP_COMPLETION_KIND_NAMES[(item.kind ?? 1) - 1] ?? 'Text'
    const suggestion: MonacoCompletionSuggestion = {
      label: item.label,
      kind: enums.kinds[kindName] ?? enums.kinds.Text,
      insertText: item.textEdit?.newText ?? item.insertText ?? item.label,
      range: editRange ? lspRangeToMonaco(editRange) : defaultRange
    }
    if (item.detail) {
      suggestion.detail = item.detail
    }
    if (item.documentation) {
      suggestion.documentation = { value: markedStringToMarkdown(item.documentation) }
    }
    if (item.sortText) {
      suggestion.sortText = item.sortText
    }
    if (item.filterText) {
      suggestion.filterText = item.filterText
    }
    if (item.insertTextFormat === 2) {
      suggestion.insertTextRules = enums.snippetRule
    }
    return suggestion
  })
  return { suggestions, incomplete }
}

export type MonacoDiagnosticMarker = IRange & {
  severity: number
  message: string
  code?: string
  source?: string
}

export function lspDiagnosticsToMonacoMarkers(
  diagnostics: unknown[],
  severities: { Error: number; Warning: number; Info: number; Hint: number },
  serverId?: string
): MonacoDiagnosticMarker[] {
  const severityByLspCode = [severities.Error, severities.Warning, severities.Info, severities.Hint]
  return diagnostics.filter(isLspDiagnostic).map((diagnostic) => {
    const code =
      typeof diagnostic.code === 'object' && diagnostic.code !== null
        ? diagnostic.code.value
        : diagnostic.code
    const marker: MonacoDiagnosticMarker = {
      ...lspRangeToMonaco(diagnostic.range),
      severity: severityByLspCode[(diagnostic.severity ?? 1) - 1] ?? severities.Error,
      message: diagnostic.message
    }
    if (code !== undefined) {
      marker.code = String(code)
    }
    if (diagnostic.source || serverId) {
      marker.source = diagnostic.source ?? (serverId ? lspServerDisplayName(serverId) : undefined)
    }
    return marker
  })
}

/** Pull-diagnostics response (textDocument/diagnostic) → diagnostic items.
 *  Null means "keep the current markers" (kind: 'unchanged' or malformed). */
export function lspPullDiagnosticsToItems(result: unknown): unknown[] | null {
  if (isRecord(result) && result.kind === 'full' && Array.isArray(result.items)) {
    return result.items
  }
  return null
}

/** file:// URI → local absolute path (posix or Windows). Null for anything else. */
export function fileUriToPath(uri: string): string | null {
  const match = /^file:\/\/(?<host>[^/]*)(?<path>\/.*)$/i.exec(uri)
  if (!match?.groups) {
    return null
  }
  const host = match.groups.host
  if (host && host !== 'localhost') {
    return null
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(match.groups.path)
  } catch {
    return null
  }
  const driveMatch = /^\/([A-Za-z]:)(\/.*)?$/.exec(decoded)
  if (driveMatch) {
    return `${driveMatch[1]}${(driveMatch[2] ?? '/').replace(/\//g, '\\')}`
  }
  return decoded
}
