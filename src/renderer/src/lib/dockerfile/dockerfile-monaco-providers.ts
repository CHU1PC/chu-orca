import type { CancellationToken, IDisposable, IPosition, editor, languages } from 'monaco-editor'
import { parseDockerfileStages, resolveDockerfileStageReference } from './dockerfile-stages'

type DockerfileMonacoApi = {
  languages: {
    registerFoldingRangeProvider: (
      language: string,
      provider: languages.FoldingRangeProvider
    ) => IDisposable
    registerDefinitionProvider: (
      language: string,
      provider: languages.DefinitionProvider
    ) => IDisposable
  }
}

const DOCKERFILE_REGISTRATION_STORE_KEY = Symbol.for(
  'orca.dockerfile.monaco-provider-registration.v1'
)

function isDockerfileRegistrationStore(value: unknown): value is WeakMap<object, true> {
  return value instanceof WeakMap
}

const dockerfileRegistrationStore = (() => {
  const existing: unknown = Object.getOwnPropertyDescriptor(
    globalThis,
    DOCKERFILE_REGISTRATION_STORE_KEY
  )?.value
  if (isDockerfileRegistrationStore(existing)) {
    return existing
  }
  const created = new WeakMap<object, true>()
  Object.defineProperty(globalThis, DOCKERFILE_REGISTRATION_STORE_KEY, { value: created })
  return created
})()

function createDockerfileFoldingProvider(): languages.FoldingRangeProvider {
  return {
    provideFoldingRanges(
      model: editor.ITextModel,
      _context: languages.FoldingContext,
      _token: CancellationToken
    ) {
      return parseDockerfileStages(model.getValue())
        .filter((stage) => stage.endLine > stage.fromLine)
        .map((stage) => ({ start: stage.fromLine, end: stage.endLine }))
    }
  }
}

function createDockerfileDefinitionProvider(): languages.DefinitionProvider {
  return {
    provideDefinition(model: editor.ITextModel, position: IPosition, _token: CancellationToken) {
      const stage = resolveDockerfileStageReference(
        model.getValue(),
        position.lineNumber,
        position.column
      )
      if (!stage) {
        return null
      }
      return {
        uri: model.uri,
        range: {
          startLineNumber: stage.fromLine,
          startColumn: 1,
          endLineNumber: stage.fromLine,
          endColumn: model.getLineMaxColumn(stage.fromLine)
        }
      }
    }
  }
}

export function registerDockerfileLanguageFeatures(monaco: DockerfileMonacoApi): void {
  if (dockerfileRegistrationStore.has(monaco)) {
    return
  }
  monaco.languages.registerFoldingRangeProvider('dockerfile', createDockerfileFoldingProvider())
  monaco.languages.registerDefinitionProvider('dockerfile', createDockerfileDefinitionProvider())
  dockerfileRegistrationStore.set(monaco, true)
}
