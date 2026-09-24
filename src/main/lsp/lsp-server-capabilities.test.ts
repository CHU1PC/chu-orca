import { describe, expect, it } from 'vitest'
import { parseLspServerCapabilities } from './lsp-server-capabilities'

describe('parseLspServerCapabilities', () => {
  it('accepts docker-langserver semantic tokens with full support', () => {
    expect(
      parseLspServerCapabilities({
        capabilities: {
          semanticTokensProvider: {
            full: true,
            legend: {
              tokenTypes: [
                'keyword',
                'comment',
                'parameter',
                'property',
                'namespace',
                'class',
                'macro',
                'string',
                'variable',
                'operator'
              ],
              tokenModifiers: ['declaration', 'definition', 'deprecated']
            }
          }
        }
      }).semanticTokensLegend
    ).toEqual({
      tokenTypes: [
        'keyword',
        'comment',
        'parameter',
        'property',
        'namespace',
        'class',
        'macro',
        'string',
        'variable',
        'operator'
      ],
      tokenModifiers: ['declaration', 'definition', 'deprecated']
    })
  })

  it('accepts full semantic tokens with delta disabled', () => {
    expect(
      parseLspServerCapabilities({
        capabilities: {
          semanticTokensProvider: {
            full: { delta: false },
            legend: { tokenTypes: ['class'], tokenModifiers: [] }
          }
        }
      }).semanticTokensLegend
    ).toEqual({ tokenTypes: ['class'], tokenModifiers: [] })
  })

  it.each([
    ['full false', { full: false, legend: { tokenTypes: ['class'], tokenModifiers: [] } }],
    ['missing full', { legend: { tokenTypes: ['class'], tokenModifiers: [] } }],
    ['non-string token type', { full: true, legend: { tokenTypes: [1], tokenModifiers: [] } }],
    [
      'non-string token modifier',
      { full: true, legend: { tokenTypes: ['class'], tokenModifiers: [1] } }
    ],
    ['missing token modifiers', { full: true, legend: { tokenTypes: ['class'] } }],
    ['missing legend', { full: true }]
  ])('omits semantic tokens for %s', (_name, provider) => {
    expect(
      parseLspServerCapabilities({ capabilities: { semanticTokensProvider: provider } })
    ).not.toHaveProperty('semanticTokensLegend')
  })

  it('records document link resolve support only when true', () => {
    expect(
      parseLspServerCapabilities({
        capabilities: { documentLinkProvider: { resolveProvider: true } }
      }).documentLinks
    ).toEqual({ resolveProvider: true })
    expect(
      parseLspServerCapabilities({ capabilities: { documentLinkProvider: {} } }).documentLinks
    ).toEqual({
      resolveProvider: false
    })
  })

  it('omits absent capabilities and preserves pull diagnostic truthiness', () => {
    expect(parseLspServerCapabilities({ capabilities: {} })).toEqual({ pullDiagnostics: false })
    expect(
      parseLspServerCapabilities({ capabilities: { diagnosticProvider: { identifier: 'ts' } } })
    ).toEqual({ pullDiagnostics: true })
    expect(parseLspServerCapabilities({})).toEqual({ pullDiagnostics: false })
  })
})
