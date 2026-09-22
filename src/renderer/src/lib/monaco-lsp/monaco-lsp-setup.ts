// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.
import { typescript as monacoTS } from 'monaco-editor'

// Why: Monaco's sandboxed worker cannot resolve project imports, so its
// semantic results are misleading in workspaces where the local LSP bridge is
// available. Keep tokenization and features not supplied by the bridge.
export function configureMonacoLsp(): void {
  const tsWorkerModeConfiguration = {
    completionItems: false,
    hovers: false,
    definitions: false,
    references: false
  }
  monacoTS.typescriptDefaults.setModeConfiguration({
    ...monacoTS.typescriptDefaults.modeConfiguration,
    ...tsWorkerModeConfiguration
  })
  monacoTS.javascriptDefaults.setModeConfiguration({
    ...monacoTS.javascriptDefaults.modeConfiguration,
    ...tsWorkerModeConfiguration
  })
}
