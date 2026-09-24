import { describe, expect, it, vi } from 'vitest'
import { createMonacoProviderRegistry } from './monaco-provider-registrations'

describe('createMonacoProviderRegistry', () => {
  it('keeps registrations for the same Monaco and disposes them on change', () => {
    const registry = createMonacoProviderRegistry<object>()
    const firstMonaco = {}
    const secondMonaco = {}
    const reset = vi.fn()
    const firstDisposable = { dispose: vi.fn() }
    const secondDisposable = { dispose: vi.fn() }

    registry.resetIfMonacoChanged(firstMonaco, reset)
    registry.push(firstDisposable)
    registry.resetIfMonacoChanged(firstMonaco, reset)

    expect(firstDisposable.dispose).not.toHaveBeenCalled()
    expect(reset).toHaveBeenCalledTimes(1)
    expect(registry.isFor(firstMonaco)).toBe(true)

    registry.push(secondDisposable)
    registry.resetIfMonacoChanged(secondMonaco, reset)

    expect(firstDisposable.dispose).toHaveBeenCalledTimes(1)
    expect(secondDisposable.dispose).toHaveBeenCalledTimes(1)
    expect(reset).toHaveBeenCalledTimes(2)
    expect(registry.isFor(secondMonaco)).toBe(true)
  })
})
