/** @jsxImportSource react */
// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { expect, mock, test } from 'bun:test'

import { renderToStaticMarkup } from 'react-dom/server'

import * as scoring from '../composables/useApplying/scoring'
import type { BossJobLibraryRecord } from '../entrypoints/boss/jobStore'

await mock.module('@/composables/useApplying/scoring', () => scoring)
const { JobAnalysisResult } = await import('./JobAnalysisResult')

test('shows a compact match overview with expandable scoring evidence', () => {
  const record = {
    analysis: {
      rating: 78,
      passed: null,
      needsConfirmation: true,
      res: {
        dimensions: [
          { key: 'responsibilities', score: 23, reason: '项目经历覆盖主要职责' },
          { key: 'skills', score: 20, reason: '熟悉主流 AI 工具' },
          { key: 'experience', score: 20, reason: '有相关产品经验' },
          { key: 'industry', score: 5, reason: '行业背景部分相关' },
          { key: 'preferences', score: 10, reason: '未提出冲突偏好' },
        ],
        strengths: ['具备 AI 产品落地经验'],
        gaps: ['缺少履约流程优化案例'],
        hardRequirements: [{ requirement: '本科及以上', status: 'met', reason: '简历已列明学历' }],
        uncertainties: ['实际工作地点待确认'],
      },
    },
  } as BossJobLibraryRecord

  const markup = renderToStaticMarkup(<JobAnalysisResult record={record} />)

  expect(markup).toContain('78')
  expect(markup).toContain('待确认')
  expect(markup).toContain('匹配维度')
  expect(markup).toContain('<progress')
  expect(markup).toContain('<details')
  expect(markup).toContain('实际工作地点待确认')
})

test('shows an empty state when no analysis is available', () => {
  const markup = renderToStaticMarkup(<JobAnalysisResult />)
  expect(markup).toContain('尚无分析结果')
})
