type Heredoc = { delimiter: string; allowTabs: boolean }

export type DockerfileInstruction = {
  command: string
  startLine: number
  fragments: string[]
  sourceLines: number[]
}

export type DockerfileScan = {
  lines: string[]
  instructions: DockerfileInstruction[]
  instructionByLine: Map<number, DockerfileInstruction>
}

const isCommentLine = (line: string): boolean => /^\s*#/u.test(line)
const isBlankLine = (line: string): boolean => /^\s*$/u.test(line)

function continuationFragment(
  line: string,
  escapeCharacter: string
): { fragment: string; continues: boolean } {
  const escapedEscapeCharacter = escapeCharacter.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const continuationPattern = new RegExp(
    `([^${escapedEscapeCharacter}])${escapedEscapeCharacter}[ \\t]*$|^${escapedEscapeCharacter}[ \\t]*$`,
    'u'
  )
  if (continuationPattern.test(line)) {
    const fragment = line.replace(new RegExp(`${escapedEscapeCharacter}[ \\t]*$`, 'u'), '')
    return {
      fragment,
      continues: true
    }
  }
  return { fragment: line, continues: false }
}

function directiveValue(line: string, name: string): string | null {
  const match = line.match(new RegExp(`^\\s*#\\s*${name}\\s*=\\s*(\\S)`, 'iu'))
  return match?.[1] ?? null
}

function instructionCommand(line: string): string | null {
  const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_-]*)(?:\s|$)/u)
  return match?.[1]?.toLowerCase() ?? null
}

function findHeredocs(instruction: DockerfileInstruction): Heredoc[] {
  if (instruction.command !== 'run' && instruction.command !== 'copy') {
    return []
  }
  const text = instruction.fragments.join(' ')
  const heredocs: Heredoc[] = []
  let quote: string | null = null
  for (let index = 0; index < text.length - 1; index += 1) {
    const character = text[index]
    if (quote) {
      if (character === quote && text[index - 1] !== '\\') {
        quote = null
      }
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (character !== '<' || text[index + 1] !== '<') {
      continue
    }
    let cursor = index + 2
    const allowTabs = text[cursor] === '-'
    if (allowTabs) {
      cursor += 1
    }
    while (/\s/u.test(text[cursor] ?? '')) {
      cursor += 1
    }
    const delimiterQuote = text[cursor]
    if (delimiterQuote === "'" || delimiterQuote === '"') {
      const end = text.indexOf(delimiterQuote, cursor + 1)
      if (end > cursor + 1) {
        heredocs.push({ delimiter: text.slice(cursor + 1, end), allowTabs })
        index = end
      }
      continue
    }
    let end = cursor
    while (end < text.length && !/\s/u.test(text[end] ?? '')) {
      end += 1
    }
    const delimiter = text.slice(cursor, end)
    if (delimiter.length > 0) {
      heredocs.push({ delimiter, allowTabs })
      index = cursor + delimiter.length - 1
    }
  }
  return heredocs
}

function closesHeredoc(line: string, heredoc: Heredoc): boolean {
  const candidate = heredoc.allowTabs ? line.replace(/^\t+/u, '') : line
  return candidate === heredoc.delimiter
}

export function scanDockerfile(text: string): DockerfileScan {
  const lines = text.split(/\r\n|\r|\n/u)
  const instructions: DockerfileInstruction[] = []
  const instructionByLine = new Map<number, DockerfileInstruction>()
  let escapeCharacter = '\\'
  let directivesAllowed = true
  let current: DockerfileInstruction | null = null
  let heredocs: Heredoc[] = []

  const finishInstruction = (): void => {
    if (!current) {
      return
    }
    instructions.push(current)
    heredocs = findHeredocs(current)
    current = null
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineNumber = lineIndex + 1
    const line = lines[lineIndex] ?? ''
    if (heredocs.length > 0) {
      if (closesHeredoc(line, heredocs[0])) {
        heredocs.shift()
      }
      continue
    }

    if (current) {
      if (isBlankLine(line) || isCommentLine(line)) {
        continue
      }
      current.sourceLines.push(lineNumber)
      instructionByLine.set(lineNumber, current)
      const { fragment, continues } = continuationFragment(line, escapeCharacter)
      current.fragments.push(fragment)
      if (!continues) {
        finishInstruction()
      }
      continue
    }

    if (isCommentLine(line)) {
      if (directivesAllowed) {
        const escape = directiveValue(line, 'escape')
        if (escape) {
          escapeCharacter = escape
        }
        if (/^\s*#\s*(?:syntax|escape)\s*=/iu.test(line)) {
          continue
        }
      }
      directivesAllowed = false
      continue
    }
    if (isBlankLine(line)) {
      directivesAllowed = false
      continue
    }
    directivesAllowed = false

    const command = instructionCommand(line)
    if (!command) {
      continue
    }
    current = { command, startLine: lineNumber, fragments: [], sourceLines: [lineNumber] }
    instructionByLine.set(lineNumber, current)
    const { fragment, continues } = continuationFragment(line, escapeCharacter)
    current.fragments.push(fragment)
    if (!continues) {
      finishInstruction()
    }
  }
  finishInstruction()
  return { lines, instructions, instructionByLine }
}
