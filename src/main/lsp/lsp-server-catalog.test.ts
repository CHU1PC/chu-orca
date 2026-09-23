// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  LSP_SERVER_CATALOG,
  resetLspServerAvailabilityForTests,
  resolveLspServersForLanguage,
  resolveLspServerForLanguage,
  toLspDocumentLanguageId
} from './lsp-server-catalog'

function trustFile(root: string): string {
  const path = join(root, 'trusted-roots.json')
  writeFileSync(path, JSON.stringify({ trustedRoots: [root] }))
  return path
}

describe('toLspDocumentLanguageId', () => {
  it('maps react dialects by extension and passes everything else through', () => {
    expect(toLspDocumentLanguageId('typescript', '/a/App.tsx')).toBe('typescriptreact')
    expect(toLspDocumentLanguageId('typescript', '/a/app.ts')).toBe('typescript')
    expect(toLspDocumentLanguageId('javascript', '/a/App.JSX')).toBe('javascriptreact')
    expect(toLspDocumentLanguageId('python', '/a/x.py')).toBe('python')
  })
})

describe('resolveLspServerForLanguage', () => {
  beforeEach(() => resetLspServerAvailabilityForTests())

  it('prefers tsgo for typescript when installed', async () => {
    const resolved = await resolveLspServerForLanguage(
      'typescript',
      '/workspace/src/index.ts',
      '/workspace',
      () => Promise.resolve(true)
    )
    expect(resolved?.serverId).toBe('tsgo')
    expect(resolved?.args).toEqual(['--lsp', '--stdio'])
  })

  it('falls back to typescript-language-server when tsgo is missing', async () => {
    const resolved = await resolveLspServerForLanguage(
      'typescript',
      '/workspace/src/index.ts',
      '/workspace',
      (command) => Promise.resolve(command !== 'tsgo')
    )
    expect(resolved?.serverId).toBe('typescript-language-server')
  })

  it('declares the Dockerfile language server with node_modules resolution', () => {
    const dockerfile = LSP_SERVER_CATALOG.find((entry) => entry.languages.includes('dockerfile'))
    expect(dockerfile?.candidates).toEqual([
      { serverId: 'dockerfile-language-server', command: 'docker-langserver', args: ['--stdio'] }
    ])
    expect(dockerfile?.localCommandDirectory).toBe('node-modules')
  })

  it('finds the Dockerfile language server in a trusted project node_modules directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-lsp-dockerfile-'))
    const nested = join(root, 'packages', 'app', 'src')
    const bin = join(root, 'node_modules', '.bin')
    mkdirSync(nested, { recursive: true })
    mkdirSync(bin, { recursive: true })
    const command = join(bin, 'docker-langserver')
    writeFileSync(command, '')
    chmodSync(command, 0o755)
    const resolved = await resolveLspServerForLanguage(
      'dockerfile',
      join(nested, 'Dockerfile'),
      root,
      () => Promise.resolve(false),
      { trustedRootsFilePath: trustFile(root) }
    )
    expect(resolved?.serverId).toBe('dockerfile-language-server')
    expect(resolved?.args).toEqual(['--stdio'])
    expect(resolved?.resolvedCommand).toBe(command)
    expect(resolved?.source).toBe('project')
  })

  it('falls back to PATH for the Dockerfile language server', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-lsp-dockerfile-path-'))
    const resolved = await resolveLspServerForLanguage(
      'dockerfile',
      join(root, 'Dockerfile'),
      root,
      () => Promise.resolve(true),
      { trustedRootsFilePath: trustFile(root) }
    )
    expect(resolved?.serverId).toBe('dockerfile-language-server')
    expect(resolved?.source).toBe('PATH')
  })

  it('returns nothing when the Dockerfile language server is absent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-lsp-dockerfile-absent-'))
    await expect(
      resolveLspServerForLanguage(
        'dockerfile',
        join(root, 'Dockerfile'),
        root,
        () => Promise.resolve(false),
        { trustedRootsFilePath: trustFile(root) }
      )
    ).resolves.toBeNull()
  })

  it('returns null for unknown languages and when nothing is installed', async () => {
    expect(
      await resolveLspServerForLanguage('plaintext', '/workspace/x', '/workspace', () =>
        Promise.resolve(true)
      )
    ).toBeNull()
    expect(
      await resolveLspServerForLanguage('go', '/workspace/x', '/workspace', () =>
        Promise.resolve(false)
      )
    ).toBeNull()
  })

  it('caches probe verdicts per command', async () => {
    let probes = 0
    const probe = (): Promise<boolean> => {
      probes++
      return Promise.resolve(true)
    }
    await resolveLspServerForLanguage('typescript', '/workspace/x.ts', '/workspace', probe)
    await resolveLspServerForLanguage('javascript', '/workspace/x.js', '/workspace', probe)
    expect(probes).toBe(1)
  })

  it('declares pyright as primary and ruff as diagnostics-only', () => {
    const python = LSP_SERVER_CATALOG.find((entry) => entry.languages.includes('python'))
    expect(python?.candidates.map((candidate) => candidate.serverId)).toEqual(['pyright'])
    expect(python?.additionalServers?.map((server) => server.serverId)).toEqual(['ruff'])
  })

  it('walks local Python environments from the file directory to the workspace root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-lsp-'))
    const nested = join(root, 'packages', 'app', 'src')
    mkdirSync(nested, { recursive: true })
    const venvBin = join(root, '.venv', 'bin')
    mkdirSync(venvBin, { recursive: true })
    for (const command of ['pyright-langserver', 'ruff', 'python']) {
      const path = join(venvBin, command)
      writeFileSync(path, '')
      chmodSync(path, 0o755)
    }
    const trustedRootsFilePath = trustFile(root)
    const resolved = await resolveLspServersForLanguage(
      'python',
      join(nested, 'bad.py'),
      root,
      () => Promise.resolve(false),
      { trustedRootsFilePath }
    )
    expect(resolved.map((server) => server.serverId)).toEqual(['pyright', 'ruff'])
    expect(resolved.map((server) => server.role)).toEqual(['primary', 'diagnostics-only'])
    expect(resolved[0].resolvedCommand).toBe(join(venvBin, 'pyright-langserver'))
    expect(resolved[0].pythonPath).toBe(join(venvBin, 'python'))
    expect(resolved[1].resolvedCommand).toBe(join(venvBin, 'ruff'))
  })

  it('finds TypeScript node_modules binaries and does not cache a missing local binary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-lsp-'))
    const nested = join(root, 'packages', 'app', 'src')
    mkdirSync(nested, { recursive: true })
    const first = await resolveLspServersForLanguage(
      'typescript',
      join(nested, 'index.ts'),
      root,
      () => Promise.resolve(false),
      { trustedRootsFilePath: trustFile(root) }
    )
    expect(first).toEqual([])
    const bin = join(root, 'node_modules', '.bin')
    mkdirSync(bin, { recursive: true })
    const command = join(bin, 'tsgo')
    writeFileSync(command, '')
    chmodSync(command, 0o755)
    const second = await resolveLspServersForLanguage(
      'typescript',
      join(nested, 'index.ts'),
      root,
      () => Promise.resolve(false),
      { trustedRootsFilePath: join(root, 'trusted-roots.json') }
    )
    expect(second[0].resolvedCommand).toBe(command)
  })

  it('finds a venv in a parent directory below the workspace root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-lsp-'))
    const project = join(root, 'packages', 'app')
    const source = join(project, 'src')
    const bin = join(project, '.venv', 'bin')
    mkdirSync(source, { recursive: true })
    mkdirSync(bin, { recursive: true })
    for (const command of ['pyright-langserver', 'python']) {
      const path = join(bin, command)
      writeFileSync(path, '')
      chmodSync(path, 0o755)
    }
    const trustedRootsFilePath = trustFile(root)
    const resolved = await resolveLspServersForLanguage(
      'python',
      join(source, 'main.py'),
      root,
      () => Promise.resolve(false),
      { trustedRootsFilePath }
    )
    expect(resolved[0]?.resolvedCommand).toBe(join(bin, 'pyright-langserver'))
    expect(resolved[0]?.pythonPath).toBe(join(bin, 'python'))
  })

  it('uses PATH and omits pythonPath when the trust file is missing or invalid', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-lsp-untrusted-'))
    const bin = join(root, '.venv', 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'pyright-langserver'), '')
    chmodSync(join(bin, 'pyright-langserver'), 0o755)
    for (const trustFileContents of [null, '{', JSON.stringify({ trustedRoots: ['relative'] })]) {
      const trustFilePath = join(root, `trust-${String(trustFileContents)}.json`)
      if (trustFileContents !== null) {
        writeFileSync(trustFilePath, trustFileContents)
      }
      const resolved = await resolveLspServersForLanguage(
        'python',
        join(root, 'main.py'),
        root,
        () => Promise.resolve(true),
        { trustedRootsFilePath: trustFilePath }
      )
      expect(resolved[0]?.source).toBe('PATH')
      expect(resolved[0]?.pythonPath).toBeUndefined()
    }
  })

  it('resolves trusted symlink roots but rejects an outside venv and command symlink', async () => {
    const base = mkdtempSync(join(tmpdir(), 'orca-lsp-symlink-'))
    const realRoot = join(base, 'real-root')
    const rootLink = join(base, 'root-link')
    mkdirSync(realRoot, { recursive: true })
    symlinkSync(realRoot, rootLink)
    const trustLink = join(base, 'trusted-link')
    symlinkSync(realRoot, trustLink)
    const bin = join(realRoot, '.venv', 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'pyright-langserver'), '')
    chmodSync(join(bin, 'pyright-langserver'), 0o755)
    const trustFilePath = join(base, 'trusted-roots.json')
    writeFileSync(trustFilePath, JSON.stringify({ trustedRoots: [trustLink] }))
    const trusted = await resolveLspServersForLanguage(
      'python',
      join(rootLink, 'main.py'),
      rootLink,
      () => Promise.resolve(false),
      { trustedRootsFilePath: trustFilePath }
    )
    expect(trusted[0]?.source).toBe('project')

    const outside = join(base, 'outside')
    mkdirSync(join(outside, 'bin'), { recursive: true })
    writeFileSync(join(outside, 'bin', 'pyright-langserver'), '')
    chmodSync(join(outside, 'bin', 'pyright-langserver'), 0o755)
    const outsideRoot = mkdtempSync(join(base, 'outside-root-'))
    symlinkSync(outside, join(outsideRoot, '.venv'))
    const rejectedVenv = await resolveLspServersForLanguage(
      'python',
      join(outsideRoot, 'main.py'),
      outsideRoot,
      () => Promise.resolve(false),
      { trustedRootsFilePath: trustFile(outsideRoot) }
    )
    expect(rejectedVenv).toEqual([])

    const commandOutside = join(base, 'command-outside')
    writeFileSync(commandOutside, '')
    chmodSync(commandOutside, 0o755)
    const commandRoot = mkdtempSync(join(base, 'command-root-'))
    mkdirSync(join(commandRoot, '.venv', 'bin'), { recursive: true })
    symlinkSync(commandOutside, join(commandRoot, '.venv', 'bin', 'pyright-langserver'))
    const rejectedCommand = await resolveLspServersForLanguage(
      'python',
      join(commandRoot, 'main.py'),
      commandRoot,
      () => Promise.resolve(false),
      { trustedRootsFilePath: trustFile(commandRoot) }
    )
    expect(rejectedCommand).toEqual([])
  })

  it('accepts an external interpreter symlink for a trusted venv pythonPath', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-lsp-python-link-'))
    const externalPython = join(root, 'external-python')
    writeFileSync(externalPython, '')
    chmodSync(externalPython, 0o755)
    const bin = join(root, '.venv', 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'pyright-langserver'), '')
    chmodSync(join(bin, 'pyright-langserver'), 0o755)
    symlinkSync(externalPython, join(bin, 'python'))
    const resolved = await resolveLspServersForLanguage(
      'python',
      join(root, 'main.py'),
      root,
      () => Promise.resolve(false),
      { trustedRootsFilePath: trustFile(root) }
    )
    expect(resolved[0]?.source).toBe('project')
    expect(resolved[0]?.pythonPath).toBe(join(bin, 'python'))
  })
})
