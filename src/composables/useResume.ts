import { computed, ref } from 'vue'

import { counter } from '@/message'
import { jsonClone } from '@/utils/deepmerge'

export const RESUME_STORAGE_KEY = 'local:boss-helper:resumes:v1'

export type ResumeRecord = {
  id: string
  name: string
  content: string
  createdAt: string
  updatedAt: string
}

export type ResumeStoreData = {
  resumes: ResumeRecord[]
  currentResumeId: string | null
}

type ResumeStorage = {
  storageGet<T>(key: string, defaultValue: T): Promise<T>
  storageSet<T>(key: string, value: T): Promise<unknown>
}

const nowIso = () => new Date().toISOString()

function newId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `resume_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  )
}

export function normalizeResumeStore(
  stored: Partial<ResumeStoreData> | null | undefined,
  legacyText = '',
  now = nowIso(),
): ResumeStoreData {
  const resumes = Array.isArray(stored?.resumes)
    ? stored.resumes.filter(
        (resume): resume is ResumeRecord =>
          !!resume &&
          typeof resume.id === 'string' &&
          typeof resume.name === 'string' &&
          typeof resume.content === 'string' &&
          typeof resume.createdAt === 'string' &&
          typeof resume.updatedAt === 'string',
      )
    : []
  if (!Array.isArray(stored?.resumes) && legacyText.trim()) {
    const id = newId()
    return {
      resumes: [
        {
          id,
          name: '主简历',
          content: legacyText,
          createdAt: now,
          updatedAt: now,
        },
      ],
      currentResumeId: id,
    }
  }
  const currentResumeId = resumes.some((resume) => resume.id === stored?.currentResumeId)
    ? (stored?.currentResumeId ?? null)
    : null
  return { resumes, currentResumeId }
}

export function createResumeStore(storage: ResumeStorage = counter) {
  const resumes = ref<ResumeRecord[]>([])
  const currentResumeId = ref<string | null>(null)
  const initialized = ref(false)
  const currentResume = computed(() =>
    resumes.value.find((resume) => resume.id === currentResumeId.value),
  )

  async function persist(nextResumes: ResumeRecord[], nextCurrentResumeId: string | null) {
    const snapshot: ResumeStoreData = jsonClone({
      resumes: nextResumes,
      currentResumeId: nextCurrentResumeId,
    })
    await storage.storageSet(RESUME_STORAGE_KEY, snapshot)
    resumes.value = snapshot.resumes
    currentResumeId.value = snapshot.currentResumeId
  }

  async function init(legacyText = '') {
    const stored = await storage.storageGet<Partial<ResumeStoreData>>(RESUME_STORAGE_KEY, {})
    const normalized = normalizeResumeStore(stored, legacyText)
    if (
      stored !== null &&
      stored !== undefined &&
      (typeof stored !== 'object' ||
        Array.isArray(stored) ||
        ('resumes' in stored &&
          (!Array.isArray(stored.resumes) || normalized.resumes.length !== stored.resumes.length)))
    ) {
      throw new Error('简历存储格式无效，原有数据已保留')
    }
    if (!Array.isArray(stored?.resumes) && normalized.resumes.length) {
      await storage.storageSet(RESUME_STORAGE_KEY, jsonClone(normalized))
    }
    resumes.value = jsonClone(normalized.resumes)
    currentResumeId.value = normalized.currentResumeId
    initialized.value = true
    return normalized
  }

  async function createResume(name: string, content: string) {
    const at = nowIso()
    const resume: ResumeRecord = {
      id: newId(),
      name: name.trim() || '未命名简历',
      content,
      createdAt: at,
      updatedAt: at,
    }
    await persist([...resumes.value, resume], currentResumeId.value ?? resume.id)
    return resume
  }

  async function updateResume(id: string, name: string, content: string) {
    const existing = resumes.value.find((resume) => resume.id === id)
    if (!existing) throw new Error('简历不存在')
    const updated = {
      ...existing,
      name: name.trim() || '未命名简历',
      content,
      updatedAt: nowIso(),
    }
    await persist(
      resumes.value.map((resume) => (resume.id === id ? updated : resume)),
      currentResumeId.value,
    )
    return updated
  }

  async function copyResume(id: string) {
    const source = resumes.value.find((resume) => resume.id === id)
    if (!source) throw new Error('简历不存在')
    return createResume(`${source.name} 副本`, source.content)
  }

  async function selectResume(id: string | null) {
    if (id !== null && !resumes.value.some((resume) => resume.id === id)) {
      throw new Error('简历不存在')
    }
    await persist(resumes.value, id)
  }

  async function deleteResume(id: string, replacementId?: string | null) {
    const existing = resumes.value.find((resume) => resume.id === id)
    if (!existing) throw new Error('简历不存在')
    const isCurrent = currentResumeId.value === id
    const remaining = resumes.value.filter((resume) => resume.id !== id)
    if (isCurrent && replacementId === undefined) {
      throw new Error('删除当前简历前请选择其他简历或明确进入无简历状态')
    }
    if (replacementId !== undefined && replacementId !== null) {
      if (replacementId === id || !remaining.some((resume) => resume.id === replacementId)) {
        throw new Error('请选择有效的替代简历')
      }
    }
    const nextCurrent = isCurrent ? (replacementId ?? null) : currentResumeId.value
    await persist(remaining, nextCurrent)
  }

  return {
    resumes,
    currentResumeId,
    initialized,
    currentResume,
    init,
    createResume,
    updateResume,
    copyResume,
    selectResume,
    deleteResume,
  }
}

const resumeStore = createResumeStore()

export const useResumes = () => resumeStore
