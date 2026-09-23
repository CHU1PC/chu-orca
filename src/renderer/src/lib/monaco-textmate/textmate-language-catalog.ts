import type { IRawGrammar } from 'vscode-textmate'

type TextMateGrammarLoader = () => Promise<unknown>

export const textMateGrammarLoaders: Readonly<Record<string, TextMateGrammarLoader>> = {
  'source.python': () => import('./grammars/python.tmLanguage.json'),
  'source.ts': () => import('./grammars/typescript.tmLanguage.json'),
  'source.tsx': () => import('./grammars/typescriptreact.tmLanguage.json'),
  'source.js': () => import('./grammars/javascript.tmLanguage.json'),
  'source.js.jsx': () => import('./grammars/javascriptreact.tmLanguage.json'),
  'source.go': () => import('./grammars/go.tmLanguage.json'),
  'source.rust': () => import('./grammars/rust.tmLanguage.json'),
  'source.json': () => import('./grammars/json.tmLanguage.json'),
  'source.json.comments': () => import('./grammars/jsonc.tmLanguage.json'),
  'source.yaml': () => import('./grammars/yaml.tmLanguage.json'),
  'text.html.markdown': () => import('./grammars/markdown.tmLanguage.json'),
  'source.shell': () => import('./grammars/shell.tmLanguage.json'),
  'text.html.basic': () => import('./grammars/html.tmLanguage.json'),
  'source.css': () => import('./grammars/css.tmLanguage.json'),
  'source.dockerfile': () => import('./grammars/dockerfile.tmLanguage.json')
}

export const textMateLanguageScopes: Readonly<Record<string, string>> = {
  python: 'source.python',
  typescript: 'source.ts',
  javascript: 'source.js',
  go: 'source.go',
  rust: 'source.rust',
  json: 'source.json',
  yaml: 'source.yaml',
  markdown: 'text.html.markdown',
  shell: 'source.shell',
  html: 'text.html.basic',
  css: 'source.css',
  dockerfile: 'source.dockerfile'
}

function hasDefaultExport(value: unknown): value is { default: unknown } {
  return typeof value === 'object' && value !== null && 'default' in value
}

function isRawGrammar(value: unknown): value is IRawGrammar {
  return (
    typeof value === 'object' &&
    value !== null &&
    'scopeName' in value &&
    typeof value.scopeName === 'string' &&
    'repository' in value &&
    typeof value.repository === 'object' &&
    value.repository !== null &&
    'patterns' in value &&
    Array.isArray(value.patterns)
  )
}

export async function loadTextMateGrammar(scopeName: string): Promise<IRawGrammar | null> {
  const loader = textMateGrammarLoaders[scopeName]
  if (!loader) {
    return null
  }

  const grammarModule = await loader()
  const grammar = hasDefaultExport(grammarModule) ? grammarModule.default : grammarModule
  if (!isRawGrammar(grammar)) {
    throw new Error(`Invalid TextMate grammar for scope ${scopeName}`)
  }
  return grammar
}
