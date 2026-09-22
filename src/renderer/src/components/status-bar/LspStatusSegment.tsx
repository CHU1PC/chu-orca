// Origin: upstream PR #14873 by moishinetzer, MIT-licensed.
import React from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useLspStatusForFile } from '@/lib/monaco-lsp/monaco-lsp-status'

/** Language-server indicator for the active editor file. */
export function LspStatusSegment({ iconOnly }: { iconOnly: boolean }): React.JSX.Element | null {
  const activeFilePath = useAppStore(
    (s) => s.openFiles.find((file) => file.id === s.activeFileId)?.filePath ?? null
  )
  const status = useLspStatusForFile(activeFilePath)
  if (!status) {
    return null
  }
  const starting = status.state === 'starting'
  const serverLabel = status.servers.map((server) => server.serverId).join(', ')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex cursor-default select-none items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={cn(
              'size-1.5 rounded-full',
              starting ? 'animate-pulse bg-workspace-status-progress' : 'bg-status-success'
            )}
          />
          {iconOnly
            ? null
            : starting
              ? translate('auto.components.status.bar.LspStatusSegment.badge', 'LSP')
              : serverLabel}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {starting
          ? translate(
              'auto.components.status.bar.LspStatusSegment.starting',
              'Language server starting…'
            )
          : [
              `${translate('auto.components.status.bar.LspStatusSegment.running', 'Language server')}: ${
                status.servers.length > 0
                  ? status.servers
                      .map(
                        (server) =>
                          `${server.serverId} - ${server.resolvedCommand} (${translate(
                            server.source === 'project'
                              ? 'auto.components.status.bar.LspStatusSegment.project'
                              : 'auto.components.status.bar.LspStatusSegment.path',
                            server.source === 'project' ? 'project' : 'PATH'
                          )})`
                      )
                      .join(', ')
                  : 'none'
              }`,
              ...(status.projectToolsSkippedReason ? [status.projectToolsSkippedReason] : [])
            ].join('\n')}
      </TooltipContent>
    </Tooltip>
  )
}
