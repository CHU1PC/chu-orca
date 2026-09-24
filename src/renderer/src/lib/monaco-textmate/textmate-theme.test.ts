import type * as Monaco from 'monaco-editor'
import { describe, expect, it } from 'vitest'
import oneDarkProTheme from './themes/one-dark-pro.json'
import { semanticStyleThemeRules } from './semantic-token-style'
import {
  convertVsCodeTokenColors,
  defineOneDarkTheme,
  DROPPED_DESCENDANT_SCOPE_COUNT
} from './textmate-theme'

describe('convertVsCodeTokenColors', () => {
  it('expands array and comma-separated scopes', () => {
    expect(
      convertVsCodeTokenColors([
        { scope: 'entity.name.function, support.function', settings: { foreground: '#61afef' } },
        { scope: ['keyword.control', 'storage.type'], settings: { fontStyle: 'italic' } }
      ])
    ).toEqual([
      { token: 'entity.name.function', foreground: '61afef' },
      { token: 'support.function', foreground: '61afef' },
      { token: 'keyword.control', fontStyle: 'italic' },
      { token: 'storage.type', fontStyle: 'italic' }
    ])
  })

  it('drops descendant selectors and entries without styling', () => {
    expect(
      convertVsCodeTokenColors([
        { scope: 'entity.name.function parameter', settings: { foreground: '#61afef' } },
        { scope: 'comment', settings: {} }
      ])
    ).toEqual([])
  })

  it('converts the vendored One Dark Pro token colors', () => {
    const rules = convertVsCodeTokenColors(oneDarkProTheme.tokenColors)
    expect(DROPPED_DESCENDANT_SCOPE_COUNT).toBe(16)
    expect(rules).toHaveLength(444)
  })
})

describe('defineOneDarkTheme', () => {
  it('adds semantic style rules to both built-in themes', () => {
    const calls: {
      themeId: string
      rules: Parameters<typeof Monaco.editor.defineTheme>[1]['rules']
    }[] = []
    const defineTheme = (
      themeId: string,
      data: Parameters<typeof Monaco.editor.defineTheme>[1]
    ): void => {
      calls.push({ themeId, rules: data.rules })
    }
    const semanticRules = semanticStyleThemeRules()
    defineOneDarkTheme({ editor: { defineTheme } })
    for (const themeId of ['vs-dark', 'vs']) {
      const call = calls.find(({ themeId: calledThemeId }) => calledThemeId === themeId)
      expect(call?.rules).toEqual(expect.arrayContaining(semanticRules))
    }
  })
})
