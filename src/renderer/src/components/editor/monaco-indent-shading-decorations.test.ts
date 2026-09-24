import type { editor } from 'monaco-editor'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMonacoIndentShadingController,
  MONACO_INDENT_SHADING_REFRESH_DELAY_MS
} from './monaco-indent-shading-decorations'

type MockEditor = Parameters<typeof createMonacoIndentShadingController>[0]
type MockModel = NonNullable<ReturnType<MockEditor['getModel']>>
type MockCollection = ReturnType<MockEditor['createDecorationsCollection']>
type MockDecoration = Parameters<MockCollection['set']>[0][number]
type MockVisibleRange = ReturnType<MockEditor['getVisibleRanges']>[number]

function createEvent(): {
  event: MockEditor['onDidChangeModel']
  fire: () => void
  listenerCount: () => number
} {
  const listeners = new Set<() => void>()
  const event: MockEditor['onDidChangeModel'] = (listener) => {
    listeners.add(listener)
    return {
      dispose: () => {
        listeners.delete(listener)
      }
    }
  }

  return {
    event,
    fire: () => {
      for (const listener of listeners) {
        listener()
      }
    },
    listenerCount: () => listeners.size
  }
}

function createModel(lines: readonly string[]) {
  const contentChanged = createEvent()
  const optionsChanged = createEvent()
  const model = {
    getLineCount: () => lines.length,
    getLineContent: (lineNumber: number) => lines[lineNumber - 1] ?? '',
    getOptions: () => ({ tabSize: 4 }),
    onDidChangeContent: contentChanged.event,
    onDidChangeOptions: optionsChanged.event
  } satisfies MockModel

  return { model, contentChanged, optionsChanged }
}

function createMockEditor(initialModel: MockModel) {
  const modelChanged = createEvent()
  const scrollChanged = createEvent()
  const layoutChanged = createEvent()
  const hiddenAreasChanged = createEvent()
  const disposed = createEvent()
  const setCalls: (readonly MockDecoration[])[] = []
  let clearCalls = 0
  let currentModel: MockModel | null = initialModel
  let visibleRanges: MockVisibleRange[] = [
    { startLineNumber: 1, endLineNumber: initialModel.getLineCount() }
  ]
  const collection = {
    set: (decorations: readonly MockDecoration[]) => {
      setCalls.push(decorations)
      return []
    },
    clear: () => {
      clearCalls += 1
    }
  } satisfies MockCollection
  const editorInstance = {
    createDecorationsCollection: () => collection,
    getModel: () => currentModel,
    getVisibleRanges: () => visibleRanges,
    onDidChangeModel: modelChanged.event,
    onDidScrollChange: scrollChanged.event,
    onDidLayoutChange: layoutChanged.event,
    onDidChangeHiddenAreas: hiddenAreasChanged.event,
    onDidDispose: disposed.event
  } satisfies MockEditor

  return {
    editorInstance,
    collection,
    events: { modelChanged, scrollChanged, layoutChanged, hiddenAreasChanged, disposed },
    setModel: (model: MockModel | null) => {
      currentModel = model
    },
    setVisibleRanges: (ranges: MockVisibleRange[]) => {
      visibleRanges = ranges
    },
    getClearCalls: () => clearCalls,
    getSetCalls: () => setCalls
  }
}

