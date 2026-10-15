// @ts-nocheck -- Bun test type declarations are absent in this repository.
import { describe, expect, it, mock } from 'bun:test'

mock.module('@/message', () => ({ counter: {} }))
mock.module('@/utils/deepmerge', () => ({
  jsonClone: (value: any) => JSON.parse(JSON.stringify(value)),
}))

const { createResumeStore, normalizeResumeStore } = await import('./useResume')

function fakeStorage(initial: any = {}) {
  let value = initial
  return {
    storageGet: async () => value,
    storageSet: async (_key: string, next: any) => {
      value = JSON.parse(JSON.stringify(next))
    },
    read: () => value,
  }
}

describe('resume store', () => {
  it('migrates legacy resume text into a primary resume and keeps a stable current id', () => {
    const data = normalizeResumeStore({}, '完整旧简历', '2026-10-14T00:00:00.000Z')
    expect(data.resumes).toHaveLength(1)
    expect(data.resumes[0]).toMatchObject({
      name: '主简历',
      content: '完整旧简历',
      createdAt: '2026-10-14T00:00:00.000Z',
      updatedAt: '2026-10-14T00:00:00.000Z',
    })
    expect(data.currentResumeId).toBe(data.resumes[0].id)
  })

  it('persists create, copy, edit and explicit current selection', async () => {
    const storage = fakeStorage()
    const store = createResumeStore(storage)
    await store.init()
    const first = await store.createResume('主简历', '正文 A')
    const copy = await store.copyResume(first.id)
    await store.updateResume(copy.id, '备用简历', '正文 B')
    await store.selectResume(copy.id)
    expect(store.currentResumeId.value).toBe(copy.id)
    expect(storage.read().resumes).toHaveLength(2)
    expect(storage.read().resumes.find((item: any) => item.id === copy.id)).toMatchObject({
      name: '备用简历',
      content: '正文 B',
    })
  })

  it('requires an explicit replacement or no-resume state when deleting the current resume', async () => {
    const storage = fakeStorage()
    const store = createResumeStore(storage)
    await store.init()
    const first = await store.createResume('主简历', '正文 A')
    const second = await store.createResume('备用简历', '正文 B')
    await expect(store.deleteResume(first.id)).rejects.toThrow('请选择其他简历')
    await store.deleteResume(first.id, second.id)
    expect(store.currentResumeId.value).toBe(second.id)
    await store.deleteResume(second.id, null)
    expect(store.currentResumeId.value).toBeNull()
    expect(store.resumes.value).toEqual([])
  })

  it('keeps an explicit no-resume choice after refreshing migrated legacy data', async () => {
    const storage = fakeStorage()
    const store = createResumeStore(storage)
    await store.init('旧配置简历')
    const migrated = store.resumes.value[0]
    const migratedRefresh = createResumeStore(storage)
    await migratedRefresh.init('旧配置简历')
    expect(migratedRefresh.currentResumeId.value).toBe(migrated.id)
    await store.deleteResume(migrated.id, null)

    const refreshed = createResumeStore(storage)
    await refreshed.init('旧配置简历')
    expect(refreshed.resumes.value).toEqual([])
    expect(refreshed.currentResumeId.value).toBeNull()
  })

  it('requires an explicit no-resume choice even when deleting the last current resume', async () => {
    const storage = fakeStorage()
    const store = createResumeStore(storage)
    await store.init()
    const resume = await store.createResume('唯一简历', '正文')
    await expect(store.deleteResume(resume.id)).rejects.toThrow('请选择其他简历')
    expect(store.currentResumeId.value).toBe(resume.id)
    expect(storage.read().resumes).toHaveLength(1)
  })

  it('reads the selected resume back after refresh without changing stored history', async () => {
    const storage = fakeStorage()
    const store = createResumeStore(storage)
    await store.init()
    await store.createResume('主简历', '正文 A')
    const second = await store.createResume('备用简历', '正文 B')
    await store.selectResume(second.id)
    const refreshed = createResumeStore(storage)
    await refreshed.init('保留的旧简历')
    expect(refreshed.currentResume.value).toEqual(second)
    expect(refreshed.resumes.value).toEqual(store.resumes.value)
  })

  it('does not mutate in-memory data when persistence fails', async () => {
    const storage = fakeStorage()
    const store = createResumeStore(storage)
    await store.init()
    const first = await store.createResume('主简历', '正文 A')
    const before = JSON.parse(JSON.stringify(store.resumes.value))
    storage.storageSet = async () => {
      throw new Error('保存失败')
    }
    await expect(store.updateResume(first.id, '已修改', '正文 B')).rejects.toThrow('保存失败')
    await expect(store.selectResume(null)).rejects.toThrow('保存失败')
    await expect(store.deleteResume(first.id, null)).rejects.toThrow('保存失败')
    expect(store.resumes.value).toEqual(before)
    expect(store.currentResumeId.value).toBe(first.id)
  })
})
