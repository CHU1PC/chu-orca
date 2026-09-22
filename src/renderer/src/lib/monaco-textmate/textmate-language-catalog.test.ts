import { describe, expect, it } from 'vitest'
import {
  loadTextMateGrammar,
  textMateGrammarLoaders,
  textMateLanguageScopes
} from './textmate-language-catalog'

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

  it('returns null for an unknown scope', async () => {
    await expect(loadTextMateGrammar('source.unknown')).resolves.toBeNull()
  })
})
