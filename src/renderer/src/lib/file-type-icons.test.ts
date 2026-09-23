import {
  Database,
  File,
  FileArchive,
  FileBox,
  FileChartColumn,
  FileCode,
  FileCog,
  FileDiff,
  FileImage,
  FileJson,
  FileKey,
  FileLock,
  FileMusic,
  FileSliders,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo
} from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { getFileTypeIcon } from './file-type-icons'
import { detectLanguage } from './language-detect'

describe('getFileTypeIcon', () => {
  it('prefers known filenames over generic extensions', () => {
    expect(getFileTypeIcon('package.json')).toBe(FileBox)
    expect(getFileTypeIcon('/repo/tsconfig.json')).toBe(FileSliders)
    expect(getFileTypeIcon('C:\\repo\\.env.local')).toBe(FileLock)
    expect(getFileTypeIcon('README')).toBe(FileText)
    expect(getFileTypeIcon('Dockerfile.dev')).toBe(FileCog)
  })

  it.each([
    'Containerfile',
    'Containerfile.dev',
    'config/example.dockerfile',
    'config/example.containerfile'
  ])('uses the Dockerfile icon for %s', (filePath) => {
    expect(getFileTypeIcon(filePath)).toBe(FileCog)
  })

  it('keeps Dockerfile language and icon detection aligned', () => {
    const dockerfileNames = [
      'Dockerfile',
      'Containerfile',
      'dockerfile',
      'x.dockerfile',
      'x.Dockerfile',
      'x.containerfile',
      'x.Containerfile',
      'Dockerfile.dev',
      'Dockerfile.prod',
      'Containerfile.dev',
      'a/b/Dockerfile.dev',
      'C:\\repo\\Containerfile.dev',
      'Dockerfile.md',
      'dockerfile.dev',
      'DOCKERFILE.DEV',
      'containerfile',
      'containerfile.dev',
      'CONTAINERFILE'
    ]
    const nonDockerfileNames = [
      'dockerfile-notes.md',
      'Dockerfiles',
      'MyDockerfile.txt',
      'docker-compose.yml'
    ]

    for (const filePath of dockerfileNames) {
      expect(detectLanguage(filePath)).toBe('dockerfile')
      expect(getFileTypeIcon(filePath)).toBe(FileCog)
    }
    for (const filePath of nonDockerfileNames) {
      expect(detectLanguage(filePath)).not.toBe('dockerfile')
      expect(getFileTypeIcon(filePath)).not.toBe(FileCog)
    }
  })

  it('matches common code, config, document, and media extensions', () => {
    expect(getFileTypeIcon('src/App.tsx')).toBe(FileCode)
    expect(getFileTypeIcon('config/settings.jsonc')).toBe(FileJson)
    expect(getFileTypeIcon('styles/app.css')).toBe(FileType)
    expect(getFileTypeIcon('README.md')).toBe(FileText)
    expect(getFileTypeIcon('assets/logo.png')).toBe(FileImage)
    expect(getFileTypeIcon('notes.patch')).toBe(FileDiff)
  })

  it('uses more specific icons for data, security, and presentation files', () => {
    expect(getFileTypeIcon('db/schema.sql')).toBe(Database)
    expect(getFileTypeIcon('reports/summary.xlsx')).toBe(FileSpreadsheet)
    expect(getFileTypeIcon('certs/server.pem')).toBe(FileKey)
    expect(getFileTypeIcon('slides/status.pptx')).toBe(FileChartColumn)
  })

  it('handles compound archive extensions before their trailing extension', () => {
    expect(getFileTypeIcon('release.tar.gz')).toBe(FileArchive)
  })

  it('matches audio and video extensions', () => {
    expect(getFileTypeIcon('sound/theme.mp3')).toBe(FileMusic)
    expect(getFileTypeIcon('demo.mov')).toBe(FileVideo)
  })

  it('falls back to the generic file icon for unknown files', () => {
    expect(getFileTypeIcon('unknown.customtype')).toBe(File)
  })
})
