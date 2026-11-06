/** @jsxImportSource react */
import {
  MATCH_DIMENSIONS,
  MATCH_DECISIONS,
  formatFilteringMessage,
  parseFiltering,
} from '@/composables/useApplying/scoring'
import type { BossJobLibraryRecord } from '@/entrypoints/boss/jobStore'

export function JobAnalysisResult({ record }: { record?: BossJobLibraryRecord }) {
  const analysis = record?.analysis
  let result: ReturnType<typeof parseFiltering> | undefined
  if (analysis?.res) {
    try {
      result = parseFiltering(JSON.stringify(analysis.res))
    } catch {
      result = undefined
    }
  }

  if (result && 'decision' in result.res) {
    return (
      <div className="space-y-2 text-sm">
        <p
          className={`font-medium ${result.res.decision === 'no_match' ? 'text-danger' : result.res.decision === 'uncertain' ? 'text-warning' : 'text-success'}`}
        >
          {MATCH_DECISIONS[result.res.decision]}
        </p>
        {result.res.reason && <p className="break-words text-muted">{result.res.reason}</p>}
        {record?.analysisFailureReason && (
          <p role="alert" className="text-danger">
            {record.analysisFailureReason}
          </p>
        )}
      </div>
    )
  }
  const legacy = result && 'dimensions' in result.res ? result.res : undefined
  const status = legacy?.hardRequirements.some((item) => item.status === 'unmet')
    ? '硬性条件不符'
    : analysis?.passed === true
      ? '达到筛选线'
      : analysis?.passed === false
        ? '低于筛选线'
        : analysis?.needsConfirmation
          ? '待确认'
          : analysis
            ? '已分析'
            : '待分析'

  return (
    <div className="space-y-4 text-sm">
      {result && legacy ? (
        <>
          <div className="flex items-end justify-between gap-4 border-b border-default pb-3">
            <div>
              <p className="text-xs text-muted">综合匹配度</p>
              <p className="flex items-baseline gap-1">
                <strong className="text-3xl font-semibold">{result.rating}</strong>
                <span className="text-muted">/100</span>
              </p>
            </div>
            <p
              className={`font-medium ${status === '硬性条件不符' || status === '低于筛选线' ? 'text-danger' : status === '待确认' ? 'text-warning' : 'text-success'}`}
            >
              {status}
            </p>
          </div>

          <section aria-label="匹配维度" className="space-y-1">
            <h3 className="font-medium">匹配维度</h3>
            {legacy.dimensions.map((dimension) => {
              const definition = MATCH_DIMENSIONS.find((item) => item.key === dimension.key)!
              return (
                <details key={dimension.key} className="border-b border-default py-2">
                  <summary className="flex cursor-pointer items-center gap-3">
                    <span className="w-28 shrink-0">{definition.label}</span>
                    <progress
                      aria-label={`${definition.label}得分`}
                      className="h-2 min-w-0 flex-1 accent-primary"
                      max={definition.maxScore}
                      value={dimension.score ?? undefined}
                    />
                    <span className="w-12 shrink-0 text-right text-muted">
                      {dimension.score ?? '待确认'}/{definition.maxScore}
                    </span>
                  </summary>
                  <p className="break-words py-2 pl-3 text-muted">{dimension.reason}</p>
                </details>
              )
            })}
          </section>

          {[
            { title: '优势', items: legacy.strengths },
            { title: '短板', items: legacy.gaps },
            {
              title: '硬性条件',
              items: legacy.hardRequirements.map(
                (item) =>
                  `${{ met: '满足', unmet: '不满足', unknown: '待确认' }[item.status]}：${item.requirement}。${item.reason}`,
              ),
            },
            { title: '待确认', items: legacy.uncertainties },
          ]
            .filter(({ items }) => items.length > 0)
            .map(({ title, items }) => (
              <details key={title} className="border-t border-default pt-3">
                <summary className="cursor-pointer font-medium">
                  {title}
                  <span className="ml-2 font-normal text-muted">{items.length} 项</span>
                </summary>
                <ul className="list-disc space-y-1 break-words py-2 pl-5 text-muted">
                  {items.map((item, index) => (
                    <li key={`${title}-${index}`}>{item}</li>
                  ))}
                </ul>
              </details>
            ))}
        </>
      ) : (
        <>
          <p className="font-medium">{status}</p>
          <p className="whitespace-pre-wrap break-words">
            {analysis?.res
              ? formatFilteringMessage(JSON.stringify(analysis.res))
              : analysis
                ? JSON.stringify(analysis, null, 2)
                : '尚无分析结果'}
          </p>
        </>
      )}
      {record?.analysisFailureReason && (
        <p role="alert" className="break-words text-danger">
          {record.analysisFailureReason}
        </p>
      )}
    </div>
  )
}
