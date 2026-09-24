import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildLspInitializeParams } from './lsp-initialize-params'

describe('buildLspInitializeParams', () => {
  it('advertises workspace, synchronization, diagnostics, semantic tokens, and document links', () => {
    const params = buildLspInitializeParams('/workspace/project')

    expect(params).toMatchObject({
      processId: process.pid,
      rootUri: 'file:///workspace/project',
      workspaceFolders: [
        { uri: 'file:///workspace/project', name: basename('/workspace/project') }
      ],
      capabilities: {
        workspace: { workspaceFolders: true, configuration: true },
        textDocument: {
          publishDiagnostics: {},
          diagnostic: {},
          synchronization: { didSave: false },
          semanticTokens: {
            requests: { full: true, range: false },
            formats: ['relative'],
            overlappingTokenSupport: false,
            multilineTokenSupport: false
          },
          documentLink: { tooltipSupport: true }
        }
      }
    })
    expect(params).not.toHaveProperty('capabilities.workspace.semanticTokens.refreshSupport')
  })
})
