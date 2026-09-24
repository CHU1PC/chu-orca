export type SemanticTokenScopeDefault = {
  type: string
  modifiers: string[]
  scopes: readonly (readonly string[])[]
}

// VS Code main at 2026-09-24 (ad77169b64ccc8c9b2401b67f29d99efd487e3c0), lines 545–597.
export const SEMANTIC_TOKEN_SCOPE_DEFAULTS: readonly SemanticTokenScopeDefault[] = [
  { type: 'comment', modifiers: [], scopes: [['comment']] },
  { type: 'string', modifiers: [], scopes: [['string']] },
  { type: 'keyword', modifiers: [], scopes: [['keyword.control']] },
  { type: 'number', modifiers: [], scopes: [['constant.numeric']] },
  { type: 'regexp', modifiers: [], scopes: [['constant.regexp']] },
  { type: 'operator', modifiers: [], scopes: [['keyword.operator']] },
  { type: 'namespace', modifiers: [], scopes: [['entity.name.namespace']] },
  { type: 'type', modifiers: [], scopes: [['entity.name.type'], ['support.type']] },
  { type: 'struct', modifiers: [], scopes: [['entity.name.type.struct']] },
  { type: 'class', modifiers: [], scopes: [['entity.name.type.class'], ['support.class']] },
  { type: 'interface', modifiers: [], scopes: [['entity.name.type.interface']] },
  { type: 'enum', modifiers: [], scopes: [['entity.name.type.enum']] },
  { type: 'typeParameter', modifiers: [], scopes: [['entity.name.type.parameter']] },
  { type: 'function', modifiers: [], scopes: [['entity.name.function'], ['support.function']] },
  { type: 'member', modifiers: [], scopes: [] },
  {
    type: 'method',
    modifiers: [],
    scopes: [['entity.name.function.member'], ['support.function']]
  },
  { type: 'macro', modifiers: [], scopes: [['entity.name.function.preprocessor']] },
  {
    type: 'variable',
    modifiers: [],
    scopes: [['variable.other.readwrite'], ['entity.name.variable']]
  },
  { type: 'parameter', modifiers: [], scopes: [['variable.parameter']] },
  { type: 'property', modifiers: [], scopes: [['variable.other.property']] },
  { type: 'enumMember', modifiers: [], scopes: [['variable.other.enummember']] },
  { type: 'event', modifiers: [], scopes: [['variable.other.event']] },
  {
    type: 'decorator',
    modifiers: [],
    scopes: [['entity.name.decorator'], ['entity.name.function']]
  },
  { type: 'label', modifiers: [], scopes: [] },
  { type: 'variable', modifiers: ['readonly'], scopes: [['variable.other.constant']] },
  { type: 'property', modifiers: ['readonly'], scopes: [['variable.other.constant.property']] },
  { type: 'type', modifiers: ['defaultLibrary'], scopes: [['support.type']] },
  { type: 'class', modifiers: ['defaultLibrary'], scopes: [['support.class']] },
  { type: 'interface', modifiers: ['defaultLibrary'], scopes: [['support.class']] },
  {
    type: 'variable',
    modifiers: ['defaultLibrary'],
    scopes: [['support.variable'], ['support.other.variable']]
  },
  {
    type: 'variable',
    modifiers: ['defaultLibrary', 'readonly'],
    scopes: [['support.constant']]
  },
  { type: 'property', modifiers: ['defaultLibrary'], scopes: [['support.variable.property']] },
  {
    type: 'property',
    modifiers: ['defaultLibrary', 'readonly'],
    scopes: [['support.constant.property']]
  },
  { type: 'function', modifiers: ['defaultLibrary'], scopes: [['support.function']] },
  { type: 'member', modifiers: ['defaultLibrary'], scopes: [['support.function']] }
]
