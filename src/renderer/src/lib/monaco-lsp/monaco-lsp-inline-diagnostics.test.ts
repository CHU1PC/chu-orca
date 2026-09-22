import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { editor } from 'monaco-editor'
import {
  INLINE_DIAGNOSTIC_ERROR_CLASS,
  INLINE_DIAGNOSTIC_ERROR_LINE_CLASS,
  INLINE_DIAGNOSTIC_MAX_LINES_PER_MODEL,
  INLINE_DIAGNOSTIC_MAX_MESSAGE_LENGTH,
  INLINE_DIAGNOSTIC_WARNING_CLASS,
  INLINE_DIAGNOSTIC_WARNING_LINE_CLASS,
  buildInlineDiagnosticDecorations,
  createInlineDiagnosticsWiring,
  type InlineDiagnosticDecorationDescriptor
} from './monaco-lsp-inline-diagnostics'

const severityValues = { Error: 8, Warning: 4 }

function marker(
  startLineNumber: number,
  severity: number,
  message: string,
  source?: string,
  owner?: string
): { startLineNumber: number; severity: number; message: string; source?: string; owner?: string } {
  return { startLineNumber, severity, message, source, owner }
}

function messageOptions(
  decoration: { options: { after?: { content: string; inlineClassName: string } } } | undefined
): { content: string; inlineClassName: string } {
  const after = decoration?.options.after
  if (!after) {
    throw new Error('Expected an inline diagnostic message decoration')
  }
  return after
}

