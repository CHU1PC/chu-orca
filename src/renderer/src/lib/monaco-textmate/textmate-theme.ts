import type * as Monaco from 'monaco-editor'
import oneDarkProTheme from './themes/one-dark-pro.json'
import { semanticStyleThemeRules } from './semantic-token-style'

type VsCodeTokenColorSettings = {
  foreground?: string
  fontStyle?: string
}

type VsCodeTokenColor = {
  scope?: string | readonly string[]
  settings?: VsCodeTokenColorSettings
}

export type MonacoTokenColorRule = {
  token: string
  foreground?: string
  fontStyle?: string
}

type MonacoThemeApi = Pick<typeof Monaco.editor, 'defineTheme'>

function expandScopes(scope: VsCodeTokenColor['scope']): string[] {
  if (Array.isArray(scope)) {
    return scope.map((entry) => entry.trim()).filter(Boolean)
  }
  if (typeof scope === 'string') {
    return scope
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
  return []
}

function countDroppedDescendantScopes(tokenColors: readonly VsCodeTokenColor[]): number {
  return tokenColors.reduce(
    (count, tokenColor) =>
      count + expandScopes(tokenColor.scope).filter((scope) => scope.includes(' ')).length,
    0
  )
}

export const DROPPED_DESCENDANT_SCOPE_COUNT = countDroppedDescendantScopes(
  oneDarkProTheme.tokenColors
)

export function convertVsCodeTokenColors(
  tokenColors: readonly VsCodeTokenColor[]
): MonacoTokenColorRule[] {
  const rules: MonacoTokenColorRule[] = []
  for (const tokenColor of tokenColors) {
    const settings = tokenColor.settings
    if (!settings || (!settings.foreground && !settings.fontStyle)) {
      continue
    }
    for (const scope of expandScopes(tokenColor.scope)) {
      if (scope.includes(' ')) {
        continue
      }
      const rule: MonacoTokenColorRule = { token: scope }
      if (settings.foreground) {
        rule.foreground = settings.foreground.replace(/^#/, '')
      }
      if (settings.fontStyle !== undefined) {
        rule.fontStyle = settings.fontStyle
      }
      rules.push(rule)
    }
  }
  return rules
}

export function defineOneDarkTheme(monaco: { editor: MonacoThemeApi }): void {
  const rules = [
    ...convertVsCodeTokenColors(oneDarkProTheme.tokenColors),
    ...semanticStyleThemeRules()
  ]
  // テーマの色マップはコピーせず、トークン色だけを変更してエディター背景とクロームをOrca側に任せる。
  monaco.editor.defineTheme('vs-dark', {
    base: 'vs-dark',
    inherit: true,
    rules,
    colors: {}
  })
  monaco.editor.defineTheme('vs', {
    base: 'vs',
    inherit: true,
    rules,
    colors: {}
  })
}
