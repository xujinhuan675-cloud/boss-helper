// @ts-nocheck
import { beforeEach, expect, test } from 'bun:test'

import { DetailTabAccess } from './detailAccess'
import { JobLibraryStorage } from './jobLibraryStorage'
import { AUTO_CAPTURE_STORAGE_KEY, JOB_LIBRARY_STORAGE_KEY, mergeJobRecords } from './jobStore'

let access, tabs, data, navigations, removed, created, now, reply, library
// Bun's reject matcher is async at runtime but typed as a synchronous matcher.
const rejectsWith = (promise, message) =>
  Promise.resolve(
    message === undefined
      ? expect(promise).rejects.toThrow()
      : expect(promise).rejects.toThrow(message),
  )

beforeEach(() => {
  data = new Map()
  tabs = new Map([
    [1, { id: 1, url: 'https://www.zhipin.com/web/geek/jobs' }],
    [2, { id: 2, url: 'https://www.zhipin.com/job_detail/user.html' }],
  ])
  navigations = []
  removed = []
  created = 0
  now = Date.now()
  reply = (id) => ({
    status: 'ready',
    jobId: id,
    detail: { jobInfo: { encryptId: id, postDescription: 'A complete job description' } },
  })
  const storage = {
    getItem: async (key) => structuredClone(data.get(key) ?? null),
    setItem: async (key, value) => {
      data.set(key, structuredClone(value))
    },
  }
  const api = {
    get: async (id) => {
      if (!tabs.has(id)) throw new Error('No tab')
      return tabs.get(id)
    },
    create: async (options) => {
      const tab = { id: 100 + created++, ...options }
      tabs.set(tab.id, tab)
      return tab
    },
    update: async (id, options) => {
      navigations.push(id)
      Object.assign(tabs.get(id), options)
      return tabs.get(id)
    },
    remove: async (id) => {
      removed.push(id)
      tabs.delete(id)
    },
    sendMessage: async (id) =>
      reply(new URL(tabs.get(id).url).pathname.split('/').at(-1).replace('.html', '')),
  }
  library = new JobLibraryStorage(storage)
  access = new DetailTabAccess(api, storage, library)
  data.set(
    JOB_LIBRARY_STORAGE_KEY,
    mergeJobRecords(
      [],
      ['one', 'two', 'user'].map((encryptJobId) => ({ encryptJobId })),
      '',
      '',
    ).records,
  )
})
const claim = (token = 'a', owner = 1) =>
  access.command({ type: 'claim', token, deadline: now + 60_000 }, owner)
const visit = (jobId, token = 'a') =>
  access.command(
    { type: 'visit', token, jobId, url: `https://www.zhipin.com/job_detail/${jobId}.html` },
    1,
  )

test('reuses one owned tab serially and never touches existing user tabs', async () => {
  await claim()
  await visit('one')
  expect(await access.command({ type: 'read', token: 'a', jobId: 'one' }, 1)).toMatchObject({
    status: 'ready',
    jobId: 'one',
  })
  await visit('two')
  expect(created).toBe(1)
  expect(navigations).toEqual([100])
  await access.command({ type: 'release', token: 'a' }, 1)
  expect(removed).toEqual([100])
  expect(tabs.get(2).url).toBe('https://www.zhipin.com/job_detail/user.html')
})

test('rejects another workflow, wrong owner, mismatched URL and expired session before navigation', async () => {
  await claim()
  await rejectsWith(claim('b'))
  await rejectsWith(
    access.command(
      { type: 'visit', token: 'a', jobId: 'one', url: 'https://evil.test/job_detail/one.html' },
      1,
    ),
  )
  await rejectsWith(access.command({ type: 'renew', token: 'a' }, 2))
  const realNow = Date.now
  Date.now = () => now + 60_001
  try {
    await rejectsWith(visit('one'), '时限')
  } finally {
    Date.now = realNow
  }
  expect(created).toBe(0)
})

test('closed tab interrupts without creating a replacement and a new worker retains ownership', async () => {
  await claim()
  await visit('one')
  tabs.delete(100)
  await rejectsWith(visit('two'), '关闭')
  expect(created).toBe(1)
})

test('redirect identity and a restriction stop further navigation', async () => {
  await claim()
  await visit('one')
  reply = () => ({ status: 'restricted', error: '您的环境存在异常' })
  expect(await access.command({ type: 'read', token: 'a', jobId: 'one' }, 1)).toMatchObject({
    status: 'restricted',
  })
  await rejectsWith(visit('two'), '环境')
  expect(navigations).toEqual([])
})

test('rejects a detail reporting a different job ID', async () => {
  await claim()
  await visit('one')
  reply = () => ({
    status: 'ready',
    jobId: 'two',
    detail: { jobInfo: { encryptId: 'two', postDescription: 'Wrong job' } },
  })
  await rejectsWith(access.command({ type: 'read', token: 'a', jobId: 'one' }, 1), 'ID')
})

