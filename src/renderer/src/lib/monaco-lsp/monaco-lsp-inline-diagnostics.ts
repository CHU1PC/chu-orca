import type { IDisposable, Uri, editor } from 'monaco-editor'

type InlineDiagnosticsMonacoApi = {
  MarkerSeverity: InlineDiagnosticSeverityValues
  editor: {
    getModelMarkers: (filter: {
      owner?: string
      resource?: Uri
      take?: number
    }) => InlineDiagnosticMarker[]
    onDidChangeMarkers: (
      listener: (uris: readonly { toString: () => string }[]) => void
    ) => IDisposable
  }
}

export const INLINE_DIAGNOSTIC_MAX_MESSAGE_LENGTH = 160
export const INLINE_DIAGNOSTIC_MAX_LINES_PER_MODEL = 200
export const INLINE_DIAGNOSTIC_INCLUDE_SOURCE = false
export const INLINE_DIAGNOSTIC_LEFT_MARGIN = '8px'
export const INLINE_DIAGNOSTIC_ERROR_COLOR_TOKEN = 'var(--vscode-editorError-foreground, #d78787)'
export const INLINE_DIAGNOSTIC_WARNING_COLOR_TOKEN =
  'var(--vscode-editorWarning-foreground, #d4ad61)'

export const INLINE_DIAGNOSTIC_ERROR_CLASS = 'orca-inline-diagnostic-error'
export const INLINE_DIAGNOSTIC_WARNING_CLASS = 'orca-inline-diagnostic-warning'
export const INLINE_DIAGNOSTIC_ERROR_LINE_CLASS = 'orca-inline-diagnostic-line-error'
export const INLINE_DIAGNOSTIC_WARNING_LINE_CLASS = 'orca-inline-diagnostic-line-warning'
export const INLINE_DIAGNOSTIC_ERROR_LINE_BACKGROUND = 'rgba(224, 108, 117, 0.12)'
export const INLINE_DIAGNOSTIC_WARNING_LINE_BACKGROUND = 'rgba(212, 173, 97, 0.10)'

const INLINE_DIAGNOSTIC_STYLES_ID = 'orca-inline-diagnostics-styles'

export type InlineDiagnosticMarker = {
  severity: number
  startLineNumber: number
  message: string
  source?: string
  owner?: string
}

export type InlineDiagnosticSeverityValues = {
  Error: number
  Warning: number
}

export type InlineDiagnosticDecorationDescriptor = {
  range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
  options: {
    isWholeLine?: boolean
    className?: string
    showIfCollapsed?: boolean
    after?: {
      content: string
      inlineClassName: string
    }
  }
}

function truncateInlineDiagnosticMessage(message: string): string {
  if (message.length <= INLINE_DIAGNOSTIC_MAX_MESSAGE_LENGTH) {
    return message
  }
  return `${message.slice(0, INLINE_DIAGNOSTIC_MAX_MESSAGE_LENGTH - 1)}…`
}

export function formatInlineDiagnosticMessage(marker: InlineDiagnosticMarker): string | null {
  const message = marker.message.replace(/\s+/gu, ' ').trim()
  if (message.length === 0) {
    return null
  }
  const rendered =
    INLINE_DIAGNOSTIC_INCLUDE_SOURCE && marker.source ? `${marker.source}: ${message}` : message
  return truncateInlineDiagnosticMessage(rendered)
}