function decoration(
  lineNumber: number,
  startColumn: number,
  endColumn: number
): editor.IModelDeltaDecoration {
  return {
    range: { startLineNumber: lineNumber, startColumn, endLineNumber: lineNumber, endColumn },
    options: { inlineClassName: 'orca-indent-shading-even' }
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createMonacoIndentShadingController', () => {
  it('clears old decorations and refreshes from the new model after a model change', () => {
    vi.useFakeTimers()
    const oldModel = createModel(['  old'])
    const newModel = createModel(['        new'])
    const mock = createMockEditor(oldModel.model)
    const controller = createMonacoIndentShadingController(mock.editorInstance)

    vi.advanceTimersByTime(MONACO_INDENT_SHADING_REFRESH_DELAY_MS)
    mock.getSetCalls().length = 0
    const clearCallsBeforeModelChange = mock.getClearCalls()
    mock.setModel(newModel.model)
    mock.events.modelChanged.fire()

    expect(mock.getClearCalls()).toBe(clearCallsBeforeModelChange + 1)
    expect(oldModel.contentChanged.listenerCount()).toBe(0)
    expect(oldModel.optionsChanged.listenerCount()).toBe(0)
    oldModel.contentChanged.fire()
    oldModel.optionsChanged.fire()
    vi.advanceTimersByTime(MONACO_INDENT_SHADING_REFRESH_DELAY_MS - 1)
    expect(mock.getSetCalls()).toHaveLength(0)

    vi.advanceTimersByTime(1)
    expect(mock.getSetCalls()).toEqual([
      [
        decoration(1, 1, 5),
        {
          range: { startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 9 },
          options: { inlineClassName: 'orca-indent-shading-odd' }
        }
      ]
    ])
    expect(newModel.contentChanged.listenerCount()).toBe(1)
    expect(newModel.optionsChanged.listenerCount()).toBe(1)
    controller.dispose()
  })

  it('cancels pending refreshes and ignores editor and model events after dispose', () => {
    vi.useFakeTimers()
    const model = createModel(['    value'])
    const mock = createMockEditor(model.model)
    const controller = createMonacoIndentShadingController(mock.editorInstance)

    const clearCallsBeforeDispose = mock.getClearCalls()
    controller.dispose()
    expect(mock.getClearCalls()).toBe(clearCallsBeforeDispose + 1)
    expect(vi.getTimerCount()).toBe(0)
    mock.events.modelChanged.fire()
    mock.events.scrollChanged.fire()
    mock.events.layoutChanged.fire()
    mock.events.hiddenAreasChanged.fire()
    mock.events.disposed.fire()
    model.contentChanged.fire()
    model.optionsChanged.fire()
    expect(vi.getTimerCount()).toBe(0)

    vi.advanceTimersByTime(MONACO_INDENT_SHADING_REFRESH_DELAY_MS)
    expect(mock.getSetCalls()).toHaveLength(0)
    expect(mock.getClearCalls()).toBe(clearCallsBeforeDispose + 1)
  })

  it('refreshes after an editor layout change', () => {
    vi.useFakeTimers()
    const model = createModel(['    value'])
    const mock = createMockEditor(model.model)
    const controller = createMonacoIndentShadingController(mock.editorInstance)
    vi.advanceTimersByTime(MONACO_INDENT_SHADING_REFRESH_DELAY_MS)
    mock.getSetCalls().length = 0

    mock.events.layoutChanged.fire()
    vi.advanceTimersByTime(MONACO_INDENT_SHADING_REFRESH_DELAY_MS - 1)
    expect(mock.getSetCalls()).toHaveLength(0)
    vi.advanceTimersByTime(1)

    expect(mock.getSetCalls()).toHaveLength(1)
    controller.dispose()
  })

  it('refreshes after hidden areas change using the visible ranges at refresh time', () => {
    vi.useFakeTimers()
    const model = createModel(['root', '  child', '        nested'])
    const mock = createMockEditor(model.model)
    const controller = createMonacoIndentShadingController(mock.editorInstance)
    vi.advanceTimersByTime(MONACO_INDENT_SHADING_REFRESH_DELAY_MS)
    mock.getSetCalls().length = 0

    mock.events.hiddenAreasChanged.fire()
    mock.setVisibleRanges([{ startLineNumber: 3, endLineNumber: 3 }])
    vi.advanceTimersByTime(MONACO_INDENT_SHADING_REFRESH_DELAY_MS - 1)
    expect(mock.getSetCalls()).toHaveLength(0)
    vi.advanceTimersByTime(1)

    expect(mock.getSetCalls()).toEqual([
      [
        decoration(3, 1, 5),
        {
          range: { startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 9 },
          options: { inlineClassName: 'orca-indent-shading-odd' }
        }
      ]
    ])
    controller.dispose()
  })
})
