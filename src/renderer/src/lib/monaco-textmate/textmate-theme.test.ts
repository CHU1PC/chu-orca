import { describe, expect, it } from 'vitest'
import oneDarkProTheme from './themes/one-dark-pro.json'
import {
  convertVsCodeTokenColors,
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
