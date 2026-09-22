import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence'

type IpcHandler = (...args: unknown[]) => unknown

const {
  appOnMock,
  createManagerMock,
  diagnosticsRendererMock,
  handlers,
  ipcHandleMock,
  isTrustedUIRendererMock,
  manager,
  resolveAuthorizedPathMock,
  browserWindowGetAllMock
} = vi.hoisted(() => {
  const handlerMap = new Map<string, IpcHandler>()
  const managerValue = {
    changeDocument: vi.fn(),
    closeDocument: vi.fn(),
    disposeAll: vi.fn(),
    onDiagnostics: vi.fn(),
    openDocument: vi.fn(),
    request: vi.fn()
  }
  return {
    appOnMock: vi.fn(),
    createManagerMock: vi.fn(() => managerValue),
    diagnosticsRendererMock: vi.fn(),
    handlers: handlerMap,
    ipcHandleMock: vi.fn((channel: string, handler: IpcHandler) =>
      handlerMap.set(channel, handler)
    ),
    isTrustedUIRendererMock: vi.fn<(sender: unknown) => boolean>(() => false),
    manager: managerValue,
    resolveAuthorizedPathMock: vi.fn(async (path: string) => path),
    browserWindowGetAllMock: vi.fn<() => unknown[]>(() => [])
  }
})

vi.mock('electron', () => ({
  app: { on: appOnMock },
  BrowserWindow: { getAllWindows: browserWindowGetAllMock },
  ipcMain: { handle: ipcHandleMock }
}))
vi.mock('../lsp/lsp-session-manager', () => ({ createLspSessionManager: createManagerMock }))
vi.mock('./filesystem-auth', () => ({ resolveAuthorizedPath: resolveAuthorizedPathMock }))
vi.mock('./ui', () => ({ isTrustedUIRenderer: isTrustedUIRendererMock }))

import { registerLspHandlers } from './lsp'

type Sender = EventEmitter & {
  id: number
  mainFrame: object
  isDestroyed: () => boolean
  getType: () => string
  getURL: () => string
  send: ReturnType<typeof vi.fn>
}

function createSender(id: number): Sender {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the EventEmitter is populated with every WebContents member used by the IPC handlers and trusted-renderer predicate.
  const sender = new EventEmitter() as Sender
  Object.assign(sender, {
    id,
    mainFrame: {},
    isDestroyed: () => false,
    getType: () => 'window',
    getURL: () => 'http://localhost',
    send: vi.fn()
  })
  return sender
}

function eventFor(
  sender: Sender,
  senderFrame = sender.mainFrame
): { sender: Sender; senderFrame: object } {
  return { sender, senderFrame }
}

function handler(channel: string): IpcHandler {
  const registered = handlers.get(channel)
  if (!registered) {
    throw new Error(`Missing handler: ${channel}`)
  }
  return registered
}

const openArgs = {
  filePath: '/workspace/project/example.ts',
  rootPath: '/workspace/project',
  languageId: 'typescript',
  text: 'const value = 1'
}
const openResult = {
  sessions: [
    {
      sessionId: 'session-1',
      fileUri: 'file:///workspace/project/example.ts',
      serverId: 'example',
      resolvedCommand: '/bin/example',
      source: 'PATH' as const,
      isPrimary: true,
      pullDiagnostics: false
    }
  ],
  fileUri: 'file:///workspace/project/example.ts'
}

beforeEach(() => {
  handlers.clear()
  vi.clearAllMocks()
  manager.onDiagnostics.mockImplementation((listener: (payload: unknown) => void) => {
    diagnosticsRendererMock.mockImplementation(listener)
    return vi.fn()
  })
  manager.openDocument.mockResolvedValue(openResult)
  manager.request.mockResolvedValue({ result: 'ok' })
  resolveAuthorizedPathMock.mockImplementation(async (path: string) => path)
  browserWindowGetAllMock.mockReturnValue([])
  isTrustedUIRendererMock.mockReturnValue(false)
})

describe('registerLspHandlers', () => {
  it('rejects subframe calls for all four handlers', async () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler test only needs the Store parameter, which is not read because path authorization is mocked.
    registerLspHandlers({} as Store)
    const sender = createSender(1)
    const subframe = {}
    const event = eventFor(sender, subframe)

    await expect(handler('lsp:openDocument')(event, openArgs)).rejects.toThrow(
      'LSP document open must originate from the current main frame'
    )
    expect(() =>
      handler('lsp:changeDocument')(event, {
        sessionId: 'session-1',
        fileUri: openResult.fileUri,
        text: 'next'
      })
    ).toThrow('LSP document change must originate from the current main frame')
    expect(() =>
      handler('lsp:closeDocument')(event, {
        sessionId: 'session-1',
        fileUri: openResult.fileUri
      })
    ).toThrow('LSP document close must originate from the current main frame')
    expect(() =>
      handler('lsp:request')(event, {
        sessionId: 'session-1',
        method: 'textDocument/hover',
        params: {}
      })
    ).toThrow('LSP request must originate from the current main frame')
  })

  it('broadcasts diagnostics only to trusted UI renderers', () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler test only needs the Store parameter, which is not read by the mocked manager.
    registerLspHandlers({} as Store)
    const trusted = createSender(1)
    const untrusted = createSender(2)
    browserWindowGetAllMock.mockReturnValue([{ webContents: trusted }, { webContents: untrusted }])
    isTrustedUIRendererMock.mockImplementation((sender: unknown) => sender === trusted)
    const diagnostics = {
      sessionId: 'session-1',
      fileUri: openResult.fileUri,
      serverId: 'example',
      diagnostics: []
    }

    diagnosticsRendererMock(diagnostics)

    expect(trusted.send).toHaveBeenCalledWith('lsp:diagnostics', diagnostics)
    expect(untrusted.send).not.toHaveBeenCalled()
    expect(isTrustedUIRendererMock).toHaveBeenCalledTimes(2)
  })

  it('closes every document when its renderer process is gone and ignores a second lifecycle event', async () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler test only needs the Store parameter, which is not read by the mocked manager.
    registerLspHandlers({} as Store)
    const sender = createSender(3)
    await handler('lsp:openDocument')(eventFor(sender), openArgs)

    sender.emit('render-process-gone')
    sender.emit('destroyed')

    expect(manager.closeDocument).toHaveBeenCalledTimes(1)
    expect(manager.closeDocument).toHaveBeenCalledWith('session-1', openResult.fileUri)
  })

  it('removes normal closes from lifecycle tracking', async () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler test only needs the Store parameter, which is not read by the mocked manager.
    registerLspHandlers({} as Store)
    const sender = createSender(4)
    await handler('lsp:openDocument')(eventFor(sender), openArgs)

    handler('lsp:closeDocument')(eventFor(sender), {
      sessionId: 'session-1',
      fileUri: openResult.fileUri
    })
    sender.emit('destroyed')

    expect(manager.closeDocument).toHaveBeenCalledTimes(1)
  })
})
