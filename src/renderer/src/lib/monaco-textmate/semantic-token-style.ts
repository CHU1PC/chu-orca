import type { MonacoTokenColorRule } from './textmate-theme'
import {
  resolveStyleParts,
  SEMANTIC_STYLE_LEGEND_INPUTS,
  toSemanticStyle
} from './semantic-token-style-resolution'
import type { SemanticTokenStyle as ResolvedSemanticTokenStyle } from './semantic-token-style-resolution'

export type { SemanticTokenStyle } from './semantic-token-style-resolution'

type LegendEntry = { name: string; style: ResolvedSemanticTokenStyle }

function styleKey(style: ResolvedSemanticTokenStyle): string {
  return `${style.foreground ?? ''}\u0000${style.fontStyle ?? '\u0001'}`
}

function canonicalStyle(style: ResolvedSemanticTokenStyle): ResolvedSemanticTokenStyle {
  return (
    toSemanticStyle({
      foreground: style.foreground?.replace(/^#/, '').toLowerCase(),
      bold: style.fontStyle?.includes('bold'),
      italic: style.fontStyle?.includes('italic'),
      underline: style.fontStyle?.includes('underline'),
      strikethrough: style.fontStyle?.includes('strikethrough')
    }) ?? {}
  )
}

function allSubsets(values: readonly string[]): string[][] {
  return values.reduce<string[][]>(
    (sets, value) => [...sets, ...sets.map((set) => [...set, value])],
    [[]]
  )
}

function buildSemanticStyleLegend(): LegendEntry[] {
  const modifierSets = allSubsets([...SEMANTIC_STYLE_LEGEND_INPUTS.modifiers].sort())
  const styles = new Map<string, ResolvedSemanticTokenStyle>()
  for (const type of [...SEMANTIC_STYLE_LEGEND_INPUTS.types].sort()) {
    for (const modifierSet of modifierSets) {
      for (const languageId of [...SEMANTIC_STYLE_LEGEND_INPUTS.languages].sort()) {
        const style = toSemanticStyle(resolveStyleParts(type, modifierSet, languageId))
        if (style) {
          styles.set(styleKey(style), style)
        }
      }
    }
  }
  return [...styles.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, style], index) => ({ name: `orca-semantic-e5c07b-${index}`, style }))
}

const semanticStyleLegend = buildSemanticStyleLegend()

export const SEMANTIC_STYLE_LEGEND: readonly string[] = Object.freeze(
  semanticStyleLegend.map(({ name }) => name)
)

export function resolveSemanticTokenStyle(
  type: string,
  modifiers: readonly string[],
  languageId: string
): ResolvedSemanticTokenStyle | null {
  return toSemanticStyle(resolveStyleParts(type, modifiers, languageId))
}

export function semanticStyleLegendIndex(style: ResolvedSemanticTokenStyle): number {
  const key = styleKey(canonicalStyle(style))
  return semanticStyleLegend.findIndex(({ style: entryStyle }) => styleKey(entryStyle) === key)
}

export function semanticStyleThemeRules(): MonacoTokenColorRule[] {
  return semanticStyleLegend.map(({ name, style }) => ({ token: name, ...style }))
}
