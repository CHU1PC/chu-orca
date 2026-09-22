import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

const { resolveWindowsCommandMock, spawnProcessMock } = vi.hoisted(() => ({
  resolveWindowsCommandMock: vi.fn(),
  spawnProcessMock: vi.fn()
}))

vi.mock('../../shared/child-process/run-process', () => ({
  spawnProcess: spawnProcessMock
}))
vi.mock('../win32-utils', () => ({ resolveWindowsCommand: resolveWindowsCommandMock }))

import { spawnLspServer } from './lsp-server-spawn'

describe('spawnLspServer', () => {
  it('uses the shared spawn boundary with the resolved command and LSP pipes', () => {
    const stderr = new PassThrough()
    const child = { stderr }
    resolveWindowsCommandMock.mockReturnValue('/bin/example-lsp')
    spawnProcessMock.mockReturnValue(child)

    const descriptor = {
      serverId: 'example',
      command: 'example-lsp',
      resolvedCommand: 'example-lsp-from-path',
      args: ['--stdio']
    }
    const result = spawnLspServer(descriptor, '/workspace')

    expect(resolveWindowsCommandMock).toHaveBeenCalledWith('example-lsp-from-path')
    expect(spawnProcessMock).toHaveBeenCalledWith({
      program: '/bin/example-lsp',
      args: ['--stdio'],
      cwd: '/workspace',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    })
    expect(result).toBe(child)
    expect(stderr.readableFlowing).toBe(true)
  })
})
