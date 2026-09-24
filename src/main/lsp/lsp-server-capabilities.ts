import type { LspSessionInfo } from '../../shared/lsp-types'

export type ParsedLspServerCapabilities = Pick<
  LspSessionInfo,
  'pullDiagnostics' | 'semanticTokensLegend' | 'documentLinks'
>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string')
    ? value
    : undefined
}

function readSemanticTokensLegend(provider: unknown): LspSessionInfo['semanticTokensLegend'] {
  if (!isRecord(provider) || !(provider.full === true || isRecord(provider.full))) {
    return undefined
  }
  if (!isRecord(provider.legend)) {
    return undefined
  }
  const tokenTypes = readStringArray(provider.legend.tokenTypes)
  const tokenModifiers = readStringArray(provider.legend.tokenModifiers)
  return tokenTypes && tokenModifiers ? { tokenTypes, tokenModifiers } : undefined
}

function readDocumentLinks(provider: unknown): LspSessionInfo['documentLinks'] {
  return isRecord(provider) ? { resolveProvider: provider.resolveProvider === true } : undefined
}

export function parseLspServerCapabilities(result: unknown): ParsedLspServerCapabilities {
  const capabilities =
    isRecord(result) && isRecord(result.capabilities) ? result.capabilities : undefined
  const semanticTokensLegend = readSemanticTokensLegend(capabilities?.semanticTokensProvider)
  const documentLinks = readDocumentLinks(capabilities?.documentLinkProvider)
  return {
    pullDiagnostics: Boolean(capabilities?.diagnosticProvider),
    ...(semanticTokensLegend ? { semanticTokensLegend } : {}),
    ...(documentLinks ? { documentLinks } : {})
  }
}
