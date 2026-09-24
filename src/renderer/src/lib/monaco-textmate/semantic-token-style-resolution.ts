import oneDarkProTheme from './themes/one-dark-pro.json'
import { SEMANTIC_TOKEN_SCOPE_DEFAULTS } from './semantic-token-scope-defaults'
import { convertVsCodeTokenColors } from './textmate-theme'
import { buildThemeScopeIndex, resolveTokenScope } from './textmate-scope-resolver'

export type SemanticTokenStyle = { foreground?: string; fontStyle?: string }

export type SemanticStyleParts = {
  foreground?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
}

type ParsedSelector = {
  type: string
  modifiers: string[]
  language?: string
}

type SemanticRule = { selector: ParsedSelector; style: SemanticStyleParts }
const STYLE_KEYS = ['foreground', 'bold', 'italic', 'underline', 'strikethrough'] as const
const FONT_STYLE_KEYS = ['bold', 'italic', 'underline', 'strikethrough'] as const

const semanticRules: readonly SemanticRule[] = Object.entries(
  oneDarkProTheme.semanticTokenColors
).map(([selector, setting]) => ({
  selector: parseSelector(selector),
  style: readStyleParts(setting)
}))

const tokenColorRules = convertVsCodeTokenColors(oneDarkProTheme.tokenColors).map((rule) => ({
  ...rule,
  foreground: rule.foreground?.toLowerCase()
}))
const tokenColorScopeIndex = buildThemeScopeIndex(tokenColorRules)
const parsedSelectors = semanticRules.map(({ selector }) => selector)

export const SEMANTIC_STYLE_LEGEND_INPUTS = {
  types: [
    ...new Set([
      ...SEMANTIC_TOKEN_SCOPE_DEFAULTS.map(({ type }) => type),
      ...parsedSelectors.map(({ type }) => type).filter((type) => type !== '*'),
      '__unknown__'
    ])
  ],
  modifiers: [
    ...new Set([
      ...SEMANTIC_TOKEN_SCOPE_DEFAULTS.flatMap(({ modifiers }) => modifiers),
      ...parsedSelectors.flatMap(({ modifiers }) => modifiers)
    ])
  ],
  languages: [
    ...new Set([
      ...parsedSelectors.flatMap(({ language }) => (language ? [language] : [])),
      '__other_language__'
    ])
  ]
}

function parseSelector(selector: string): ParsedSelector {
  const [classifier, language] = selector.split(':')
  const [type, ...modifiers] = (classifier ?? '').split('.')
  return { type: type ?? '', modifiers, ...(language ? { language } : {}) }
}

