import { scanDockerfile } from './dockerfile-stage-scanner'
import type { DockerfileInstruction } from './dockerfile-stage-scanner'

export type DockerfileStage = {
  index: number
  name?: string
  nameLine?: number
  nameStartColumn?: number
  nameEndColumn?: number
  fromLine: number
  endLine: number
}

export type DockerfileStageReference = {
  value: string
  startColumn: number
  endColumn: number
}

const isCommentLine = (line: string): boolean => /^\s*#/u.test(line)
const isBlankLine = (line: string): boolean => /^\s*$/u.test(line)

type InstructionToken = {
  value: string
  quoted: boolean
  location?: {
    line: number
    startColumn: number
    endColumn: number
  }
}

type InstructionCharacterLocation = { line: number; column: number } | null

function instructionText(instruction: DockerfileInstruction): {
  text: string
  locations: InstructionCharacterLocation[]
} {
  let text = ''
  const locations: InstructionCharacterLocation[] = []
  instruction.fragments.forEach((fragment, index) => {
    if (index > 0) {
      text += ' '
      locations.push(null)
    }
    const line = instruction.sourceLines[index] ?? instruction.startLine
    for (let column = 0; column < fragment.length; column += 1) {
      text += fragment[column] ?? ''
      locations.push({ line, column: column + 1 })
    }
  })
  return { text, locations }
}

function instructionTokens(instruction: DockerfileInstruction): InstructionToken[] {
  const { text, locations } = instructionText(instruction)
  const commandStart = text.search(/\S/u)
  const commandLength = commandStart < 0 ? text.length : commandStart + instruction.command.length
  const tokens: InstructionToken[] = []
  let token = ''
  let quote: string | null = null
  let tokenStart: InstructionCharacterLocation = null
  let tokenEnd: InstructionCharacterLocation = null
  let quoted = false
  const finishToken = (): void => {
    if (!token) {
      tokenStart = null
      tokenEnd = null
      quoted = false
      return
    }
    const location =
      !quoted &&
      tokenStart &&
      tokenEnd &&
      tokenStart.line === tokenEnd.line &&
      tokenStart.column <= tokenEnd.column
        ? {
            line: tokenStart.line,
            startColumn: tokenStart.column,
            endColumn: tokenEnd.column + 1
          }
        : undefined
    tokens.push({ value: token, quoted, ...(location ? { location } : {}) })
    token = ''
    tokenStart = null
    tokenEnd = null
    quoted = false
  }
  for (let index = commandLength; index < text.length; index += 1) {
    const character = text[index] ?? ''
    const location = locations[index] ?? null
    if (quote) {
      if (character === quote) {
        quote = null
      } else {
        token += character
        tokenEnd = location
      }
    } else if (character === "'" || character === '"') {
      quote = character
      quoted = true
    } else if (/\s/u.test(character)) {
      finishToken()
    } else {
      tokenStart ??= location
      token += character
      tokenEnd = location
    }
  }
  finishToken()
  return tokens
}

function stageName(
  instruction: DockerfileInstruction
): { name: string; location?: InstructionToken['location'] } | undefined {
  const tokens = instructionTokens(instruction)
  let imageIndex = 0
  while (tokens[imageIndex]?.value.startsWith('--')) {
    imageIndex += 1
  }
  if (!tokens[imageIndex]) {
    return undefined
  }
  for (let index = imageIndex + 1; index < tokens.length - 1; index += 1) {
    if (tokens[index]?.value.toLowerCase() === 'as') {
      const nameToken = tokens[index + 1]
      return nameToken ? { name: nameToken.value, location: nameToken.location } : undefined
    }
  }
  return undefined
}

function stageEndLine(
  lines: readonly string[],
  startLine: number,
  nextFromLine: number | undefined
): number {
  const endLine = nextFromLine ? nextFromLine - 1 : lines.length
  if (!nextFromLine) {
    return endLine
  }
  // Exclude boundary comments and blanks because they usually describe the next stage.
  let trimmedEnd = endLine
  while (trimmedEnd > startLine) {
    const line = lines[trimmedEnd - 1] ?? ''
    if (!isBlankLine(line) && !isCommentLine(line)) {
      break
    }
    trimmedEnd -= 1
  }
  return trimmedEnd
}

export function parseDockerfileStages(text: string): DockerfileStage[] {
  const scan = scanDockerfile(text)
  const fromInstructions = scan.instructions.filter(({ command }) => command === 'from')
  return fromInstructions.map((instruction, index) => {
    const stage = stageName(instruction)
    return {
      index,
      ...(stage
        ? {
            name: stage.name,
            ...(stage.location
              ? {
                  nameLine: stage.location.line,
                  nameStartColumn: stage.location.startColumn,
                  nameEndColumn: stage.location.endColumn
                }
              : {})
          }
        : {}),
      fromLine: instruction.startLine,
      endLine: stageEndLine(
        scan.lines,
        instruction.startLine,
        fromInstructions[index + 1]?.startLine
      )
    }
  })
}

function referenceInLine(
  line: string,
  command: string,
  column: number
): DockerfileStageReference | null {
  if (command === 'copy') {
    for (const match of line.matchAll(/(?:^|[ \t])--from=([^\s,]+)/giu)) {
      const value = match[1]
      if (!value || match.index === undefined) {
        continue
      }
      const startColumn = match.index + match[0].lastIndexOf(value) + 1
      const endColumn = startColumn + value.length
      if (column >= startColumn && column <= endColumn) {
        return { value, startColumn, endColumn }
      }
    }
    return null
  }
  for (const mount of line.matchAll(/(?:^|[ \t])--mount=([^\s]+)/giu)) {
    const mountValue = mount[1]
    if (!mountValue || mount.index === undefined) {
      continue
    }
    const mountOffset = mount[0].indexOf(mountValue)
    for (const from of mountValue.matchAll(/(?:^|,)from=([^,\s]+)/giu)) {
      const value = from[1]
      if (!value || from.index === undefined) {
        continue
      }
      const startColumn =
        mount.index + mountOffset + from.index + (from[0].startsWith(',') ? 1 : 0) + 6
      const endColumn = startColumn + value.length
      if (column >= startColumn && column <= endColumn) {
        return { value, startColumn, endColumn }
      }
    }
  }
  return null
}

export function findDockerfileStageReference(
  text: string,
  lineNumber: number,
  column: number
): DockerfileStageReference | null {
  const scan = scanDockerfile(text)
  const instruction = scan.instructionByLine.get(lineNumber)
  if (!instruction || (instruction.command !== 'copy' && instruction.command !== 'run')) {
    return null
  }
  const line = scan.lines[lineNumber - 1]
  return line === undefined ? null : referenceInLine(line, instruction.command, column)
}

export function resolveDockerfileStageReference(
  text: string,
  lineNumber: number,
  column: number
): DockerfileStage | null {
  const reference = findDockerfileStageReference(text, lineNumber, column)
  if (!reference) {
    return null
  }
  const stages = parseDockerfileStages(text)
  if (/^\d+$/u.test(reference.value)) {
    return stages[Number(reference.value)] ?? null
  }
  const name = reference.value.toLowerCase()
  return stages.find((stage) => stage.name?.toLowerCase() === name) ?? null
}
