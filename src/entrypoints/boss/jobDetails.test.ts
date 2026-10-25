import { describe, expect, test } from 'bun:test'
import { createRequire } from 'node:module'

import {
  assertCompleteJobDetail,
  hasCompleteJobDetail,
  jobIdFromUrl,
  readJobDetailPage,
  detailStopReason,
} from './jobDetails'

const require = createRequire(new URL('../../../packages/devlog-ui/package.json', import.meta.url))
const { JSDOM } = require('jsdom')
const url = 'https://www.zhipin.com/job_detail/one.html'
const jd = '负责产品需求分析、方案设计和项目交付，持续跟踪产品质量和用户反馈。'
const page = (html: string, href = url) => new JSDOM(html, { url: href }).window.document

describe('shared job detail validation', () => {
  test('only accepts a BOSS job URL and the exact target identity', () => {
    expect(jobIdFromUrl(url + '?ka=search')).toBe('one')
    expect(jobIdFromUrl('https://www.zhipin.com.evil.test/job_detail/one.html')).toBeNull()
    expect(jobIdFromUrl('https://evil.test/job_detail/one.html')).toBeNull()
    expect(() =>
      assertCompleteJobDetail({ jobInfo: { encryptId: 'two', postDescription: jd } }, 'one'),
    ).toThrow('ID')
    expect(() => assertCompleteJobDetail({ jobInfo: { postDescription: jd } }, 'one')).toThrow('ID')
    expect(() =>
      assertCompleteJobDetail(
        { jobInfo: { encryptId: 'one', postDescription: jd, invalidStatus: true } },
        'one',
      ),
    ).toThrow('失效')
  })

  test.each(['', '   ', '登录查看完整内容', '请登录后查看完整职位描述', '岗位职责……展开全部'])(
    'rejects incomplete content: %s',
    (text) => {
      expect(() =>
        assertCompleteJobDetail({ jobInfo: { encryptId: 'one', postDescription: text } }, 'one'),
      ).toThrow()
    },
  )

  test('reads only the job responsibilities section, excluding company and recommended jobs', () => {
    const doc = page(
      `<main class="job-detail"><section class="job-sec"><h3>职位描述</h3><div class="job-sec-text">${jd}</div></section><section class="job-sec"><h3>公司介绍</h3><div class="job-sec-text">公司正文</div></section></main><aside class="recommend"><div class="job-sec-text">其他岗位</div></aside>`,
    )
    expect(readJobDetailPage(doc)).toMatchObject({
      status: 'ready',
      jobId: 'one',
      detail: { jobInfo: { encryptId: 'one', postDescription: jd } },
    })
  })

  test('reads a JD stored in the generic text container inside its labelled section', () => {
    const doc = page(
      `<main class="job-detail"><section class="job-sec"><h3>职位描述</h3><div class="text">${jd}</div></section></main>`,
    )

    expect(readJobDetailPage(doc)).toMatchObject({
      status: 'ready',
      detail: { jobInfo: { encryptId: 'one', postDescription: jd } },
    })
  })

  test('captures the job heading and company alongside its complete description', () => {
    const doc = page(
      `<main class="job-detail"><header><h1>产品经理</h1><span class="salary">20-30K</span><a class="company-name">示例公司</a></header><section class="job-sec"><h3>职位描述</h3><div class="job-sec-text">${jd}</div></section></main>`,
    )

    expect(readJobDetailPage(doc)).toMatchObject({
      status: 'ready',
      detail: {
        jobInfo: { jobName: '产品经理', salaryDesc: '20-30K' },
        brandComInfo: { brandName: '示例公司' },
      },
    })
  })

  test('rejects content whose canonical job identity disagrees with the page URL', () => {
    const doc = page(
      `<link rel="canonical" href="https://www.zhipin.com/job_detail/two.html"><main class="job-detail"><section class="job-sec"><h3>职位描述</h3><div class="job-sec-text">${jd}</div></section></main>`,
    )
    expect(readJobDetailPage(doc)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('ID'),
    })
  })

  test('waits for actual JD, rejects restricted previews and never treats company text as a JD', () => {
    expect(readJobDetailPage(page('<main class="job-detail">加载中</main>')).status).toBe('pending')
    expect(
      readJobDetailPage(
        page(
          '<div class="job-sec"><h3>公司介绍</h3><div class="job-sec-text">公司介绍正文</div></div>',
        ),
      ).status,
    ).toBe('pending')
    expect(
      readJobDetailPage(
        page(
          `<div class="job-detail"><section class="job-sec"><h3>职位描述</h3><div class="job-sec-text">${jd}</div><button>登录查看完整内容</button></section></div>`,
        ),
      ),
    ).toMatchObject({ status: 'login_required' })
    expect(
      readJobDetailPage(
        page(
          `<div class="job-detail"><section class="job-sec"><h3>职位描述</h3><div class="job-sec-text" style="overflow:hidden;max-height:100px">${jd}</div></section></div>`,
        ),
      ).status,
    ).toBe('pending')
  })

  test('accepts a tilde in an encrypted BOSS job ID', () => {
    const id = 'c148b6c6f08287590nF-29m6Elc~'
    expect(jobIdFromUrl(`https://www.zhipin.com/job_detail/${id}.html`)).toBe(id)
  })

  test.each([
    ['请完成安全验证', 'captcha'],
    ['您的环境存在异常', 'restricted'],
    ['您的账户存在异常行为', 'restricted'],
    ['登录已失效', 'login_required'],
  ] as const)('detects a blocking prompt: %s', (text, status) => {
    expect(readJobDetailPage(page(`<h1>${text}</h1>`)).status).toBe(status)
    expect(detailStopReason(text)).toBe(status)
  })

  test('does not classify a JD mentioning verification code design as a captcha', () => {
    expect(detailStopReason('设计验证码注册登录合一的产品流程')).toBeUndefined()
  })

  test('legacy restricted previews and truncated text remain pending even if marked complete', () => {
    expect(
      hasCompleteJobDetail({
        encryptJobId: 'one',
        detailStatus: 'complete',
        detail: { jobInfo: { postDescription: '登录查看完整内容' } },
      }),
    ).toBe(false)
    expect(
      hasCompleteJobDetail({
        encryptJobId: 'one',
        detailStatus: 'complete',
        detail: { jobInfo: { postDescription: '岗位职责……' } },
      }),
    ).toBe(false)
    expect(
      hasCompleteJobDetail({
        encryptJobId: 'one',
        detailStatus: 'complete',
        detail: { jobInfo: { postDescription: jd } },
      }),
    ).toBe(true)
  })
})
