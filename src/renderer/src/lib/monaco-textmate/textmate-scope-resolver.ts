export type ThemeScopeIndex = ReadonlySet<string>

export function buildThemeScopeIndex(rules: { token: string }[]): ThemeScopeIndex {
  return new Set(rules.map(({ token }) => token).filter((token) => token.length > 0))
}

export function resolveTokenScope(scopes: readonly string[], index: ThemeScopeIndex): string {
  for (let scopeIndex = scopes.length - 1; scopeIndex >= 0; scopeIndex -= 1) {
    const scope = scopes[scopeIndex]
    const segments = scope.split('.')
    for (let prefixLength = segments.length; prefixLength > 0; prefixLength -= 1) {
      const prefix = segments.slice(0, prefixLength).join('.')
      if (index.has(prefix)) {
        return scope
      }
    }
  }
  return scopes.at(-1) ?? ''
}
