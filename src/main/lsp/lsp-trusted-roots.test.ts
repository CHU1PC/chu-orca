import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isTrustedWorkspaceRoot } from './lsp-trusted-roots'

function fixtureDirectory(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function writeTrustedRoots(path: string, trustedRoots: unknown): void {
  writeFileSync(path, JSON.stringify({ trustedRoots }))
}

describe('isTrustedWorkspaceRoot', () => {
  it('skips one bad entry and still trusts a valid entry', () => {
    const base = fixtureDirectory('orca-trusted-roots-mixed-')
    const root = join(base, 'workspace')
    mkdirSync(root)
    const trustFile = join(base, 'trusted-roots.json')
    writeTrustedRoots(trustFile, ['relative', root])

    expect(isTrustedWorkspaceRoot(root, { trustedRootsFilePath: trustFile })).toBe(true)
  })

  it('trusts nothing when all entries are invalid', () => {
    const base = fixtureDirectory('orca-trusted-roots-bad-')
    const root = join(base, 'workspace')
    mkdirSync(root)
    const regularFile = join(base, 'not-a-directory')
    writeFileSync(regularFile, '')
    const trustFile = join(base, 'trusted-roots.json')
    writeTrustedRoots(trustFile, ['relative', join(base, 'missing'), regularFile, 42])

    expect(isTrustedWorkspaceRoot(root, { trustedRootsFilePath: trustFile })).toBe(false)
  })

  it('trusts nothing for malformed JSON', () => {
    const base = fixtureDirectory('orca-trusted-roots-malformed-')
    const root = join(base, 'workspace')
    mkdirSync(root)
    const trustFile = join(base, 'trusted-roots.json')
    writeFileSync(trustFile, '{')

    expect(isTrustedWorkspaceRoot(root, { trustedRootsFilePath: trustFile })).toBe(false)
  })
})
