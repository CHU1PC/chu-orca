import { describe, expect, it } from 'vitest'
import {
  loadTextMateGrammar,
  textMateGrammarLoaders,
  textMateLanguageScopes
} from './textmate-language-catalog'

function collectExternalIncludes(value: unknown, includes = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectExternalIncludes(item, includes)
    }
    return includes
  }
  if (typeof value !== 'object' || value === null) {
    return includes
  }
  for (const [key, nested] of Object.entries(value)) {
    if (
      key === 'include' &&
      typeof nested === 'string' &&
      !nested.startsWith('#') &&
      !nested.startsWith('$')
    ) {
      includes.add(nested)
    }
    collectExternalIncludes(nested, includes)
  }
  return includes
}

describe('TextMate language catalog', () => {
  it('keeps every grammar scope and language mapping backed by the real catalog', () => {
    for (const [scopeName, loader] of Object.entries(textMateGrammarLoaders)) {
      expect(typeof loader, scopeName).toBe('function')
    }

    for (const [languageId, scopeName] of Object.entries(textMateLanguageScopes)) {
      expect(textMateGrammarLoaders[scopeName], `${languageId} → ${scopeName}`).toBeDefined()
    }
  })

  it('loads every vendored grammar with its catalog scope', async () => {
    for (const scopeName of Object.keys(textMateGrammarLoaders)) {
      const grammar = await loadTextMateGrammar(scopeName)
      expect(grammar, scopeName).toMatchObject({ scopeName })
    }
  })

  it('loads the Dockerfile grammar and maps its language id', async () => {
    const grammar = await loadTextMateGrammar('source.dockerfile')
    expect(grammar?.scopeName).toBe('source.dockerfile')
    expect(textMateLanguageScopes.dockerfile).toBe('source.dockerfile')
  })

  it('has loaders for every external scope included by the Dockerfile grammar', async () => {
    const grammar = await loadTextMateGrammar('source.dockerfile')
    expect(grammar).not.toBeNull()
    for (const scopeName of collectExternalIncludes(grammar)) {
      expect(textMateGrammarLoaders[scopeName], scopeName).toBeDefined()
    }
  })

  it('returns null for an unknown scope', async () => {
    await expect(loadTextMateGrammar('source.unknown')).resolves.toBeNull()
  })
})
