import type { editor, IDisposable } from 'monaco-editor'
import { getMonacoIndentShadingRanges } from './monaco-indent-shading-ranges'

export const MONACO_INDENT_SHADING_REFRESH_DELAY_MS = 150

type MonacoIndentShadingEvent = (listener: () => void) => IDisposable

type MonacoIndentShadingModel = Omit<
  Pick<
    editor.ITextModel,
    'getLineCount' | 'getLineContent' | 'getOptions' | 'onDidChangeContent' | 'onDidChangeOptions'
  >,
  'getOptions' | 'onDidChangeContent' | 'onDidChangeOptions'
> & {
  getOptions: () => Pick<ReturnType<editor.ITextModel['getOptions']>, 'tabSize'>
  onDidChangeContent: MonacoIndentShadingEvent
  onDidChangeOptions: MonacoIndentShadingEvent
}

type MonacoIndentShadingEditor = Omit<
  Pick<
    editor.IStandaloneCodeEditor,
    | 'createDecorationsCollection'
    | 'getModel'
    | 'getVisibleRanges'
    | 'onDidChangeModel'
    | 'onDidChangeHiddenAreas'
    | 'onDidLayoutChange'
    | 'onDidScrollChange'
    | 'onDidDispose'
  >,
  | 'createDecorationsCollection'
  | 'getModel'
  | 'getVisibleRanges'
  | 'onDidChangeModel'
  | 'onDidChangeHiddenAreas'
  | 'onDidLayoutChange'
  | 'onDidScrollChange'
  | 'onDidDispose'
> & {
  createDecorationsCollection: () => Pick<editor.IEditorDecorationsCollection, 'set' | 'clear'>
  getModel: () => MonacoIndentShadingModel | null
  getVisibleRanges: () => readonly Pick<
    ReturnType<editor.IStandaloneCodeEditor['getVisibleRanges']>[number],
    'startLineNumber' | 'endLineNumber'
  >[]
  onDidChangeModel: MonacoIndentShadingEvent
  onDidChangeHiddenAreas: MonacoIndentShadingEvent
  onDidLayoutChange: MonacoIndentShadingEvent
  onDidScrollChange: MonacoIndentShadingEvent
  onDidDispose: MonacoIndentShadingEvent
}

export type MonacoIndentShadingController = {
  dispose: () => void
}

export function createMonacoIndentShadingController(
  editorInstance: MonacoIndentShadingEditor
): MonacoIndentShadingController {
  const collection = editorInstance.createDecorationsCollection()
  let model: MonacoIndentShadingModel | null = null
  let contentSubscription: IDisposable | null = null
  let optionsSubscription: IDisposable | null = null
  let disposeSubscription: IDisposable | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const cancelPendingRefresh = (): void => {
    if (refreshTimer === null) {
      return
    }
    clearTimeout(refreshTimer)
    refreshTimer = null
  }

  const refreshNow = (): void => {
    cancelPendingRefresh()
    if (disposed || !model || editorInstance.getModel() !== model) {
      collection.clear()
      return
    }

    const visibleLines: { lineNumber: number; content: string }[] = []
    const visitedLines = new Set<number>()
    const lineCount = model.getLineCount()
    for (const visibleRange of editorInstance.getVisibleRanges()) {
      const firstLine = Math.max(1, visibleRange.startLineNumber)
      const lastLine = Math.min(lineCount, visibleRange.endLineNumber)
      for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
        if (visitedLines.has(lineNumber)) {
          continue
        }
        visitedLines.add(lineNumber)
        visibleLines.push({ lineNumber, content: model.getLineContent(lineNumber) })
      }
    }

    const modelOptions = model.getOptions()
    const ranges = getMonacoIndentShadingRanges(visibleLines, {
      tabSize: modelOptions.tabSize
    })
    collection.set(
      ranges.map(({ lineNumber, startColumn, endColumn, className }) => ({
        range: {
          startLineNumber: lineNumber,
          startColumn,
          endLineNumber: lineNumber,
          endColumn
        },
        options: { inlineClassName: className }
      }))
    )
  }

  const scheduleRefresh = (): void => {
    cancelPendingRefresh()
    refreshTimer = setTimeout(refreshNow, MONACO_INDENT_SHADING_REFRESH_DELAY_MS)
  }

  const bindCurrentModel = (): void => {
    contentSubscription?.dispose()
    optionsSubscription?.dispose()
    contentSubscription = null
    optionsSubscription = null
    model = editorInstance.getModel()
    collection.clear()
    if (!model) {
      cancelPendingRefresh()
      return
    }
    contentSubscription = model.onDidChangeContent(scheduleRefresh)
    optionsSubscription = model.onDidChangeOptions(scheduleRefresh)
    scheduleRefresh()
  }

  const modelSubscription = editorInstance.onDidChangeModel(bindCurrentModel)
  const scrollSubscription = editorInstance.onDidScrollChange(scheduleRefresh)
  const layoutSubscription = editorInstance.onDidLayoutChange(scheduleRefresh)
  const hiddenAreasSubscription = editorInstance.onDidChangeHiddenAreas(scheduleRefresh)

  const dispose = (): void => {
    if (disposed) {
      return
    }
    disposed = true
    cancelPendingRefresh()
    modelSubscription.dispose()
    scrollSubscription.dispose()
    layoutSubscription.dispose()
    hiddenAreasSubscription.dispose()
    contentSubscription?.dispose()
    optionsSubscription?.dispose()
    disposeSubscription?.dispose()
    disposeSubscription = null
    collection.clear()
    model = null
  }

  disposeSubscription = editorInstance.onDidDispose(dispose)
  bindCurrentModel()
  return { dispose }
}