export function buildInlineDiagnosticDecorations(
  markers: readonly InlineDiagnosticMarker[],
  getLineEndColumn: (lineNumber: number) => number,
  severityValues: InlineDiagnosticSeverityValues
): InlineDiagnosticDecorationDescriptor[] {
  const bestByLine = new Map<number, InlineDiagnosticMarker>()
  for (const marker of markers) {
    if (marker.severity !== severityValues.Error && marker.severity !== severityValues.Warning) {
      continue
    }
    if (!Number.isInteger(marker.startLineNumber) || marker.startLineNumber < 1) {
      continue
    }
    const current = bestByLine.get(marker.startLineNumber)
    if (!current && bestByLine.size >= INLINE_DIAGNOSTIC_MAX_LINES_PER_MODEL) {
      continue
    }
    if (!current || marker.severity > current.severity) {
      bestByLine.set(marker.startLineNumber, marker)
    }
  }

  return [...bestByLine].flatMap(([lineNumber, marker]) => {
    const message = formatInlineDiagnosticMessage(marker)
    if (!message) {
      return []
    }
    const endColumn = getLineEndColumn(lineNumber)
    const className =
      marker.severity === severityValues.Error
        ? INLINE_DIAGNOSTIC_ERROR_CLASS
        : INLINE_DIAGNOSTIC_WARNING_CLASS
    const lineClassName =
      marker.severity === severityValues.Error
        ? INLINE_DIAGNOSTIC_ERROR_LINE_CLASS
        : INLINE_DIAGNOSTIC_WARNING_LINE_CLASS
    const range = {
      startLineNumber: lineNumber,
      startColumn: endColumn,
      endLineNumber: lineNumber,
      endColumn
    }
    // 1つの装飾に after と isWholeLine を同居させると、Monaco の injected text の扱いと行全体の描画が干渉しうるため、背景は別の装飾にする。
    return [
      {
        range,
        options: {
          isWholeLine: true,
          className: lineClassName
        }
      },
      {
        range,
        // Monaco の getInjectedTextInInterval は、範囲が空の装飾を showIfCollapsed が無いと捨てる。
        options: {
          showIfCollapsed: true,
          after: { content: message, inlineClassName: className }
        }
      }
    ]
  })
}

function ensureInlineDiagnosticStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(INLINE_DIAGNOSTIC_STYLES_ID)) {
    return
  }
  const style = document.createElement('style')
  style.id = INLINE_DIAGNOSTIC_STYLES_ID
  style.textContent = `
.monaco-editor .${INLINE_DIAGNOSTIC_ERROR_CLASS},
.monaco-diff-editor .${INLINE_DIAGNOSTIC_ERROR_CLASS} {
  color: ${INLINE_DIAGNOSTIC_ERROR_COLOR_TOKEN};
  margin-left: ${INLINE_DIAGNOSTIC_LEFT_MARGIN};
  opacity: 0.85;
  font-style: italic;
}
.monaco-editor .${INLINE_DIAGNOSTIC_WARNING_CLASS},
.monaco-diff-editor .${INLINE_DIAGNOSTIC_WARNING_CLASS} {
  color: ${INLINE_DIAGNOSTIC_WARNING_COLOR_TOKEN};
  margin-left: ${INLINE_DIAGNOSTIC_LEFT_MARGIN};
  opacity: 0.85;
  font-style: italic;
}
.monaco-editor .${INLINE_DIAGNOSTIC_ERROR_LINE_CLASS},
.monaco-diff-editor .${INLINE_DIAGNOSTIC_ERROR_LINE_CLASS} {
  background-color: ${INLINE_DIAGNOSTIC_ERROR_LINE_BACKGROUND};
}
.monaco-editor .${INLINE_DIAGNOSTIC_WARNING_LINE_CLASS},
.monaco-diff-editor .${INLINE_DIAGNOSTIC_WARNING_LINE_CLASS} {
  background-color: ${INLINE_DIAGNOSTIC_WARNING_LINE_BACKGROUND};
}
`
  document.head.appendChild(style)
}

type InlineDiagnosticsEditor = Pick<
  editor.ICodeEditor,
  'createDecorationsCollection' | 'onDidDispose'
>
type InlineDiagnosticsModel = Pick<
  editor.ITextModel,
  'uri' | 'isDisposed' | 'getLineMaxColumn' | 'onWillDispose'
>

type InlineDiagnosticsCollection = {
  set: (decorations: InlineDiagnosticDecorationDescriptor[]) => void
  clear: () => void
}

