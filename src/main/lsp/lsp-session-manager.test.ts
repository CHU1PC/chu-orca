// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.
import { EventEmitter } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { pathToFileURL } from 'node:url'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { encodeLspMessage, LspMessageDecoder } from './lsp-message-framing'
import type { LspServerDescriptor } from './lsp-server-catalog'
import {
  createLspSessionManager,
  LSP_SHUTDOWN_GRACE_MS,
  LSP_TERM_GRACE_MS
} from './lsp-session-manager'

type JsonRpcMessage = {
  jsonrpc: '2.0'
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: unknown
}

/** Fake server that auto-answers `initialize` and records everything sent to it. */
function createFakeServer(serverCapabilities: Record<string, unknown> = {}) {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams & EventEmitter
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  Object.assign(child, { stdin, stdout, stderr: new PassThrough(), kill: vi.fn() })

  const received: JsonRpcMessage[] = []
  const decoder = new LspMessageDecoder()
  stdin.on('data', (chunk: Buffer) => {
    for (const message of decoder.push(chunk) as JsonRpcMessage[]) {
      received.push(message)
      if (message.method === 'initialize' && message.id !== undefined) {
        stdout.write(
          encodeLspMessage({
            jsonrpc: '2.0',
            id: message.id,
            result: { capabilities: serverCapabilities }
          })
        )
      }
    }
  })

  return {
    child,
    received,
    reply(id: number, result: unknown): void {
      stdout.write(encodeLspMessage({ jsonrpc: '2.0', id, result }))
    },
    notify(method: string, params: unknown): void {
      stdout.write(encodeLspMessage({ jsonrpc: '2.0', method, params }))
    },
    requestFromServer(id: number | string, method: string, params: unknown): void {
      stdout.write(encodeLspMessage({ jsonrpc: '2.0', id, method, params }))
    },
    async waitFor(predicate: (message: JsonRpcMessage) => boolean): Promise<JsonRpcMessage> {
      for (let attempt = 0; attempt < 200; attempt++) {
        const match = received.find(predicate)
        if (match) {
          return match
        }
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      throw new Error('fake server never received the expected message')
    }
  }
}

function createManagerWithFakeServer(serverCapabilities?: Record<string, unknown>) {
  const fake = createFakeServer(serverCapabilities)
  const spawnServer = vi.fn(() => fake.child)
  const manager = createLspSessionManager({
    spawnServer,
    probeCommand: () => Promise.resolve(true)
  })
  return { fake, manager, spawnServer }
}

function createTerminationFake(mode: 'exit-on-shutdown' | 'term-exits' | 'ignores-term') {
  const fake = createFakeServer()
  const processState = fake.child as unknown as { exitCode: number | null; signalCode: NodeJS.Signals | null }
  Object.assign(processState, { exitCode: null, signalCode: null })
  const decoder = new LspMessageDecoder()
  fake.child.stdin.on('data', (chunk: Buffer) => {
    for (const message of decoder.push(chunk) as JsonRpcMessage[]) {
      if (message.method === 'shutdown' && mode === 'exit-on-shutdown') {
        processState.exitCode = 0
        fake.child.emit('exit', 0)
      }
    }
  })
  fake.child.kill = vi.fn((signal?: NodeJS.Signals) => {
    if (signal === 'SIGTERM' && mode === 'term-exits') {
      processState.signalCode = 'SIGTERM'
      fake.child.emit('exit', null, 'SIGTERM')
    }
    return true
  })
  return fake
}

const openArgs = {
  filePath: '/workspace/repo/src/index.ts',
  rootPath: '/workspace/repo',
  languageId: 'typescript',
  text: 'const x = 1'
}

describe('createLspSessionManager', () => {
  it('returns no session when no server matches the language', async () => {
    const { manager, spawnServer } = createManagerWithFakeServer()
    const result = await manager.openDocument({ ...openArgs, languageId: 'plaintext' })
    expect(result).toEqual({
      sessions: [],
      fileUri: null
    })
    expect(spawnServer).not.toHaveBeenCalled()
  })

  it('initializes once, sends didOpen, and reuses the session per root', async () => {
    const { fake, manager, spawnServer } = createManagerWithFakeServer()
    const first = await manager.openDocument(openArgs)
    const second = await manager.openDocument({
      ...openArgs,
      filePath: '/workspace/repo/src/other.ts'
    })
    expect(first.sessions[0]?.sessionId).toBe(second.sessions[0]?.sessionId)
    expect(first.fileUri).toBe(pathToFileURL(openArgs.filePath).toString())
    expect(first.sessions[0]?.serverId).toBe('tsgo')
    expect(first.sessions[0]?.pullDiagnostics).toBe(false)
    expect(spawnServer).toHaveBeenCalledTimes(1)
    const initialize = fake.received.find((message) => message.method === 'initialize')
    const initializeParams = initialize?.params as
      | { capabilities?: { workspace?: { configuration?: boolean } } }
      | undefined
    expect(initializeParams?.capabilities?.workspace?.configuration).toBe(true)
    await fake.waitFor((m) => m.method === 'initialized')
    const didOpens = fake.received.filter((m) => m.method === 'textDocument/didOpen')
    expect(didOpens).toHaveLength(2)
  })

  it('reports pullDiagnostics when the server advertises a diagnosticProvider', async () => {
    const { manager } = createManagerWithFakeServer({ diagnosticProvider: { identifier: 'ts' } })
    const opened = await manager.openDocument(openArgs)
    expect(opened.sessions[0]?.pullDiagnostics).toBe(true)
  })

  it('answers workspace/configuration with one null per requested item', async () => {
    const { fake, manager } = createManagerWithFakeServer()
    await manager.openDocument(openArgs)
    fake.requestFromServer('cfg-1', 'workspace/configuration', {
      items: [{ section: 'a' }, { section: 'b' }]
    })
    const reply = await fake.waitFor((m) => (m.id as unknown) === 'cfg-1' && m.method === undefined)
    expect(reply.result).toEqual([null, null])
  })

  it('answers pyright configuration and all server requests', async () => {
    const fake = createFakeServer()
    const manager = createLspSessionManager({
      spawnServer: vi.fn(() => fake.child),
      probeCommand: (command) => Promise.resolve(command === 'pyright-langserver')
    })
    const opened = await manager.openDocument({
      ...openArgs,
      filePath: '/workspace/repo/src/index.py',
      languageId: 'python'
    })
    expect(opened.sessions).toHaveLength(1)
    fake.requestFromServer('cfg-python', 'workspace/configuration', {
      items: [{ section: 'python' }, { section: 'pyright' }, { section: 'unknown' }]
    })
    const configuration = await fake.waitFor(
      (m) => (m.id as unknown) === 'cfg-python' && m.method === undefined
    )
    expect(configuration.result).toEqual([null, null, null])
    fake.requestFromServer('register', 'client/registerCapability', { registrations: [] })
    expect(
      (await fake.waitFor((m) => (m.id as unknown) === 'register' && m.method === undefined)).result
    ).toBeNull()
    fake.requestFromServer('unknown', 'server/unknown', {})
    const unknown = await fake.waitFor(
      (m) => (m.id as unknown) === 'unknown' && m.method === undefined
    )
    expect(unknown.error).toEqual({ code: -32601, message: 'Method not found: server/unknown' })
  })

  it('returns the discovered venv interpreter to pyright', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-lsp-python-'))
    const bin = join(root, '.venv', 'bin')
    mkdirSync(bin, { recursive: true })
    for (const name of ['pyright-langserver', 'python']) {
      const path = join(bin, name)
      writeFileSync(path, '')
      chmodSync(path, 0o755)
    }
    const fake = createFakeServer()
    const trustedRootsFilePath = join(root, 'trusted-roots.json')
    writeFileSync(trustedRootsFilePath, JSON.stringify({ trustedRoots: [root] }))
    const manager = createLspSessionManager({
      spawnServer: vi.fn(() => fake.child),
      probeCommand: () => Promise.resolve(false),
      trustedRootsFilePath
    })
    await manager.openDocument({
      filePath: join(root, 'main.py'),
      rootPath: root,
      languageId: 'python',
      text: 'x = 1'
    })
    fake.requestFromServer('cfg-venv', 'workspace/configuration', {
      items: [{ section: 'python' }, { section: 'pyright' }]
    })
    const configuration = await fake.waitFor(
      (m) => (m.id as unknown) === 'cfg-venv' && m.method === undefined
    )
    expect(configuration.result).toEqual([
      { pythonPath: join(root, '.venv', 'bin', 'python') },
      null
    ])
  })

  it('routes requests and resolves with the server result', async () => {
    const { fake, manager } = createManagerWithFakeServer()
    const opened = await manager.openDocument(openArgs)
    const pending = manager.request(opened.sessions[0]!.sessionId, 'textDocument/hover', {
      position: {}
    })
    const hoverRequest = await fake.waitFor((m) => m.method === 'textDocument/hover')
    fake.reply(hoverRequest.id!, { contents: 'docs' })
    await expect(pending).resolves.toEqual({ contents: 'docs' })
  })

  it('forwards publishDiagnostics for open documents only', async () => {
    const { fake, manager } = createManagerWithFakeServer()
    const diagnostics = vi.fn()
    manager.onDiagnostics(diagnostics)
    const opened = await manager.openDocument(openArgs)
    const { sessionId, fileUri } = opened.sessions[0]!
    fake.notify('textDocument/publishDiagnostics', {
      uri: fileUri,
      diagnostics: [{ message: 'boom' }]
    })
    fake.notify('textDocument/publishDiagnostics', {
      uri: 'file:///workspace/repo/never-opened.ts',
      diagnostics: [{ message: 'ignored' }]
    })
    await vi.waitFor(() => expect(diagnostics).toHaveBeenCalledTimes(1))
    expect(diagnostics).toHaveBeenCalledWith({
      sessionId,
      fileUri,
      serverId: 'tsgo',
      diagnostics: [{ message: 'boom' }]
    })
  })

  it('sends didChange with growing versions and didClose only at refcount zero', async () => {
    const { fake, manager } = createManagerWithFakeServer()
    const opened = await manager.openDocument(openArgs)
    const { sessionId, fileUri } = opened.sessions[0]!
    // Why: a repeat open re-syncs text (last writer wins), producing version 2.
    await manager.openDocument({ ...openArgs, text: 'const x = 1.5' })
    manager.changeDocument(sessionId!, fileUri!, 'const x = 2')
    manager.closeDocument(sessionId!, fileUri!)
    manager.changeDocument(sessionId!, fileUri!, 'const x = 3')
    manager.closeDocument(sessionId!, fileUri!)
    await fake.waitFor((m) => m.method === 'textDocument/didClose')
    const changes = fake.received.filter((m) => m.method === 'textDocument/didChange')
    expect(
      changes.map((m) => (m.params as { textDocument: { version: number } }).textDocument.version)
    ).toEqual([2, 3, 4])
    expect(fake.received.filter((m) => m.method === 'textDocument/didClose')).toHaveLength(1)
  })

  it('forwards publishDiagnostics whose URI encodes the path differently', async () => {
    const { fake, manager } = createManagerWithFakeServer()
    const diagnostics = vi.fn()
    manager.onDiagnostics(diagnostics)
    const opened = await manager.openDocument(openArgs)
    const { sessionId, fileUri } = opened.sessions[0]!
    // Why: vscode-uri-based servers percent-encode where pathToFileURL does not.
    fake.notify('textDocument/publishDiagnostics', {
      uri: fileUri!.replace('index.ts', 'index%2Ets'),
      diagnostics: [{ message: 'boom' }]
    })
    await vi.waitFor(() => expect(diagnostics).toHaveBeenCalledTimes(1))
    expect(diagnostics).toHaveBeenCalledWith({
      sessionId,
      fileUri,
      serverId: 'tsgo',
      diagnostics: [{ message: 'boom' }]
    })
  })

  it('announces .tsx documents as typescriptreact in didOpen', async () => {
    const { fake, manager } = createManagerWithFakeServer()
    await manager.openDocument({ ...openArgs, filePath: '/workspace/repo/src/App.tsx' })
    const didOpen = await fake.waitFor((m) => m.method === 'textDocument/didOpen')
    expect(
      (didOpen.params as { textDocument: { languageId: string } }).textDocument.languageId
    ).toBe('typescriptreact')
  })

  it('rejects in-flight requests when the server exits', async () => {
    const { fake, manager } = createManagerWithFakeServer()
    const opened = await manager.openDocument(openArgs)
    const pending = manager.request(opened.sessions[0]!.sessionId, 'textDocument/definition', {})
    await fake.waitFor((m) => m.method === 'textDocument/definition')
    fake.child.emit('exit', 1)
    await expect(pending).rejects.toThrow('LSP server exited')
    await expect(manager.request(opened.sessions[0]!.sessionId, 'textDocument/hover', {})).rejects.toThrow(
      'Unknown LSP session'
    )
  })

  it('kills every child on disposeAll', async () => {
    vi.useFakeTimers()
    const { fake, manager } = createManagerWithFakeServer()
    try {
      await manager.openDocument(openArgs)
      manager.disposeAll()
      expect(fake.child.kill).not.toHaveBeenCalled()
      expect(fake.received.some((message) => message.method === 'shutdown')).toBe(true)
      vi.advanceTimersByTime(LSP_SHUTDOWN_GRACE_MS + LSP_TERM_GRACE_MS)
      expect(fake.child.kill).toHaveBeenCalledWith('SIGTERM')
      vi.advanceTimersByTime(LSP_TERM_GRACE_MS)
      expect(fake.child.kill).toHaveBeenCalledWith('SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses resolved commands in the session key when roots have different venvs', async () => {
    const rootA = mkdtempSync(join(tmpdir(), 'orca-lsp-root-a-'))
    const rootB = mkdtempSync(join(tmpdir(), 'orca-lsp-root-b-'))
    for (const root of [rootA, rootB]) {
      const bin = join(root, '.venv', 'bin')
      mkdirSync(bin, { recursive: true })
      const pyright = join(bin, 'pyright-langserver')
      writeFileSync(pyright, '')
      chmodSync(pyright, 0o755)
      const python = join(bin, 'python')
      writeFileSync(python, '')
      chmodSync(python, 0o755)
    }
    const fake = createFakeServer()
    const descriptors: LspServerDescriptor[] = []
    const trustedRootsFilePath = join(rootA, 'trusted-roots.json')
    writeFileSync(trustedRootsFilePath, JSON.stringify({ trustedRoots: [rootA, rootB] }))
    const manager = createLspSessionManager({
      spawnServer: vi.fn((descriptor) => {
        descriptors.push(descriptor)
        return fake.child
      }),
      probeCommand: () => Promise.resolve(false),
      trustedRootsFilePath
    })
    const first = await manager.openDocument({
      filePath: join(rootA, 'bad.py'),
      rootPath: rootA,
      languageId: 'python',
      text: 'x = 1'
    })
    const second = await manager.openDocument({
      filePath: join(rootB, 'bad.py'),
      rootPath: rootB,
      languageId: 'python',
      text: 'x = 1'
    })
    expect(first.sessions[0]?.sessionId).not.toBe(second.sessions[0]?.sessionId)
    expect(descriptors[0]?.resolvedCommand).not.toBe(descriptors[1]?.resolvedCommand)
  })

  it('does not escalate when shutdown causes a prompt child exit', async () => {
    vi.useFakeTimers()
    try {
      const fake = createTerminationFake('exit-on-shutdown')
      const manager = createLspSessionManager({
        spawnServer: vi.fn(() => fake.child),
        probeCommand: () => Promise.resolve(true)
      })
      await manager.openDocument(openArgs)
      manager.disposeAll()
      vi.advanceTimersByTime(LSP_SHUTDOWN_GRACE_MS + LSP_TERM_GRACE_MS * 2)
      expect(fake.child.kill).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('escalates to SIGTERM but not SIGKILL when SIGTERM exits the child', async () => {
    vi.useFakeTimers()
    try {
      const fake = createTerminationFake('term-exits')
      const manager = createLspSessionManager({
        spawnServer: vi.fn(() => fake.child),
        probeCommand: () => Promise.resolve(true)
      })
      await manager.openDocument(openArgs)
      manager.disposeAll()
      vi.advanceTimersByTime(LSP_SHUTDOWN_GRACE_MS + LSP_TERM_GRACE_MS)
      expect(fake.child.kill).toHaveBeenCalledWith('SIGTERM')
      vi.advanceTimersByTime(LSP_TERM_GRACE_MS)
      expect(fake.child.kill).not.toHaveBeenCalledWith('SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    vi.useFakeTimers()
    try {
      const fake = createTerminationFake('ignores-term')
      const manager = createLspSessionManager({
        spawnServer: vi.fn(() => fake.child),
        probeCommand: () => Promise.resolve(true)
      })
      await manager.openDocument(openArgs)
      manager.disposeAll()
      vi.advanceTimersByTime(LSP_SHUTDOWN_GRACE_MS + LSP_TERM_GRACE_MS)
      expect(fake.child.kill).toHaveBeenCalledWith('SIGTERM')
      vi.advanceTimersByTime(LSP_TERM_GRACE_MS)
      expect(fake.child.kill).toHaveBeenCalledWith('SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })
})
