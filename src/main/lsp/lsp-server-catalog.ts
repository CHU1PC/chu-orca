// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { isCommandOnLocalPath } from '../ipc/command-path-resolver'
import {
  getProjectToolsSkippedReason as getSkippedReason,
  isExecutableFile,
  isSafeProjectCommand,
  isSafeVenvDirectory,
  isTrustedWorkspaceRoot,
  projectCommandCandidates,
  type LspResolutionOptions
} from './lsp-trusted-roots'

export type { LspResolutionOptions } from './lsp-trusted-roots'

export type LspServerRole = 'primary' | 'diagnostics-only'

export type LspServerDescriptor = {
  serverId: string
  command: string
  args: readonly string[]
  role?: LspServerRole
  resolvedCommand?: string
  pythonPath?: string
  source?: 'project' | 'PATH'
  projectToolsSkippedReason?: string
}

type LspServerCatalogEntry = {
  languages: readonly string[]
  /** Tried in order; the first available primary command wins. */
  candidates: readonly LspServerDescriptor[]
  /** Every available descriptor is started for diagnostics only. */
  additionalServers?: readonly LspServerDescriptor[]
  localCommandDirectory?: 'python-venv' | 'node-modules' | 'path-only'
}

/** Servers Orca knows how to drive. Nothing is bundled. */
export const LSP_SERVER_CATALOG: readonly LspServerCatalogEntry[] = [
  {
    languages: ['typescript', 'javascript'],
    candidates: [
      // Why: tsgo is the fast path and the only server that works in tsserver-less TS7 repos.
      { serverId: 'tsgo', command: 'tsgo', args: ['--lsp', '--stdio'] },
      {
        serverId: 'typescript-language-server',
        command: 'typescript-language-server',
        args: ['--stdio']
      }
    ],
    localCommandDirectory: 'node-modules'
  },
  {
    languages: ['python'],
    candidates: [{ serverId: 'pyright', command: 'pyright-langserver', args: ['--stdio'] }],
    additionalServers: [{ serverId: 'ruff', command: 'ruff', args: ['server'] }],
    localCommandDirectory: 'python-venv'
  },
  { languages: ['go'], candidates: [{ serverId: 'gopls', command: 'gopls', args: [] }] },
  {
    languages: ['rust'],
    candidates: [{ serverId: 'rust-analyzer', command: 'rust-analyzer', args: [] }]
  }
]

type CommandProbe = (command: string) => Promise<boolean>
type ResolvedCommand = {
  command: string
  pythonPath?: string
  source: 'project' | 'PATH'
  projectToolsSkippedReason?: string
}

// PATH probing hits the filesystem; editors re-open files constantly, so
// remember each verdict for the app lifetime. Project-local probes stay uncached.
const availabilityByCommand = new Map<string, Promise<boolean>>()

function isServerCommandAvailable(command: string, probe: CommandProbe): Promise<boolean> {
  let availability = availabilityByCommand.get(command)
  if (!availability) {
    availability = probe(command).catch(() => false)
    availabilityByCommand.set(command, availability)
  }
  return availability
}