type TrackedModel = {
  editor: InlineDiagnosticsEditor
  model: InlineDiagnosticsModel
  collection: InlineDiagnosticsCollection
  modelDispose: IDisposable
  editorDispose: IDisposable
}

export type InlineDiagnosticsWiring = IDisposable & {
  trackModel: (editorInstance: InlineDiagnosticsEditor, model: InlineDiagnosticsModel) => () => void
}

export function createInlineDiagnosticsWiring(
  monaco: InlineDiagnosticsMonacoApi
): InlineDiagnosticsWiring {
  const trackedModels = new Map<InlineDiagnosticsEditor, TrackedModel>()
  const pendingRefreshes = new Set<TrackedModel>()
  let refreshScheduled = false
  let disposed = false

  const refresh = (tracked: TrackedModel): void => {
    if (disposed || tracked.model.isDisposed() || trackedModels.get(tracked.editor) !== tracked) {
      return
    }
    const markers = monaco.editor.getModelMarkers({ resource: tracked.model.uri })
    const decorations = buildInlineDiagnosticDecorations(
      markers,
      (lineNumber) => tracked.model.getLineMaxColumn(lineNumber),
      monaco.MarkerSeverity
    )
    if (!tracked.model.isDisposed() && trackedModels.get(tracked.editor) === tracked) {
      tracked.collection.set(decorations)
    }
  }

  const scheduleRefresh = (tracked: TrackedModel): void => {
    pendingRefreshes.add(tracked)
    if (refreshScheduled) {
      return
    }
    refreshScheduled = true
    queueMicrotask(() => {
      refreshScheduled = false
      for (const item of pendingRefreshes) {
        pendingRefreshes.delete(item)
        refresh(item)
      }
    })
  }

  const markerListener = monaco.editor.onDidChangeMarkers((uris) => {
    const changedUris = new Set(uris.map((uri) => uri.toString()))
    for (const tracked of trackedModels.values()) {
      if (changedUris.has(tracked.model.uri.toString())) {
        scheduleRefresh(tracked)
      }
    }
  })

  const untrack = (tracked: TrackedModel): void => {
    if (trackedModels.get(tracked.editor) !== tracked) {
      return
    }
    trackedModels.delete(tracked.editor)
    pendingRefreshes.delete(tracked)
    tracked.modelDispose.dispose()
    tracked.editorDispose.dispose()
    if (!tracked.model.isDisposed()) {
      tracked.collection.clear()
    }
  }

  const wiring = {
    trackModel(editorInstance: InlineDiagnosticsEditor, model: InlineDiagnosticsModel): () => void {
      if (disposed || model.isDisposed()) {
        return () => {}
      }
      const previous = trackedModels.get(editorInstance)
      if (previous) {
        untrack(previous)
      }
      ensureInlineDiagnosticStyles()
      const tracked = {
        editor: editorInstance,
        model,
        collection: editorInstance.createDecorationsCollection(),
        modelDispose: { dispose: () => {} },
        editorDispose: { dispose: () => {} }
      }
      tracked.modelDispose = model.onWillDispose(() => {
        if (trackedModels.get(editorInstance) !== tracked) {
          return
        }
        trackedModels.delete(editorInstance)
        pendingRefreshes.delete(tracked)
        if (!tracked.model.isDisposed()) {
          tracked.collection.clear()
        }
        tracked.editorDispose.dispose()
      })
      tracked.editorDispose = editorInstance.onDidDispose(() => {
        if (trackedModels.get(editorInstance) !== tracked) {
          return
        }
        trackedModels.delete(editorInstance)
        pendingRefreshes.delete(tracked)
        tracked.modelDispose.dispose()
      })
      trackedModels.set(editorInstance, tracked)
      refresh(tracked)
      return () => untrack(tracked)
    },
    dispose(): void {
      if (disposed) {
        return
      }
      disposed = true
      markerListener.dispose()
      for (const tracked of trackedModels.values()) {
        untrack(tracked)
      }
      trackedModels.clear()
      pendingRefreshes.clear()
    }
  }
  return wiring
}