test('rejects a ready response when the browser has redirected to another job', async () => {
  await claim()
  await visit('one')
  tabs.get(100).url = 'https://www.zhipin.com/job_detail/two.html'
  reply = () => ({
    status: 'ready',
    jobId: 'one',
    detail: { jobInfo: { encryptId: 'one', postDescription: 'Stale JD' } },
  })
  await rejectsWith(access.command({ type: 'read', token: 'a', jobId: 'one' }, 1), 'ID')
})

test('closing the owner releases only the dedicated tab', async () => {
  await claim()
  await visit('one')
  await access.tabRemoved(1)
  expect(removed).toEqual([100])
  expect(tabs.has(2)).toBe(true)
  await rejectsWith(visit('two'), '所有权')
})

test('manual detail completion preserves current review/send and cannot bypass history ownership', async () => {
  data.set(AUTO_CAPTURE_STORAGE_KEY, true)
  data.get(JOB_LIBRARY_STORAGE_KEY)[2].reviewStatus = 'approved'
  data.get(JOB_LIBRARY_STORAGE_KEY)[2].sendStatus = 'sent'
  await access.passive(reply('user'), { id: 2, url: tabs.get(2).url })
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)[2]).toMatchObject({
    detailStatus: 'complete',
    reviewStatus: 'approved',
    sendStatus: 'sent',
  })
  await rejectsWith(access.passive(reply('one'), { id: 2, url: tabs.get(2).url }), 'ID')
  await library.historyDetails({ type: 'start', token: 'history' })
  tabs.get(2).url = 'https://www.zhipin.com/job_detail/one.html'
  await rejectsWith(access.passive(reply('one'), { id: 2, url: tabs.get(2).url }), '另一页面')
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0].detailStatus).toBe('pending')
})

test('captures a newly opened detail page so the workbench can analyze it', async () => {
  data.set(AUTO_CAPTURE_STORAGE_KEY, true)
  tabs.set(3, { id: 3, url: 'https://www.zhipin.com/job_detail/fresh.html' })
  const detail = {
    jobInfo: {
      encryptId: 'fresh',
      jobName: '产品经理',
      positionName: '产品经理',
      salaryDesc: '15-25K',
      experienceName: '3-5年',
      degreeName: '本科',
      locationName: '北京',
      postDescription: '负责产品需求分析、方案设计和项目交付，持续跟踪产品质量和用户反馈。',
    },
    bossInfo: { name: '招聘负责人', title: 'HR', brandName: '示例公司' },
    brandComInfo: { brandName: '示例公司' },
  }

  expect(
    await access.passive(
      { status: 'ready', jobId: 'fresh', detail },
      { id: 3, url: tabs.get(3).url },
    ),
  ).toEqual({ status: 'saved' })

  expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toContainEqual(
    expect.objectContaining({
      encryptJobId: 'fresh',
      detailStatus: 'complete',
      analysisStatus: 'pending',
      snapshot: expect.objectContaining({
        encryptJobId: 'fresh',
        jobName: '产品经理',
        brandName: '示例公司',
        salaryDesc: '15-25K',
      }),
      detail,
    }),
  )
})

test('fills saved jobs on visited detail pages with auto capture off without capturing new jobs', async () => {
  const before = structuredClone(data.get(JOB_LIBRARY_STORAGE_KEY))
  for (const enabled of [undefined, false]) {
    data.set(JOB_LIBRARY_STORAGE_KEY, structuredClone(before))
    if (enabled === undefined) data.delete(AUTO_CAPTURE_STORAGE_KEY)
    else data.set(AUTO_CAPTURE_STORAGE_KEY, enabled)
    tabs.get(2).url = 'https://www.zhipin.com/job_detail/fresh.html'
    expect(await access.passive(reply('fresh'), { id: 2, url: tabs.get(2).url })).toEqual({
      status: 'disabled',
    })
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toEqual(before)

    tabs.get(2).url = 'https://www.zhipin.com/job_detail/user.html'
    expect(await access.passive(reply('user'), { id: 2, url: tabs.get(2).url })).toEqual({
      status: 'saved',
    })
    expect(
      data.get(JOB_LIBRARY_STORAGE_KEY).find((record) => record.encryptJobId === 'user'),
    ).toMatchObject({ detailStatus: 'complete', detail: reply('user').detail })
    expect(data.get(JOB_LIBRARY_STORAGE_KEY)).toHaveLength(before.length)
  }
})

test('explicit managed detail tasks can still read with auto capture disabled', async () => {
  data.set(AUTO_CAPTURE_STORAGE_KEY, false)
  await claim()
  await visit('one')
  expect(await access.command({ type: 'read', token: 'a', jobId: 'one' }, 1)).toMatchObject({
    status: 'ready',
    jobId: 'one',
  })
  expect(await access.passive(reply('one'), { id: 100, url: tabs.get(100).url })).toEqual({
    status: 'managed',
  })
  expect(data.get(JOB_LIBRARY_STORAGE_KEY)[0].detailStatus).toBe('pending')
})
