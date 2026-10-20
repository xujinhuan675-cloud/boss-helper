import { describe, expect, it } from 'bun:test'

import { hasCompleteJobDetail } from './jobDetails'
import { parseHistoricalJobLibrary } from './jobImport'

const row = {
  name: '产品经理',
  salary: '20-30K',
  'text-desc': '3-5年',
  'job-keyword-list': 'B端产品\n数据产品',
  'job-sec-text': '负责产品规划、需求分析和方案落地。',
  'company-info': '示例公司',
  'job-name href': 'https://www.zhipin.com/job_detail/job-id_123.html',
}

describe('parseHistoricalJobLibrary', () => {
  it('maps the merged BOSS export to saved records with complete offline details', () => {
    const records = parseHistoricalJobLibrary([row], 'merged.json', '2026-10-19T00:00:00.000Z')

    expect(records).toHaveLength(1)
    const record = records[0]!
    expect(record).toMatchObject({
      encryptJobId: 'job-id_123',
      key: 'boss::job-id_123',
      firstSeenAt: '2026-10-19T00:00:00.000Z',
      lastSeenAt: '2026-10-19T00:00:00.000Z',
      detailStatus: 'complete',
      reviewStatus: 'pending',
      sourceKeywords: ['历史导入'],
      snapshot: {
        encryptJobId: 'job-id_123',
        jobName: '产品经理',
        salaryDesc: '20-30K',
        jobExperience: '3-5年',
        jobLabels: ['B端产品', '数据产品'],
        brandName: '示例公司',
      },
      detail: { jobInfo: { encryptId: 'job-id_123', postDescription: row['job-sec-text'] } },
    })
    expect(hasCompleteJobDetail(record)).toBe(true)
  })

  it('omits only rows whose saved description fails the existing completeness check', () => {
    const exceptionalRow = {
      ...row,
      'job-name href': 'https://www.zhipin.com/job_detail/job-id_456.html',
      'job-sec-text':
        '负责处理产品功能和用户咨询。协助处理充值不到账、积分异常、生成失败、账户异常等常见问题，并推动问题闭环。',
    }
    expect(
      parseHistoricalJobLibrary([row, exceptionalRow], 'merged.json').map(
        (record) => record.encryptJobId,
      ),
    ).toEqual(['job-id_123'])
  })

  it('rejects rows without a valid BOSS job link or complete description', () => {
    expect(() =>
      parseHistoricalJobLibrary(
        [{ ...row, 'job-name href': 'https://example.com/job_detail/job-id_123.html' }],
        'merged.json',
      ),
    ).toThrow('第 1 条')
    expect(() =>
      parseHistoricalJobLibrary([{ ...row, 'job-sec-text': '' }], 'merged.json'),
    ).toThrow('第 1 条')
  })
})
