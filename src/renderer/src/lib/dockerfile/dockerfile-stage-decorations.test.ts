import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachDockerfileStageDecorations,
  buildDockerfileStageDecorations,
  ensureDockerfileStageSeparatorStyles
} from './dockerfile-stage-decorations'

type Listener = () => void

function fakeModel(initialValue: string) {
  let value = initialValue
  let contentListener: Listener | null = null
  let disposeListener: Listener | null = null
  let disposed = false
  return {
    getValue: () => value,
    isDisposed: () => disposed,
    onDidChangeContent: (listener: Listener) => {
      contentListener = listener
      return { dispose: () => (contentListener = null) }
    },
    onWillDispose: (listener: Listener) => {
      disposeListener = listener
      return { dispose: () => (disposeListener = null) }
    },
    change(nextValue: string): void {
      value = nextValue
      contentListener?.()
    },
    dispose(): void {
      disposed = true
      disposeListener?.()
    }
  }
}

function fakeEditor(model: ReturnType<typeof fakeModel>) {
  let currentModel = model
  let modelListener: Listener | null = null
  const collection = { set: vi.fn(), clear: vi.fn() }
  return {
    collection,
    editor: {
      createDecorationsCollection: () => collection,
      getModel: () => currentModel,
      onDidChangeModel: (listener: Listener) => {
        modelListener = listener
        return { dispose: () => (modelListener = null) }
      }
    },
    setModel(nextModel: ReturnType<typeof fakeModel>): void {
      currentModel = nextModel
    },
    changeModel(): void {
      modelListener?.()
    }
  }
}

describe('dockerfile stage decorations', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('uses the input token for the stage separator border', () => {
    const style = { id: '', textContent: '' }
    vi.stubGlobal('document', {
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => style),
      head: { appendChild: vi.fn() }
    })
    ensureDockerfileStageSeparatorStyles()
    expect(style.textContent).toContain('border-top: 1px solid var(--input)')
  })

  it('adds separators for stages 2 through n only', () => {
    expect(
      buildDockerfileStageDecorations('FROM one\nRUN one\nFROM two\nRUN two\nFROM three')
    ).toEqual([
      expect.objectContaining({ range: expect.objectContaining({ startLineNumber: 3 }) }),
      expect.objectContaining({ range: expect.objectContaining({ startLineNumber: 5 }) })
    ])
  })

  it('does not rebuild before the 150ms debounce expires', () => {
    const model = fakeModel('FROM one')
    const fixture = fakeEditor(model)
    const cleanup = attachDockerfileStageDecorations(fixture.editor, model)
    expect(fixture.collection.set).toHaveBeenLastCalledWith([])
    model.change('FROM one\nFROM two')
    vi.advanceTimersByTime(149)
    expect(fixture.collection.set).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(fixture.collection.set).toHaveBeenLastCalledWith(
      buildDockerfileStageDecorations('FROM one\nFROM two')
    )
    cleanup()
  })

  it('rebuilds once after several rapid content changes', () => {
    const model = fakeModel('FROM one')
    const fixture = fakeEditor(model)
    const cleanup = attachDockerfileStageDecorations(fixture.editor, model)
    model.change('FROM one\nFROM two')
    vi.advanceTimersByTime(100)
    model.change('FROM one\nFROM two\nFROM three')
    vi.advanceTimersByTime(100)
    model.change('FROM one\nFROM two\nFROM three\nFROM four')
    vi.advanceTimersByTime(149)
    expect(fixture.collection.set).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(fixture.collection.set).toHaveBeenCalledTimes(2)
    expect(fixture.collection.set).toHaveBeenLastCalledWith(
      buildDockerfileStageDecorations('FROM one\nFROM two\nFROM three\nFROM four')
    )
    cleanup()
  })

  it('rebuilds immediately when the model switches', () => {
    const model = fakeModel('FROM one')
    const nextModel = fakeModel('FROM next\nFROM final')
    const fixture = fakeEditor(model)
    const cleanup = attachDockerfileStageDecorations(fixture.editor, model)
    model.change('FROM one\nFROM pending')
    fixture.setModel(nextModel)
    fixture.changeModel()
    expect(fixture.collection.set).toHaveBeenCalledTimes(2)
    expect(fixture.collection.set).toHaveBeenLastCalledWith(
      buildDockerfileStageDecorations('FROM next\nFROM final')
    )
    vi.advanceTimersByTime(150)
    expect(fixture.collection.set).toHaveBeenCalledTimes(2)
    cleanup()
  })

  it('clears pending rebuilds on model dispose', () => {
    const model = fakeModel('FROM one')
    const fixture = fakeEditor(model)
    const cleanup = attachDockerfileStageDecorations(fixture.editor, model)
    model.change('FROM one\nFROM two')
    model.dispose()
    vi.advanceTimersByTime(150)
    expect(fixture.collection.set).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('clears pending rebuilds and decorations on unmount', () => {
    const model = fakeModel('FROM one\nFROM two')
    const fixture = fakeEditor(model)
    const cleanup = attachDockerfileStageDecorations(fixture.editor, model)
    model.change('FROM one\nFROM two\nFROM three')
    cleanup()
    expect(fixture.collection.clear).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(150)
    expect(fixture.collection.set).toHaveBeenCalledTimes(1)
  })
})
