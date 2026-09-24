import { describe, expect, it } from 'vitest'
import {
  findDockerfileStageReference,
  parseDockerfileStages,
  resolveDockerfileStageReference
} from './dockerfile-stages'

describe('parseDockerfileStages', () => {
  it('ignores a heredoc containing FROM', () => {
    expect(
      parseDockerfileStages('FROM node\nRUN <<EOF\nFROM text\nEOF\nFROM base AS final')
    ).toEqual([
      { index: 0, fromLine: 1, endLine: 4 },
      {
        index: 1,
        name: 'final',
        nameLine: 5,
        nameStartColumn: 14,
        nameEndColumn: 19,
        fromLine: 5,
        endLine: 5
      }
    ])
  })

  it('ignores a continued RUN line containing FROM', () => {
    expect(parseDockerfileStages('FROM node\nRUN echo hello \\\n    FROM-looking text')).toEqual([
      { index: 0, fromLine: 1, endLine: 3 }
    ])
  })

  it('parses FROM --platform=$BUILDPLATFORM node:24 AS build', () => {
    expect(parseDockerfileStages('FROM --platform=$BUILDPLATFORM node:24 AS build')).toEqual([
      {
        index: 0,
        name: 'build',
        nameLine: 1,
        nameStartColumn: 43,
        nameEndColumn: 48,
        fromLine: 1,
        endLine: 1
      }
    ])
  })

  it('parses lowercase from ... as ...', () => {
    expect(parseDockerfileStages('from alpine as Base')).toEqual([
      {
        index: 0,
        name: 'Base',
        nameLine: 1,
        nameStartColumn: 16,
        nameEndColumn: 20,
        fromLine: 1,
        endLine: 1
      }
    ])
  })

  it('records the stage name location', () => {
    const text = [
      '# syntax=docker/dockerfile:1',
      'FROM node:24 AS deps',
      'RUN echo deps',
      '',
      '# build stage',
      '',
      'FROM deps AS build'
    ].join('\n')
    expect(parseDockerfileStages(text)[1]).toMatchObject({
      name: 'build',
      nameLine: 7,
      nameStartColumn: 14,
      nameEndColumn: 19
    })
  })

  it('records the stage name location on a continuation line', () => {
    const text = ['FROM node:24 \\', '  AS deps'].join('\n')
    expect(parseDockerfileStages(text)).toEqual([
      {
        index: 0,
        name: 'deps',
        nameLine: 2,
        nameStartColumn: 6,
        nameEndColumn: 10,
        fromLine: 1,
        endLine: 2
      }
    ])
  })

  it('parses a continued FROM line', () => {
    expect(parseDockerfileStages('FROM \\\n  gcr.io/distroless/nodejs24')).toEqual([
      { index: 0, fromLine: 1, endLine: 2 }
    ])
  })

  it('does not continue a line ending in two backslashes', () => {
    expect(parseDockerfileStages('FROM a\nRUN echo a\\\\\nFROM b')).toHaveLength(2)
  })

  it('continues a line ending in a backslash and trailing spaces or tabs', () => {
    expect(parseDockerfileStages('FROM a\nRUN echo a\\  \t\nFROM text')).toHaveLength(1)
  })

  it('continues a line containing only a backslash', () => {
    expect(parseDockerfileStages('FROM a\nRUN echo a \\\n\\\nFROM text')).toHaveLength(1)
  })

  it('parses a single-stage file', () => {
    expect(parseDockerfileStages('# syntax=docker/dockerfile:1\nFROM node\nRUN echo ok')).toEqual([
      { index: 0, fromLine: 2, endLine: 3 }
    ])
  })

  it('parses an empty file', () => {
    expect(parseDockerfileStages('')).toEqual([])
    expect(parseDockerfileStages('  \n# comment\n')).toEqual([])
  })

  it('uses a backtick escape directive', () => {
    expect(parseDockerfileStages('# escape=`\nFROM `\n  node:24 AS build')).toEqual([
      {
        index: 0,
        name: 'build',
        nameLine: 3,
        nameStartColumn: 14,
        nameEndColumn: 19,
        fromLine: 2,
        endLine: 3
      }
    ])
  })

  it('does not continue a backtick-escaped line ending in two backticks', () => {
    expect(parseDockerfileStages('# escape=`\nFROM a\nRUN echo a``\nFROM b')).toHaveLength(2)
  })

  it('continues a backtick-escaped line ending in one backtick', () => {
    expect(parseDockerfileStages('# escape=`\nFROM a\nRUN echo a`\nFROM text')).toHaveLength(1)
  })

  it('skips a <<- heredoc body', () => {
    expect(
      parseDockerfileStages('FROM node\nRUN <<-EOF\n\tFROM text\n\tEOF\nFROM base')
    ).toHaveLength(2)
  })

  it('skips a quoted heredoc delimiter and multiple heredocs', () => {
    expect(
      parseDockerfileStages('FROM node\nCOPY <<a <<"b"\nFROM text\na\nFROM text\nb\nFROM base')
    ).toHaveLength(2)
  })

  it('skips comment lines inside a continuation', () => {
    expect(parseDockerfileStages('FROM \\\n# comment\n  node AS build')).toEqual([
      {
        index: 0,
        name: 'build',
        nameLine: 3,
        nameStartColumn: 11,
        nameEndColumn: 16,
        fromLine: 1,
        endLine: 3
      }
    ])
  })

  it('resolves numeric --from references', () => {
    const text = 'FROM node\nRUN echo one\nFROM base\nCOPY --from=0 /a /b'
    const column = text.split('\n')[3].indexOf('0') + 1
    expect(resolveDockerfileStageReference(text, 4, column)).toEqual({
      index: 0,
      fromLine: 1,
      endLine: 2
    })
  })

  it('returns null for an unknown --from reference', () => {
    const text = 'FROM node\nCOPY --from=nginx:latest /a /b'
    const column = text.split('\n')[1].indexOf('nginx') + 1
    expect(resolveDockerfileStageReference(text, 2, column)).toBeNull()
  })

  it('resolves RUN --mount from=', () => {
    const text = 'FROM node AS build\nRUN --mount=type=cache,from=build,target=/x echo ok'
    const column = text.split('\n')[1].indexOf('build') + 1
    expect(resolveDockerfileStageReference(text, 2, column)?.index).toBe(0)
  })

  it('matches stage names case-insensitively', () => {
    const text = 'FROM node AS Build\nCOPY --from=build /a /b'
    const column = text.split('\n')[1].indexOf('build') + 1
    expect(resolveDockerfileStageReference(text, 2, column)?.name).toBe('Build')
  })

  it('excludes trailing blank and comment lines before the next FROM from folding end', () => {
    const text = 'FROM node\nRUN echo one\n\n# describes next stage\nFROM base\nRUN echo two'
    expect(parseDockerfileStages(text)).toEqual([
      { index: 0, fromLine: 1, endLine: 2 },
      { index: 1, fromLine: 5, endLine: 6 }
    ])
  })

  it('only finds references on an instruction line', () => {
    const text = 'FROM node\nRUN <<EOF\nCOPY --from=build /a /b\nEOF'
    expect(findDockerfileStageReference(text, 3, 18)).toBeNull()
  })
})
