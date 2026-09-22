// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.

export type LspPosition = { line: number; character: number }
export type LspRange = { start: LspPosition; end: LspPosition }

export type LspMarkupContent = { kind?: string; value: string }
export type LspMarkedString = string | { language: string; value: string }

export type LspCompletionItem = {
  label: string
  kind?: number
  detail?: string
  documentation?: string | LspMarkupContent
  sortText?: string
  filterText?: string
  insertText?: string
  insertTextFormat?: number
  textEdit?: { newText: string; range?: LspRange; insert?: LspRange; replace?: LspRange }
}

export type LspDiagnostic = {
  range: LspRange
  message: string
  severity?: number
  code?: string | number | { value: string | number }
  source?: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isLspPosition(value: unknown): value is LspPosition {
  return isRecord(value) && typeof value.line === 'number' && typeof value.character === 'number'
}

export function isLspRange(value: unknown): value is LspRange {
  return isRecord(value) && isLspPosition(value.start) && isLspPosition(value.end)
}

export function isLspMarkupContent(value: unknown): value is LspMarkupContent {
  return (
    isRecord(value) &&
    typeof value.value === 'string' &&
    (value.kind === undefined || typeof value.kind === 'string')
  )
}

export function isLspMarkedString(value: unknown): value is LspMarkedString {
  return typeof value === 'string' || isLspMarkupContent(value)
}

export function isLspCompletionItem(value: unknown): value is LspCompletionItem {
  if (!isRecord(value) || typeof value.label !== 'string') {
    return false
  }
  if (value.kind !== undefined && typeof value.kind !== 'number') {
    return false
  }
  if (value.detail !== undefined && typeof value.detail !== 'string') {
    return false
  }
  if (value.documentation !== undefined && !isLspMarkedString(value.documentation)) {
    return false
  }
  if (value.sortText !== undefined && typeof value.sortText !== 'string') {
    return false
  }
  if (value.filterText !== undefined && typeof value.filterText !== 'string') {
    return false
  }
  if (value.insertText !== undefined && typeof value.insertText !== 'string') {
    return false
  }
  if (value.insertTextFormat !== undefined && typeof value.insertTextFormat !== 'number') {
    return false
  }
  if (value.textEdit === undefined) {
    return true
  }
  if (!isRecord(value.textEdit) || typeof value.textEdit.newText !== 'string') {
    return false
  }
  return (
    (value.textEdit.range === undefined || isLspRange(value.textEdit.range)) &&
    (value.textEdit.insert === undefined || isLspRange(value.textEdit.insert)) &&
    (value.textEdit.replace === undefined || isLspRange(value.textEdit.replace))
  )
}

export function isLspDiagnostic(value: unknown): value is LspDiagnostic {
  if (!isRecord(value) || !isLspRange(value.range) || typeof value.message !== 'string') {
    return false
  }
  if (value.severity !== undefined && typeof value.severity !== 'number') {
    return false
  }
  if (
    value.code !== undefined &&
    typeof value.code !== 'string' &&
    typeof value.code !== 'number' &&
    (!isRecord(value.code) ||
      (typeof value.code.value !== 'string' && typeof value.code.value !== 'number'))
  ) {
    return false
  }
  return value.source === undefined || typeof value.source === 'string'
}
