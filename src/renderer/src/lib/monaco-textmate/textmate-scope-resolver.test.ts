import { describe, expect, it } from 'vitest'
import { buildThemeScopeIndex, resolveTokenScope } from './textmate-scope-resolver'

describe('resolveTokenScope', () => {
  it('selects the matching function scope from a Python stack', () => {
    const index = buildThemeScopeIndex([{ token: 'entity.name.function' }])
    expect(
      resolveTokenScope(
        ['source.python', 'meta.function.python', 'entity.name.function.python'],
        index
      )
    ).toBe('entity.name.function.python')
  })

  it('does not match a non-boundary prefix', () => {
    const index = buildThemeScopeIndex([{ token: 'ent' }])
    expect(resolveTokenScope(['source.python', 'entity'], index)).toBe('entity')
  })

  it('falls back to the last scope when nothing matches', () => {
    const index = buildThemeScopeIndex([{ token: 'keyword' }])
    expect(resolveTokenScope(['source.python', 'meta.function.python'], index)).toBe(
      'meta.function.python'
    )
    expect(resolveTokenScope([], index)).toBe('')
  })
})
