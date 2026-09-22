// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.
import {
  spawnProcess,
  type ChildProcessWithoutNullStreams
} from '../../shared/child-process/run-process'
import { resolveWindowsCommand } from '../win32-utils'
import type { LspServerDescriptor } from './lsp-server-catalog'

export type SpawnLspServer = (
  descriptor: LspServerDescriptor,
  rootPath: string
) => ChildProcessWithoutNullStreams

export const spawnLspServer: SpawnLspServer = (descriptor, rootPath) => {
  const command = resolveWindowsCommand(descriptor.resolvedCommand ?? descriptor.command)
  const child = spawnProcess({
    program: command,
    args: descriptor.args,
    cwd: rootPath,
    stdio: ['pipe', 'pipe', 'pipe'],
    // Why: hydrateShellPath already merged the login-shell PATH into process.env.
    env: process.env
  })
  // Why: nothing reads stderr; an undrained pipe blocks the server once the OS
  // buffer fills (rust-analyzer and gopls log there routinely).
  child.stderr.resume()
  return child
}
