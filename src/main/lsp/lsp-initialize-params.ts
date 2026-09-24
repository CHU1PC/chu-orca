// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Client capabilities for Orca's LSP bridge, including semantic tokens and document links. */
export function buildLspInitializeParams(rootPath: string): object {
  const rootUri = pathToFileURL(rootPath).toString()
  return {
    processId: process.pid,
    rootUri,
    workspaceFolders: [{ uri: rootUri, name: basename(rootPath) }],
    capabilities: {
      textDocument: {
        hover: { contentFormat: ['markdown', 'plaintext'] },
        definition: {},
        references: {},
        completion: {
          completionItem: { snippetSupport: false, documentationFormat: ['markdown', 'plaintext'] }
        },
        semanticTokens: {
          requests: { full: true, range: false },
          tokenTypes: [
            'namespace',
            'type',
            'class',
            'enum',
            'interface',
            'struct',
            'typeParameter',
            'parameter',
            'variable',
            'property',
            'enumMember',
            'event',
            'function',
            'method',
            'macro',
            'keyword',
            'modifier',
            'comment',
            'string',
            'number',
            'regexp',
            'operator',
            'decorator'
          ],
          tokenModifiers: [
            'declaration',
            'definition',
            'readonly',
            'static',
            'deprecated',
            'abstract',
            'async',
            'modification',
            'documentation',
            'defaultLibrary'
          ],
          formats: ['relative'],
          overlappingTokenSupport: false,
          multilineTokenSupport: false
        },
        documentLink: { tooltipSupport: true },
        publishDiagnostics: {},
        diagnostic: {},
        synchronization: { didSave: false }
      },
      workspace: {
        workspaceFolders: true,
        configuration: true
      }
    }
  }
}
