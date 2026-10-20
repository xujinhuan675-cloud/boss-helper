import { assertCompleteJobDetail, jobIdFromUrl } from './jobDetails'
import type { BossJobLibraryRecord } from './jobStore'
import type { BossZpDetailData, BossZpJobItemData } from './types'

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function parseHistoricalJobLibrary(
  value: unknown,
  batch: string,
  importedAt = new Date().toISOString(),
): BossJobLibraryRecord[] {
  if (!Array.isArray(value) || !value.length) throw new Error('JSON 必须是非空岗位数组')

  const ids = new Set<string>()
  return value
    .map<BossJobLibraryRecord | null>((entry, index) => {
      const row = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : null
      const url = text(row?.['job-name href'])
      const encryptJobId = jobIdFromUrl(url)
      const jobName = text(row?.name)
      const postDescription = text(row?.['job-sec-text'])
      if (!row || !encryptJobId || !jobName || !postDescription || ids.has(encryptJobId))
        throw new Error(`第 ${index + 1} 条岗位链接、名称、描述无效或重复`)
      ids.add(encryptJobId)

      const jobLabels = text(row['job-keyword-list'])
        .split(/\r?\n/)
        .map((label) => label.trim())
        .filter(Boolean)
      const detail = {
        jobInfo: { encryptId: encryptJobId, jobName, positionName: jobName, postDescription },
      } as unknown as BossZpDetailData
      try {
        assertCompleteJobDetail(detail, encryptJobId)
      } catch {
        return null
      }

      const snapshot = {
        securityId: '',
        bossAvatar: '',
        bossCert: 0,
        encryptBossId: '',
        bossName: '',
        bossTitle: '',
        goldHunter: 0,
        bossOnline: false,
        encryptJobId,
        expectId: 0,
        jobName,
        lid: '',
        salaryDesc: text(row.salary),
        jobLabels,
        jobValidStatus: 0,
        iconWord: '',
        skills: jobLabels,
        afterNameIcons: [],
        beforeNameIcons: [],
        showTopPosition: false,
        jobExperience: text(row['text-desc']),
        daysPerWeekDesc: '',
        leastMonthDesc: '',
        jobDegree: '',
        cityName: '',
        areaDistrict: '',
        businessDistrict: '',
        jobType: 0,
        proxyJob: 0,
        proxyType: 0,
        anonymous: 0,
        outland: 0,
        optimal: 0,
        itemId: 0,
        city: 0,
        isShield: 0,
        atsDirectPost: false,
        gps: { longitude: 0, latitude: 0 },
        encryptBrandId: '',
        brandName: text(row['company-info']),
        brandLogo: '',
        brandStageName: '',
        brandIndustry: '',
        brandScaleName: '',
        welfareList: [],
        industry: 0,
        contact: false,
      } as BossZpJobItemData

      return {
        encryptJobId,
        key: `boss::${encryptJobId}`,
        snapshot,
        sourceKeywords: ['历史导入'],
        batches: [batch],
        firstSeenAt: importedAt,
        lastSeenAt: importedAt,
        detailStatus: 'complete',
        analysisStatus: 'pending',
        reviewStatus: 'pending',
        sendStatus: 'pending',
        detail,
        detailRetryCount: 0,
        jobUrl: `https://www.zhipin.com/job_detail/${encodeURIComponent(encryptJobId)}.html`,
      }
    })
    .filter((record): record is BossJobLibraryRecord => record !== null)
}
