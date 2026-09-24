import type { IDisposable } from 'monaco-editor'

export function createMonacoProviderRegistry<TMonaco>(): {
  isFor(monaco: TMonaco): boolean
  push(...disposables: IDisposable[]): void
  resetIfMonacoChanged(monaco: TMonaco, onReset: () => void): void
} {
  let registeredMonaco: TMonaco | null = null
  const disposables: IDisposable[] = []

  return {
    isFor: (monaco) => registeredMonaco === monaco,
    push: (...items) => disposables.push(...items),
    resetIfMonacoChanged: (monaco, onReset) => {
      if (registeredMonaco === monaco) {
        return
      }
      for (const disposable of disposables) {
        disposable.dispose()
      }
      disposables.length = 0
      registeredMonaco = monaco
      onReset()
    }
  }
}
