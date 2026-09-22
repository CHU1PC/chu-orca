import { describe, expect, it } from 'vitest'
import { isPatchedTestFlavor } from './flavor'

describe('patched flavor', () => {
  it('treats an undefined Vite flavor define as release', () => {
    expect(isPatchedTestFlavor()).toBe(false)
  })
})
