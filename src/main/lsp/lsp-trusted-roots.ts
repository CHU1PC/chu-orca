import { accessSync, constants as fsConstants, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

export type LocalCommandDirectory = 'python-venv' | 'node-modules' | 'path-only'
export type LspResolutionOptions = { trustedRootsFilePath?: string }

const DEFAULT_TRUSTED_ROOTS_FILE = join(
  homedir(),
  '.config',
  'orca-patched',
  'trusted-roots.json'
)

export function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false
    }
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

function isPathInsideOrEqual(path: string, rootPath: string): boolean {
  const relativePath = relative(rootPath, path)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function loadTrustedRoots(filePath: string): string[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as { trustedRoots?: unknown }).trustedRoots)
    ) {
      return []
    }
    const entries = (parsed as { trustedRoots: unknown[] }).trustedRoots
    return entries.flatMap((entry) => {
      try {
        if (typeof entry !== 'string' || !isAbsolute(entry)) {
          return []
        }
        const realRoot = realpathSync(entry)
        return statSync(realRoot).isDirectory() ? [realRoot] : []
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

export function isTrustedWorkspaceRoot(rootPath: string, options?: LspResolutionOptions): boolean {
  try {
    const realRoot = realpathSync(rootPath)
    return loadTrustedRoots(options?.trustedRootsFilePath ?? DEFAULT_TRUSTED_ROOTS_FILE).some(
      (trustedRoot) => isPathInsideOrEqual(realRoot, trustedRoot)
    )
  } catch {
    return false
  }
}

export function projectCommandCandidates(
  filePath: string,
  rootPath: string,
  command: string,
  localCommandDirectory: LocalCommandDirectory | undefined
): string[] {
  if (!localCommandDirectory || localCommandDirectory === 'path-only') {
    return []
  }
  const fileDirectory = resolve(dirname(filePath))
  const workspaceRoot = resolve(rootPath)
  const candidates: string[] = []
  let current = fileDirectory
  while (true) {
    const relativeToRoot = relative(workspaceRoot, current)
    if (relativeToRoot.startsWith('..') || isAbsolute(relativeToRoot)) {
      return candidates
    }
    const base = localCommandDirectory === 'python-venv' ? join(current, '.venv') : join(current, 'node_modules')
    candidates.push(
      localCommandDirectory === 'python-venv'
        ? join(base, 'bin', command)
        : join(base, '.bin', command)
    )
    if (current === workspaceRoot) {
      return candidates
    }
    const parent = dirname(current)
    if (parent === current) {
      return candidates
    }
    current = parent
  }
}

export function isSafeProjectCommand(
  commandPath: string,
  rootPath: string,
  localCommandDirectory: LocalCommandDirectory | undefined
): boolean {
  try {
    const realRoot = realpathSync(rootPath)
    const parentRealPath = realpathSync(dirname(commandPath))
    if (!isPathInsideOrEqual(parentRealPath, realRoot)) {
      return false
    }
    if (localCommandDirectory === 'python-venv' && !isPathInsideOrEqual(dirname(parentRealPath), realRoot)) {
      return false
    }
    return isPathInsideOrEqual(realpathSync(commandPath), realRoot)
  } catch {
    return false
  }
}

export function isSafeVenvDirectory(venvPath: string, rootPath: string): boolean {
  try {
    return isPathInsideOrEqual(realpathSync(venvPath), realpathSync(rootPath))
  } catch {
    return false
  }
}

export function getProjectToolsSkippedReason(
  filePath: string,
  rootPath: string,
  localCommandDirectory: LocalCommandDirectory | undefined,
  commands: string[],
  options?: LspResolutionOptions
): string | undefined {
  if (
    isTrustedWorkspaceRoot(rootPath, options) ||
    !commands.some((command) =>
      projectCommandCandidates(filePath, rootPath, command, localCommandDirectory).some(isExecutableFile)
    )
  ) {
    return undefined
  }
  return 'project tools skipped: root not in trusted-roots.json'
}
