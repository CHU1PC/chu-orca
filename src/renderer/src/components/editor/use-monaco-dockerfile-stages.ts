import { useEffect } from 'react'
import type { editor } from 'monaco-editor'
import { attachDockerfileStageDecorations } from '@/lib/dockerfile/dockerfile-stage-decorations'

export function useMonacoDockerfileStages(params: {
  mountedEditor: editor.IStandaloneCodeEditor | null
  language: string
}): void {
  const { mountedEditor, language } = params

  useEffect(() => {
    if (!mountedEditor || language !== 'dockerfile') {
      return
    }
    const model = mountedEditor.getModel()
    if (!model || model.isDisposed()) {
      return
    }
    return attachDockerfileStageDecorations(mountedEditor, model)
  }, [mountedEditor, language])
}