function localCommandPath(
  filePath: string,
  rootPath: string,
  command: string,
  localCommandDirectory: LspServerCatalogEntry['localCommandDirectory']
): ResolvedCommand | null {
  if (!localCommandDirectory || localCommandDirectory === 'path-only') {
    return null
  }
  const fileDirectory = resolve(dirname(filePath))
  const workspaceRoot = resolve(rootPath)
  let current = fileDirectory
  while (true) {
    const relativeToRoot = relative(workspaceRoot, current)
    if (relativeToRoot.startsWith('..') || isAbsolute(relativeToRoot)) {
      return null
    }
    const base =
      localCommandDirectory === 'python-venv'
        ? join(current, '.venv')
        : join(current, 'node_modules')
    const commandPath =
      localCommandDirectory === 'python-venv'
        ? join(base, 'bin', command)
        : join(base, '.bin', command)
    if (
      isExecutableFile(commandPath) &&
      isSafeProjectCommand(commandPath, rootPath, localCommandDirectory)
    ) {
      return localCommandDirectory === 'python-venv'
        ? {
            command: commandPath,
            pythonPath: join(base, 'bin', 'python'),
            source: 'project'
          }
        : { command: commandPath, source: 'project' }
    }
    if (current === workspaceRoot) {
      return null
    }
    const parent = dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

function localPythonPath(filePath: string, rootPath: string): string | null {
  const fileDirectory = resolve(dirname(filePath))
  const workspaceRoot = resolve(rootPath)
  let current = fileDirectory
  while (true) {
    const relativeToRoot = relative(workspaceRoot, current)
    if (relativeToRoot.startsWith('..') || isAbsolute(relativeToRoot)) {
      return null
    }
    const pythonPath = join(current, '.venv', 'bin', 'python')
    if (isExecutableFile(pythonPath) && isSafeVenvDirectory(join(current, '.venv'), rootPath)) {
      return pythonPath
    }
    if (current === workspaceRoot) {
      return null
    }
    const parent = dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

function pathCommandPath(command: string): string | null {
  if (isAbsolute(command)) {
    return isExecutableFile(command) ? command : null
  }
  const pathValue = process.env.PATH ?? ''
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    const candidate = resolve(directory, command)
    if (isExecutableFile(candidate)) {
      return candidate
    }
  }
  return null
}

async function resolveDescriptor(
  descriptor: LspServerDescriptor,
  entry: LspServerCatalogEntry,
  filePath: string,
  rootPath: string,
  probe: CommandProbe,
  trustedRoot: boolean
): Promise<ResolvedCommand | null> {
  const candidates = projectCommandCandidates(
    filePath,
    rootPath,
    descriptor.command,
    entry.localCommandDirectory
  )
  if (trustedRoot) {
    const local = localCommandPath(
      filePath,
      rootPath,
      descriptor.command,
      entry.localCommandDirectory
    )
    if (local) {
      return local
    }
  }
  const skippedReason =
    !trustedRoot && candidates.some((candidate) => isExecutableFile(candidate))
      ? 'project tools skipped: root not in trusted-roots.json'
      : undefined
  // Why: project tools are never probed or resolved for an untrusted root.
  if (!(await isServerCommandAvailable(descriptor.command, probe))) {
    return null
  }
  return {
    command: pathCommandPath(descriptor.command) ?? descriptor.command,
    source: 'PATH',
    ...(trustedRoot && entry.localCommandDirectory === 'python-venv'
      ? { pythonPath: localPythonPath(filePath, rootPath) ?? undefined }
      : {}),
    ...(skippedReason ? { projectToolsSkippedReason: skippedReason } : {})
  }
}

function materializeDescriptor(
  descriptor: LspServerDescriptor,
  role: LspServerRole,
  resolved: ResolvedCommand
): LspServerDescriptor {
  return {
    ...descriptor,
    role,
    resolvedCommand: resolved.command,
    pythonPath: resolved.pythonPath,
    source: resolved.source,
    projectToolsSkippedReason: resolved.projectToolsSkippedReason
  }
}

export async function resolveLspServersForLanguage(
  languageId: string,
  filePath: string,
  rootPath: string,
  probe: CommandProbe = isCommandOnLocalPath,
  options?: LspResolutionOptions
): Promise<LspServerDescriptor[]> {
  const entry = LSP_SERVER_CATALOG.find((candidate) => candidate.languages.includes(languageId))
  if (!entry) {
    return []
  }
  const trustedRoot = isTrustedWorkspaceRoot(rootPath, options)
  let primaryDescriptor: LspServerDescriptor | null = null
  for (const candidate of entry.candidates) {
    const resolved = await resolveDescriptor(
      candidate,
      entry,
      filePath,
      rootPath,
      probe,
      trustedRoot
    )
    if (resolved) {
      primaryDescriptor = materializeDescriptor(candidate, 'primary', resolved)
      break
    }
  }
  const resolvedServers: LspServerDescriptor[] = primaryDescriptor ? [primaryDescriptor] : []
  for (const candidate of entry.additionalServers ?? []) {
    const resolved = await resolveDescriptor(
      candidate,
      entry,
      filePath,
      rootPath,
      probe,
      trustedRoot
    )
    if (resolved) {
      resolvedServers.push(materializeDescriptor(candidate, 'diagnostics-only', resolved))
    }
  }
  return resolvedServers
}

/** Backwards-compatible primary-only lookup for callers that need one server. */
export async function resolveLspServerForLanguage(
  languageId: string,
  filePath = '/',
  rootPath = '/',
  probe: CommandProbe = isCommandOnLocalPath,
  options?: LspResolutionOptions
): Promise<LspServerDescriptor | null> {
  return (
    (await resolveLspServersForLanguage(languageId, filePath, rootPath, probe, options)).find(
      (server) => server.role === 'primary'
    ) ?? null
  )
}

export function resetLspServerAvailabilityForTests(): void {
  availabilityByCommand.clear()
}

export function getProjectToolsSkippedReason(
  languageId: string,
  filePath: string,
  rootPath: string,
  options?: LspResolutionOptions
): string | undefined {
  const entry = LSP_SERVER_CATALOG.find((candidate) => candidate.languages.includes(languageId))
  if (!entry) {
    return undefined
  }
  return getSkippedReason(
    filePath,
    rootPath,
    entry.localCommandDirectory,
    [...entry.candidates, ...(entry.additionalServers ?? [])].map(
      (descriptor) => descriptor.command
    ),
    options
  )
}

/** Monaco has no react language ids (.tsx shares 'typescript'). */
export function toLspDocumentLanguageId(languageId: string, filePath: string): string {
  if (languageId === 'typescript' && /\.tsx$/i.test(filePath)) {
    return 'typescriptreact'
  }
  if (languageId === 'javascript' && /\.jsx$/i.test(filePath)) {
    return 'javascriptreact'
  }
  return languageId
}