function normalizeForeground(foreground: string): string {
  return foreground.replace(/^#/, '').toLowerCase()
}

function readStyleParts(value: unknown): SemanticStyleParts {
  if (typeof value === 'string') {
    return { foreground: normalizeForeground(value) }
  }
  if (typeof value !== 'object' || value === null) {
    return {}
  }

  const foreground =
    'foreground' in value && typeof value.foreground === 'string'
      ? normalizeForeground(value.foreground)
      : undefined
  const fontStyle =
    'fontStyle' in value && typeof value.fontStyle === 'string' ? value.fontStyle : undefined
  if (fontStyle !== undefined) {
    const parts: SemanticStyleParts = {
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false
    }
    for (const match of fontStyle.match(/italic|bold|underline|strikethrough/g) ?? []) {
      if (match === 'bold') {
        parts.bold = true
      }
      if (match === 'italic') {
        parts.italic = true
      }
      if (match === 'underline') {
        parts.underline = true
      }
      if (match === 'strikethrough') {
        parts.strikethrough = true
      }
    }
    if (foreground !== undefined) {
      parts.foreground = foreground
    }
    return parts
  }

  const parts: SemanticStyleParts = {}
  if (foreground !== undefined) {
    parts.foreground = foreground
  }
  for (const key of ['bold', 'italic', 'underline', 'strikethrough'] as const) {
    if (key in value && typeof value[key] === 'boolean') {
      parts[key] = value[key]
    }
  }
  return parts
}

function selectorScore(
  selector: ParsedSelector,
  type: string,
  modifiers: readonly string[],
  languageId: string
): number {
  if (selector.type !== '*' && selector.type !== type) {
    return -1
  }
  if (selector.language !== undefined && selector.language !== languageId) {
    return -1
  }
  if (selector.modifiers.some((modifier) => !modifiers.includes(modifier))) {
    return -1
  }
  return (
    (selector.language ? 10 : 0) +
    (selector.type === '*' ? 0 : 100) +
    selector.modifiers.length * 100
  )
}

function isScopePrefix(scope: string, token: string): boolean {
  return scope === token || scope.startsWith(`${token}.`)
}

function setStylePart(
  target: SemanticStyleParts,
  key: keyof SemanticStyleParts,
  value: string | boolean
): void {
  if (key === 'foreground' && typeof value === 'string') {
    target.foreground = value
  }
  if (key === 'bold' && typeof value === 'boolean') {
    target.bold = value
  }
  if (key === 'italic' && typeof value === 'boolean') {
    target.italic = value
  }
  if (key === 'underline' && typeof value === 'boolean') {
    target.underline = value
  }
  if (key === 'strikethrough' && typeof value === 'boolean') {
    target.strikethrough = value
  }
}

function resolveThemeScopeStyle(scope: string): SemanticStyleParts | undefined {
  const unmatched = '\u0000'
  if (resolveTokenScope([scope, unmatched], tokenColorScopeIndex) === unmatched) {
    return undefined
  }

  const scores = { foreground: -1, bold: -1, italic: -1, underline: -1, strikethrough: -1 }
  const style: SemanticStyleParts = {}
  for (const [index, rule] of tokenColorRules.entries()) {
    if (!isScopePrefix(scope, rule.token)) {
      continue
    }
    const score = rule.token.length
    const parts = readStyleParts({ foreground: rule.foreground, fontStyle: rule.fontStyle })
    for (const key of ['foreground', 'bold', 'italic', 'underline', 'strikethrough'] as const) {
      const value = parts[key]
      if (value !== undefined && score >= scores[key]) {
        scores[key] = score + index / tokenColorRules.length
        setStylePart(style, key, value)
      }
    }
  }
  return Object.keys(style).length > 0 ? style : undefined
}

function resolveProbeScopes(
  scopes: readonly (readonly string[])[]
): SemanticStyleParts | undefined {
  for (const probe of scopes) {
    const style: SemanticStyleParts = {}
    const scores = { foreground: -1, bold: -1, italic: -1, underline: -1, strikethrough: -1 }
    for (const scope of probe) {
      const scopeStyle = resolveThemeScopeStyle(scope)
      if (!scopeStyle) {
        continue
      }
      for (const key of ['foreground', 'bold', 'italic', 'underline', 'strikethrough'] as const) {
        const value = scopeStyle[key]
        if (value !== undefined && scores[key] < 0) {
          scores[key] = 0
          setStylePart(style, key, value)
        }
      }
    }
    if (Object.keys(style).length > 0) {
      return style
    }
  }
  return undefined
}

function applyStyle(
  target: SemanticStyleParts,
  source: SemanticStyleParts,
  scores: Record<keyof SemanticStyleParts, number>,
  score: number
): void {
  for (const key of STYLE_KEYS) {
    const value = source[key]
    if (value !== undefined && score >= scores[key]) {
      scores[key] = score
      setStylePart(target, key, value)
    }
  }
}

export function toSemanticStyle(parts: SemanticStyleParts): SemanticTokenStyle | null {
  const style: SemanticTokenStyle = {}
  if (parts.foreground !== undefined) {
    style.foreground = parts.foreground
  }
  const hasFontStyle = FONT_STYLE_KEYS.some((key) => parts[key] !== undefined)
  if (hasFontStyle) {
    style.fontStyle = FONT_STYLE_KEYS.filter((key) => parts[key] === true).join(' ')
  }
  return Object.keys(style).length > 0 ? style : null
}

export function resolveStyleParts(
  type: string,
  modifiers: readonly string[],
  languageId: string
): SemanticStyleParts {
  const style: SemanticStyleParts = {}
  const semanticScores: Record<keyof SemanticStyleParts, number> = {
    foreground: -1,
    bold: -1,
    italic: -1,
    underline: -1,
    strikethrough: -1
  }
  for (const rule of semanticRules) {
    const score = selectorScore(rule.selector, type, modifiers, languageId)
    if (score >= 0) {
      applyStyle(style, rule.style, semanticScores, score)
    }
  }

  const defaultScores: Record<keyof SemanticStyleParts, number> = {
    foreground: -1,
    bold: -1,
    italic: -1,
    underline: -1,
    strikethrough: -1
  }
  for (const key of STYLE_KEYS) {
    if (semanticScores[key] >= 0) {
      defaultScores[key] = Number.MAX_VALUE
    }
  }
  for (const rule of SEMANTIC_TOKEN_SCOPE_DEFAULTS) {
    const score = selectorScore(
      { type: rule.type, modifiers: rule.modifiers },
      type,
      modifiers,
      languageId
    )
    if (score < 0) {
      continue
    }
    const fallback = resolveProbeScopes(rule.scopes)
    if (fallback) {
      applyStyle(style, fallback, defaultScores, score)
    }
  }
  return style
}