describe('buildInlineDiagnosticDecorations', () => {
  const endColumn = (lineNumber: number): number =>
    lineNumber === 2 ? 9 : lineNumber === 3 ? 1 : 5

  it('adds an error line background before the inline message', () => {
    const decorations = buildInlineDiagnosticDecorations(
      [marker(1, 8, 'error')],
      () => 5,
      severityValues
    )
    expect(decorations).toHaveLength(2)
    expect(decorations[0]?.options).toMatchObject({
      isWholeLine: true,
      className: INLINE_DIAGNOSTIC_ERROR_LINE_CLASS
    })
    expect(decorations[0]?.options.after).toBeUndefined()
    expect(decorations[0]?.options.showIfCollapsed).toBeUndefined()
    expect(decorations[0]?.range).toEqual(decorations[1]?.range)
    expect(decorations[1]?.options.showIfCollapsed).toBe(true)
    expect(messageOptions(decorations[1]).inlineClassName).toBe(INLINE_DIAGNOSTIC_ERROR_CLASS)
  })

  it('adds a warning line background before the inline message', () => {
    const decorations = buildInlineDiagnosticDecorations(
      [marker(1, 4, 'warning')],
      () => 5,
      severityValues
    )
    expect(decorations).toHaveLength(2)
    expect(decorations[0]?.options).toMatchObject({
      isWholeLine: true,
      className: INLINE_DIAGNOSTIC_WARNING_LINE_CLASS
    })
    expect(decorations[0]?.options.after).toBeUndefined()
    expect(decorations[0]?.options.showIfCollapsed).toBeUndefined()
    expect(decorations[1]?.options.showIfCollapsed).toBe(true)
    expect(messageOptions(decorations[1]).inlineClassName).toBe(INLINE_DIAGNOSTIC_WARNING_CLASS)
  })

  it('filters info and hint while retaining error and warning', () => {
    const decorations = buildInlineDiagnosticDecorations(
      [marker(1, 8, 'error'), marker(2, 4, 'warning'), marker(3, 2, 'info'), marker(4, 1, 'hint')],
      endColumn,
      severityValues
    )
    expect(decorations).toHaveLength(4)
    expect([1, 3].map((index) => messageOptions(decorations[index]).inlineClassName)).toEqual([
      INLINE_DIAGNOSTIC_ERROR_CLASS,
      INLINE_DIAGNOSTIC_WARNING_CLASS
    ])
  })

  it('keeps the highest severity and the first marker on a tie across owners', () => {
    const decorations = buildInlineDiagnosticDecorations(
      [
        marker(1, 4, 'ruff warning', 'Ruff', 'orca-lsp:ruff'),
        marker(1, 8, 'pyright error', 'Pyright', 'orca-lsp:pyright'),
        marker(1, 8, 'later error', 'Other', 'orca-lsp:other')
      ],
      () => 5,
      severityValues
    )
    expect(messageOptions(decorations[1]).content).toBe('pyright error')
  })

  it('collapses whitespace and truncates at the named boundary', () => {
    const under = 'u'.repeat(INLINE_DIAGNOSTIC_MAX_MESSAGE_LENGTH - 1)
    const exact = 'e'.repeat(INLINE_DIAGNOSTIC_MAX_MESSAGE_LENGTH)
    const over = 'o'.repeat(INLINE_DIAGNOSTIC_MAX_MESSAGE_LENGTH + 1)
    const decorations = buildInlineDiagnosticDecorations(
      [
        marker(1, 8, '  first\n\tsecond   third  '),
        marker(2, 8, under),
        marker(3, 8, exact),
        marker(4, 8, over)
      ],
      () => 1,
      severityValues
    )
    const messages = [1, 3, 5, 7].map((index) => messageOptions(decorations[index]))
    expect(messages[0]?.content).toBe('first second third')
    expect(messages[1]?.content).toHaveLength(INLINE_DIAGNOSTIC_MAX_MESSAGE_LENGTH - 1)
    expect(messages[2]?.content).toHaveLength(INLINE_DIAGNOSTIC_MAX_MESSAGE_LENGTH)
    expect(messages[3]?.content).toHaveLength(INLINE_DIAGNOSTIC_MAX_MESSAGE_LENGTH)
    expect(messages[3]?.content.endsWith('…')).toBe(true)
  })

  it('uses the end-of-line column for trailing whitespace and empty lines', () => {
    const decorations = buildInlineDiagnosticDecorations(
      [marker(2, 8, 'trailing'), marker(3, 4, 'empty')],
      (lineNumber) => (lineNumber === 2 ? 9 : 1),
      severityValues
    )
    expect(
      [decorations[1], decorations[3]].map(({ range }) => [range.startColumn, range.endColumn])
    ).toEqual([
      [9, 9],
      [1, 1]
    ])
  })

  it('keeps showIfCollapsed for empty end-of-line ranges', () => {
    const decorations = buildInlineDiagnosticDecorations(
      [marker(1, 8, 'error'), marker(2, 4, 'warning')],
      (lineNumber) => lineNumber + 3,
      severityValues
    )
    for (const decoration of [decorations[1], decorations[3]]) {
      expect(decoration.options.showIfCollapsed).toBe(true)
      expect(decoration.range.startColumn).toBe(decoration.range.endColumn)
    }
  })

  it('caps the number of decorated lines', () => {
    const decorations = buildInlineDiagnosticDecorations(
      Array.from({ length: INLINE_DIAGNOSTIC_MAX_LINES_PER_MODEL + 25 }, (_, index) =>
        marker(index + 1, 8, `error ${index}`)
      ),
      () => 1,
      severityValues
    )
    expect(decorations).toHaveLength(2 * INLINE_DIAGNOSTIC_MAX_LINES_PER_MODEL)
  })
})

type FakeModel = {
  uri: { toString: () => string }
  isDisposed: () => boolean
  getLineMaxColumn: (lineNumber: number) => number
  onWillDispose: (listener: () => void) => { dispose: () => void }
  dispose: () => void
}

function fakeModel(uri: string): FakeModel {
  let disposed = false
  let disposeListener: (() => void) | null = null
  return {
    uri: { toString: () => uri },
    isDisposed: () => disposed,
    getLineMaxColumn: () => 1,
    onWillDispose: (listener) => {
      disposeListener = listener
      return { dispose: () => (disposeListener = null) }
    },
    dispose: () => {
      disposed = true
      disposeListener?.()
    }
  }
}

