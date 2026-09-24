import type { LspSemanticTokensLegend } from '../../../../shared/lsp-types'
import {
  resolveSemanticTokenStyle,
  semanticStyleLegendIndex
} from '../monaco-textmate/semantic-token-style'

export type SemanticTokensResult = { data: Uint32Array }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isUint32(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff
}

/** Converts LSP relative tokens to the fixed synthetic legend used by One Dark Pro. */
export function decodeLspSemanticTokens(
  result: unknown,
  serverLegend: LspSemanticTokensLegend,
  languageId: string
): SemanticTokensResult | null {
  if (!isRecord(result) || !Array.isArray(result.data) || result.data.length % 5 !== 0) {
    return null
  }
  const raw = result.data
  for (const value of raw.values()) {
    if (!isUint32(value)) {
      return null
    }
  }
  const modifierMask =
    serverLegend.tokenModifiers.length >= 32
      ? 0xffffffff
      : 2 ** serverLegend.tokenModifiers.length - 1
  const kept: number[] = []
  let line = 0
  let start = 0
  let previousKeptLine = 0
  let previousKeptStart = 0
  let hasKeptToken = false

  for (let offset = 0; offset < raw.length; offset += 5) {
    const deltaLine = raw[offset]
    const deltaStart = raw[offset + 1]
    const length = raw[offset + 2]
    const typeIndex = raw[offset + 3]
    const modifierBits = raw[offset + 4]
    if (
      deltaLine === undefined ||
      deltaStart === undefined ||
      length === undefined ||
      typeIndex === undefined ||
      modifierBits === undefined
    ) {
      return null
    }
    line += deltaLine
    start = deltaLine === 0 ? start + deltaStart : deltaStart
    const tokenType = serverLegend.tokenTypes[typeIndex]
    if (
      length === 0 ||
      typeIndex >= serverLegend.tokenTypes.length ||
      modifierBits > modifierMask ||
      tokenType === undefined
    ) {
      continue
    }
    const modifiers = serverLegend.tokenModifiers.filter(
      (_modifier, index) => Math.floor(modifierBits / 2 ** index) % 2 === 1
    )
    const style = resolveSemanticTokenStyle(tokenType, modifiers, languageId)
    const styleIndex = style ? semanticStyleLegendIndex(style) : -1
    if (styleIndex < 0) {
      continue
    }
    kept.push(
      line - (hasKeptToken ? previousKeptLine : 0),
      line === previousKeptLine && hasKeptToken ? start - previousKeptStart : start,
      length,
      styleIndex,
      0
    )
    previousKeptLine = line
    previousKeptStart = start
    hasKeptToken = true
  }
  return { data: Uint32Array.from(kept) }
}
