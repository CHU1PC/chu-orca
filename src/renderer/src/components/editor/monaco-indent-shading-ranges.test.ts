import { describe, expect, it } from 'vitest'
import { getMonacoIndentShadingRanges } from './monaco-indent-shading-ranges'

const spaces = { tabSize: 4 }

describe('getMonacoIndentShadingRanges', () => {
  it('shades each full space indentation level', () => {
    expect(
      getMonacoIndentShadingRanges([{ lineNumber: 3, content: '        value' }], spaces)
    ).toEqual([
      { lineNumber: 3, startColumn: 1, endColumn: 5, className: 'orca-indent-shading-even' },
      { lineNumber: 3, startColumn: 5, endColumn: 9, className: 'orca-indent-shading-odd' }
    ])
  })

  it('advances tabs to the next tab stop', () => {
    expect(getMonacoIndentShadingRanges([{ lineNumber: 1, content: '\t\tvalue' }], spaces)).toEqual(
      [
        { lineNumber: 1, startColumn: 1, endColumn: 2, className: 'orca-indent-shading-even' },
        { lineNumber: 1, startColumn: 2, endColumn: 3, className: 'orca-indent-shading-odd' }
      ]
    )
  })

  it('keeps mixed whitespace in the level it visually occupies', () => {
    expect(
      getMonacoIndentShadingRanges([{ lineNumber: 5, content: '  \t  value' }], spaces)
    ).toEqual([
      { lineNumber: 5, startColumn: 1, endColumn: 4, className: 'orca-indent-shading-even' },
      { lineNumber: 5, startColumn: 4, endColumn: 6, className: 'orca-indent-shading-odd' }
    ])
  })

  it.each([
    [2, 2],
    [4, 1]
  ])('uses tabSize %i for level width', (tabSize, expectedLevels) => {
    const ranges = getMonacoIndentShadingRanges([{ lineNumber: 1, content: '    value' }], {
      tabSize
    })
    expect(ranges).toHaveLength(expectedLevels)
  })

  it('shades a trailing partial level with its level class', () => {
    expect(
      getMonacoIndentShadingRanges([{ lineNumber: 2, content: '     value' }], spaces)
    ).toEqual([
      { lineNumber: 2, startColumn: 1, endColumn: 5, className: 'orca-indent-shading-even' },
      { lineNumber: 2, startColumn: 5, endColumn: 6, className: 'orca-indent-shading-odd' }
    ])
  })

  it('skips blank and whitespace-only lines', () => {
    expect(
      getMonacoIndentShadingRanges(
        [
          { lineNumber: 1, content: '' },
          { lineNumber: 2, content: '    ' },
          { lineNumber: 3, content: '\t \t' }
        ],
        spaces
      )
    ).toEqual([])
  })
})