function fakeMonaco(model: FakeModel) {
  const markerListeners = new Set<(uris: readonly { toString: () => string }[]) => void>()
  const setCalls: unknown[][] = []
  const collections: {
    set: (decorations: InlineDiagnosticDecorationDescriptor[]) => void
    clear: () => void
  }[] = []
  let editorDisposeListener: (() => void) | null = null
  const editorInstance = {
    createDecorationsCollection: () => {
      const collection = {
        set: vi.fn((decorations: InlineDiagnosticDecorationDescriptor[]) =>
          setCalls.push(decorations)
        ),
        clear: vi.fn()
      }
      collections.push(collection)
      return collection
    },
    onDidDispose: (listener: () => void) => {
      editorDisposeListener = listener
      return { dispose: () => (editorDisposeListener = null) }
    },
    dispose: () => editorDisposeListener?.()
  }
  const monaco = {
    MarkerSeverity: severityValues,
    editor: {
      getModelMarkers: vi.fn(() => [marker(1, 8, 'first')]),
      onDidChangeMarkers: (listener: (uris: readonly { toString: () => string }[]) => void) => {
        markerListeners.add(listener)
        return { dispose: () => markerListeners.delete(listener) }
      }
    }
  }
  return {
    monaco,
    editorInstance,
    collections,
    setCalls,
    emitMarkerChange: (uri: string) => {
      for (const listener of markerListeners) {
        listener([{ toString: () => uri }])
      }
    },
    listenerCount: () => markerListeners.size,
    model
  }
}

describe('createInlineDiagnosticsWiring', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('updates the decoration collection when markers change', async () => {
    const fixture = fakeMonaco(fakeModel('file:///a.py'))
    const wiring = createInlineDiagnosticsWiring(fixture.monaco)
    wiring.trackModel(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fake editor implements every member read by the inline diagnostics wiring.
      fixture.editorInstance as unknown as editor.ICodeEditor,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fake model implements every member read by the inline diagnostics wiring.
      fixture.model as unknown as editor.ITextModel
    )
    const initialCalls = fixture.setCalls.length
    fixture.emitMarkerChange('file:///a.py')
    await Promise.resolve()
    expect(fixture.setCalls.length).toBe(initialCalls + 1)
    expect(fixture.collections[0]?.set).toHaveBeenCalled()
    wiring.dispose()
  })

  it('does not write or throw after the model is disposed', async () => {
    const fixture = fakeMonaco(fakeModel('file:///a.py'))
    const wiring = createInlineDiagnosticsWiring(fixture.monaco)
    wiring.trackModel(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fake editor implements every member read by the inline diagnostics wiring.
      fixture.editorInstance as unknown as editor.ICodeEditor,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fake model implements every member read by the inline diagnostics wiring.
      fixture.model as unknown as editor.ITextModel
    )
    const initialCalls = fixture.setCalls.length
    fixture.model.dispose()
    fixture.emitMarkerChange('file:///a.py')
    await Promise.resolve()
    expect(fixture.setCalls.length).toBe(initialCalls)
    wiring.dispose()
  })

  it('removes the old marker listener when Monaco is recreated', () => {
    const fixture = fakeMonaco(fakeModel('file:///a.py'))
    const oldWiring = createInlineDiagnosticsWiring(fixture.monaco)
    expect(fixture.listenerCount()).toBe(1)
    oldWiring.dispose()
    expect(fixture.listenerCount()).toBe(0)
    const newWiring = createInlineDiagnosticsWiring(fixture.monaco)
    expect(fixture.listenerCount()).toBe(1)
    newWiring.dispose()
    expect(fixture.listenerCount()).toBe(0)
  })
})
