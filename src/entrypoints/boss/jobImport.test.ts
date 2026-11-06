import { describe, expect, it } from 'bun:test'

import { hasCompleteJobDetail } from './jobDetails'
import { parseHistoricalJobLibrary, parseJobLibraryCsv } from './jobImport'

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

describe('parseJobLibraryCsv', () => {
  it('imports exported columns by header, including quoted commas and line breaks', () => {
    const csv =
      '\uFEFF岗位名称,公司,薪资,地点,匹配度,跟进阶段,采集时间,岗位链接,职位描述\r\n' +
      '"产品经理","公司, 示例","20-30K","上海 路 浦东新区","82/100","面试","2026-10-19",' +
      '"https://www.zhipin.com/job_detail/job-id_123.html","负责产品规划，\r\n推动方案落地"'

    const records = parseJobLibraryCsv(csv, 'export.csv', '2026-10-19T00:00:00.000Z')

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      encryptJobId: 'job-id_123',
      detailStatus: 'complete',
      snapshot: {
        jobName: '产品经理',
        brandName: '公司, 示例',
        salaryDesc: '20-30K',
        cityName: '上海 路 浦东新区',
      },
      detail: { jobInfo: { postDescription: '负责产品规划，\r\n推动方案落地' } },
    })
  })

  it('imports older exported rows without a JD as pending details', () => {
    const records = parseJobLibraryCsv(
      '岗位名称,公司,薪资,地点,岗位链接\n产品经理,示例公司,20-30K,上海,https://www.zhipin.com/job_detail/job-id_123.html',
      'older.csv',
      '2026-10-19T00:00:00.000Z',
    )

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      encryptJobId: 'job-id_123',
      detailStatus: 'pending',
      snapshot: { jobName: '产品经理', brandName: '示例公司', salaryDesc: '20-30K' },
    })
    expect(records[0]?.detail).toBeUndefined()
  })
})
