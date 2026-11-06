// @ts-nocheck
import { expect, test } from 'bun:test'
import { createRequire } from 'node:module'

import { installJobDetailReader } from './jobDetailContent'
import { DETAIL_MESSAGE } from './jobDetails'

const require = createRequire(new URL('../../../packages/devlog-ui/package.json', import.meta.url))
const { JSDOM } = require('jsdom')

test('waits for stable real content before manual backfill and ignores foreign senders', async () => {
  const dom = new JSDOM(
    '<main class="job-detail"><section class="job-sec"><h3>职位描述</h3><div class="job-sec-text"></div></section></main>',
    { url: 'https://www.zhipin.com/job_detail/one.html' },
  )
  let handler, tick
  const sent = []
  const now = Date.now
  const interval = globalThis.setInterval
  let time = now()
  Date.now = () => time
  globalThis.setInterval = (callback) => {
    tick = callback
    return interval(() => {}, 60_000)
  }
  try {
    installJobDetailReader(
      {
        id: 'own',
        onMessage: {
          addListener: (fn) => {
            handler = fn
          },
        },
        sendMessage: async (message) => {
          sent.push(message)
          return { ok: true }
        },
      },
      dom.window.document,
    )
    expect(handler({ type: DETAIL_MESSAGE, jobId: 'one' }, { id: 'foreign' })).toBeUndefined()
    const scroller = dom.window.document.documentElement
    Object.defineProperty(dom.window.document, 'scrollingElement', { value: scroller })
    Object.defineProperty(scroller, 'scrollHeight', { value: 1500 })
    dom.window.scrollTo = ({ top }) => {
      scroller.scrollTop = Math.min(top, 700)
    }
    const scroll = (jobId, position) =>
      handler({ type: DETAIL_MESSAGE, action: 'captureScroll', jobId, position }, { id: 'own' })
    expect(await scroll('other', 'next')).toMatchObject({ status: 'failed' })
    expect(scroller.scrollTop).toBe(0)
    expect(await scroll('one', 'top')).toMatchObject({
      status: 'scrolled',
      jobId: 'one',
      scrollY: 0,
      viewportHeight: 768,
    })
    expect(await scroll('one', 'next')).toMatchObject({ status: 'scrolled', scrollY: 672 })
    expect(await scroll('one', 'next')).toMatchObject({ status: 'scrolled', scrollY: 700 })
    expect(await scroll('one', 'top')).toMatchObject({ status: 'scrolled', scrollY: 0 })
    expect(await handler({ type: DETAIL_MESSAGE, jobId: 'one' }, { id: 'own' })).toMatchObject({
      status: 'pending',
    })
    const body = dom.window.document.querySelector('.job-sec-text')
    body.textContent = '负责产品需求分析、方案设计和项目交付，持续跟踪产品质量和用户反馈。'
    tick()
    expect(sent).toHaveLength(0)
    time += 900
    tick()
    await Promise.resolve()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      type: DETAIL_MESSAGE,
      action: 'passive',
      page: { status: 'ready', jobId: 'one' },
    })
    expect(await handler({ type: DETAIL_MESSAGE, jobId: 'other' }, { id: 'own' })).toMatchObject({
      status: 'failed',
    })
  } finally {
    dom.window.dispatchEvent(new dom.window.Event('pagehide'))
    dom.window.close()
    Date.now = now
    globalThis.setInterval = interval
  }
})
