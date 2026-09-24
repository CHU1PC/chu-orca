export const MONACO_INDENT_SHADING_CLASSES = [
  'orca-indent-shading-even',
  'orca-indent-shading-odd'
] as const

export type MonacoIndentShadingRange = {
  lineNumber: number
  startColumn: number
  endColumn: number
  className: (typeof MONACO_INDENT_SHADING_CLASSES)[number]
}

export type MonacoIndentShadingLine = {
  lineNumber: number
  content: string
}

export type MonacoIndentShadingOptions = {
  tabSize: number
}

function getLineIndentShadingRanges(
  line: MonacoIndentShadingLine,
  tabSize: number
): MonacoIndentShadingRange[] {
  const { content, lineNumber } = line
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    return []
  }

  let indentEnd = 0
  while (content[indentEnd] === ' ' || content[indentEnd] === '\t') {
    indentEnd += 1
  }
  if (indentEnd === 0 || indentEnd === content.length) {
    return []
  }

  const ranges: MonacoIndentShadingRange[] = []
  let visibleColumn = 0
  let activeLevel = -1
  let activeStartColumn = 0
  let activeEndColumn = 0
  const pushRange = (): void => {
    if (activeLevel < 0) {
      return
    }
    ranges.push({
      lineNumber,
      startColumn: activeStartColumn,
      endColumn: activeEndColumn,
      className:
        activeLevel % 2 === 0 ? MONACO_INDENT_SHADING_CLASSES[0] : MONACO_INDENT_SHADING_CLASSES[1]
    })
  }

  for (let index = 0; index < indentEnd; index += 1) {
    const level = Math.floor(visibleColumn / tabSize)
    if (level !== activeLevel) {
      pushRange()
      activeLevel = level
      activeStartColumn = index + 1
    }
    activeEndColumn = index + 2
    visibleColumn += content[index] === '\t' ? tabSize - (visibleColumn % tabSize) : 1
  }

  pushRange()
  return ranges
}

export function getMonacoIndentShadingRanges(
  lines: readonly MonacoIndentShadingLine[],
  modelOptions: MonacoIndentShadingOptions
): MonacoIndentShadingRange[] {
  const tabSize = Math.max(1, Math.floor(modelOptions.tabSize))
  const ranges: MonacoIndentShadingRange[] = []
  for (const line of lines) {
    ranges.push(...getLineIndentShadingRanges(line, tabSize))
  }
  return ranges
}
