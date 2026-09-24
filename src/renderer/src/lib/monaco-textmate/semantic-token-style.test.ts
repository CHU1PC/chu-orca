import { describe, expect, it } from 'vitest'
import {
  resolveSemanticTokenStyle,
  SEMANTIC_STYLE_LEGEND,
  semanticStyleLegendIndex,
  semanticStyleThemeRules
} from './semantic-token-style'

const dockerTokenStyles = [
  ['keyword', 'c678dd'],
  ['comment', '7f848e'],
  ['parameter', 'e06c75'],
  ['property', 'e06c75'],
  ['namespace', 'e5c07b'],
  ['class', 'e5c07b'],
  ['macro', 'd19a66'],
  ['string', '98c379'],
  ['variable', 'e06c75'],
  ['operator', 'abb2bf']
] as const

describe('resolveSemanticTokenStyle', () => {
  it.each(dockerTokenStyles)('maps Dockerfile %s to #%s', (type, foreground) => {
    const style = resolveSemanticTokenStyle(type, [], 'dockerfile')
    expect(style?.foreground).toBe(foreground)
    expect(style && semanticStyleLegendIndex(style)).toBeGreaterThanOrEqual(0)
  })

  it.each(
    dockerTokenStyles.flatMap(([type, foreground]) =>
      ['declaration', 'definition'].map((modifier) => [type, foreground, modifier] as const)
    )
  )('keeps %s at #%s with modifier %s', (type, foreground, modifier) => {
    expect(resolveSemanticTokenStyle(type, [modifier], 'dockerfile')?.foreground).toBe(foreground)
  })

  it('prefers semantic colors over fallback scopes and applies language selectors narrowly', () => {
    expect(resolveSemanticTokenStyle('enumMember', [], 'typescript')?.foreground).toBe('56b6c2')
    expect(resolveSemanticTokenStyle('macro', [], 'dockerfile')?.foreground).toBe('d19a66')
    expect(
      resolveSemanticTokenStyle('variable', ['defaultLibrary'], 'typescript')?.foreground
    ).toBe('e5c07b')
    expect(resolveSemanticTokenStyle('variable', ['constant'], 'typescript')?.foreground).toBe(
      'd19a66'
    )
    expect(resolveSemanticTokenStyle('property', [], 'dart')?.foreground).toBe('d19a66')
    expect(resolveSemanticTokenStyle('property', [], 'typescript')?.foreground).toBe('e06c75')
  })

  it('drops unknown types and gives every resolved style a synthetic legend entry', () => {
    expect(resolveSemanticTokenStyle('unknownType', [], 'dockerfile')).toBeNull()
    expect(SEMANTIC_STYLE_LEGEND.every((token) => !token.includes('.'))).toBe(true)
    expect(semanticStyleThemeRules()).toHaveLength(SEMANTIC_STYLE_LEGEND.length)
    for (const [type] of dockerTokenStyles) {
      const style = resolveSemanticTokenStyle(type, [], 'dockerfile')
      if (style) {
        expect(semanticStyleLegendIndex(style)).toBeGreaterThanOrEqual(0)
      }
    }
  })
})
