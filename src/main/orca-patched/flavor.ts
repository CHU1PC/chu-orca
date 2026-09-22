import { app } from 'electron'
import { join } from 'node:path'
import type { DevInstanceIdentity } from '../startup/dev-instance-identity'

declare const ORCA_PATCHED_FLAVOR: 'test' | 'release'

export function isPatchedTestFlavor(): boolean {
  // oxlint-disable-next-line unicorn/no-typeof-undefined -- Why: vitest has no vite `define`, so a bare identifier reference throws ReferenceError.
  return typeof ORCA_PATCHED_FLAVOR !== 'undefined' && ORCA_PATCHED_FLAVOR === 'test'
}

export function applyPatchedTestFlavorIdentity(identity: DevInstanceIdentity): DevInstanceIdentity {
  if (!isPatchedTestFlavor()) {
    return identity
  }
  return {
    ...identity,
    name: 'Orca-Patch',
    appName: 'Orca-Patch',
    appUserModelId: 'com.chu1.orca-patch'
  }
}

export function configurePatchedTestUserDataPath(): void {
  if (!isPatchedTestFlavor()) {
    return
  }
  app.setName('Orca-Patch')
  app.setPath('userData', join(app.getPath('appData'), 'orca-patch'))
}
