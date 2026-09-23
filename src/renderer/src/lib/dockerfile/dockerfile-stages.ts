import { scanDockerfile } from './dockerfile-stage-scanner'
import type { DockerfileInstruction } from './dockerfile-stage-scanner'

export type DockerfileStage = {
  index: number
  name?: string
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

function instructionTokens(instruction: DockerfileInstruction): string[] {
  const text = instruction.fragments.join(' ')
  const commandStart = text.search(/\S/u)
  const commandLength = commandStart < 0 ? text.length : commandStart + instruction.command.length
  const body = text.slice(commandLength)
  const tokens: string[] = []
  let token = ''
  let quote: string | null = null
  for (const character of body) {
    if (quote) {
      if (character === quote) {
        quote = null
      } else {
        token += character
      }
    } else if (character === "'" || character === '"') {
      quote = character
    } else if (/\s/u.test(character)) {
      if (token) {
        tokens.push(token)
        token = ''
      }
    } else {
      token += character
    }
  }
  if (token) {
    tokens.push(token)
  }
  return tokens
}

function stageName(instruction: DockerfileInstruction): string | undefined {
  const tokens = instructionTokens(instruction)
  let imageIndex = 0
  while (tokens[imageIndex]?.startsWith('--')) {
    imageIndex += 1
  }
  if (!tokens[imageIndex]) {
    return undefined
  }
  for (let index = imageIndex + 1; index < tokens.length - 1; index += 1) {
    if (tokens[index]?.toLowerCase() === 'as') {
      return tokens[index + 1]
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
    const name = stageName(instruction)
    return {
      index,
      ...(name ? { name } : {}),
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
