import type { IDisposable } from 'monaco-editor'
import { parseDockerfileStages } from './dockerfile-stages'

export const DOCKERFILE_STAGE_SEPARATOR_CLASS = 'orca-dockerfile-stage-separator'
const DOCKERFILE_STAGE_SEPARATOR_STYLES_ID = 'orca-dockerfile-stage-separator-styles'
const DOCKERFILE_STAGE_REBUILD_DEBOUNCE_MS = 150

export type DockerfileStageDecoration = {
  range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
  options: { isWholeLine: true; className: string }
}

export function buildDockerfileStageDecorations(text: string): DockerfileStageDecoration[] {
  return parseDockerfileStages(text)
    .slice(1)
    .map((stage) => ({
      range: {
        startLineNumber: stage.fromLine,
        startColumn: 1,
        endLineNumber: stage.fromLine,
        endColumn: 1
      },
      options: { isWholeLine: true, className: DOCKERFILE_STAGE_SEPARATOR_CLASS }
    }))
}

export function ensureDockerfileStageSeparatorStyles(): void {
  if (
    typeof document === 'undefined' ||
    document.getElementById(DOCKERFILE_STAGE_SEPARATOR_STYLES_ID)
  ) {
    return
  }
  const style = document.createElement('style')
  style.id = DOCKERFILE_STAGE_SEPARATOR_STYLES_ID
  style.textContent = `.monaco-editor .${DOCKERFILE_STAGE_SEPARATOR_CLASS} { border-top: 1px solid var(--input); }`
  document.head.appendChild(style)
}

type DockerfileStageDecorationCollection = {
  set: (decorations: DockerfileStageDecoration[]) => void
  clear: () => void
}

export type DockerfileStageDecorationEditor = {
  createDecorationsCollection: () => DockerfileStageDecorationCollection
  onDidChangeModel: (listener: () => void) => IDisposable
  getModel: () => DockerfileStageDecorationModel | null
}

export type DockerfileStageDecorationModel = {
  getValue: () => string
  isDisposed: () => boolean
  onDidChangeContent: (listener: () => void) => IDisposable
  onWillDispose: (listener: () => void) => IDisposable
}

export function attachDockerfileStageDecorations(
  editorInstance: DockerfileStageDecorationEditor,
  model: DockerfileStageDecorationModel
): () => void {
  ensureDockerfileStageSeparatorStyles()
  const collection = editorInstance.createDecorationsCollection()
  let currentModel: DockerfileStageDecorationModel | null = model
  let disposed = false
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null
  let modelContentListener: IDisposable = { dispose: () => {} }
  let modelDisposeListener: IDisposable = { dispose: () => {} }

  const cancelScheduledRebuild = (): void => {
    if (rebuildTimer !== null) {
      clearTimeout(rebuildTimer)
      rebuildTimer = null
    }
  }

  const rebuild = (): void => {
    if (!disposed && currentModel && !currentModel.isDisposed()) {
      collection.set(buildDockerfileStageDecorations(currentModel.getValue()))
    }
  }

  const scheduleRebuild = (): void => {
    if (disposed) {
      return
    }
    cancelScheduledRebuild()
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null
      rebuild()
    }, DOCKERFILE_STAGE_REBUILD_DEBOUNCE_MS)
  }

  const clearModelListeners = (): void => {
    modelContentListener.dispose()
    modelDisposeListener.dispose()
  }

  const setModelListeners = (nextModel: DockerfileStageDecorationModel): void => {
    modelContentListener = nextModel.onDidChangeContent(scheduleRebuild)
    modelDisposeListener = nextModel.onWillDispose(() => {
      cancelScheduledRebuild()
      collection.clear()
      modelContentListener.dispose()
      currentModel = null
    })
  }

  rebuild()
  setModelListeners(model)

  const updateModel = (): void => {
    if (disposed) {
      return
    }
    cancelScheduledRebuild()
    clearModelListeners()
    collection.clear()
    const nextModel = editorInstance.getModel()
    if (!nextModel || nextModel.isDisposed()) {
      currentModel = null
      return
    }
    currentModel = nextModel
    rebuild()
    setModelListeners(nextModel)
  }

  const editorModelListener = editorInstance.onDidChangeModel(updateModel)
  return () => {
    disposed = true
    cancelScheduledRebuild()
    editorModelListener.dispose()
    clearModelListeners()
    currentModel = null
    collection.clear()
  }
}
