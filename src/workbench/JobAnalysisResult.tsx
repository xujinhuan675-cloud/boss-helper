/** @jsxImportSource react */
import { formatFilteringMessage } from '@/composables/useApplying/scoring'
import type { BossJobLibraryRecord } from '@/entrypoints/boss/jobStore'

export function JobAnalysisResult({ record }: { record?: BossJobLibraryRecord }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="font-medium">
        {record?.analysis?.passed === true
          ? '通过筛选'
          : record?.analysis?.passed === false
            ? '未通过筛选'
            : record?.analysis?.needsConfirmation
              ? '待确认'
              : '待分析'}
      </p>
      <p className="whitespace-pre-wrap break-words">
        {record?.analysis?.res
          ? formatFilteringMessage(JSON.stringify(record.analysis.res))
          : record?.analysis
            ? JSON.stringify(record.analysis, null, 2)
            : '尚无分析结果'}
      </p>
      {record?.analysisFailureReason && (
        <p role="alert" className="break-words text-danger">
          {record.analysisFailureReason}
        </p>
      )}
    </div>
  )
}
