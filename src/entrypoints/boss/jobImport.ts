import { assertCompleteJobDetail, jobIdFromUrl } from './jobDetails'
import type { BossJobLibraryRecord } from './jobStore'
import type { BossZpDetailData, BossZpJobItemData } from './types'

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseJobRows(
  value: unknown,
  batch: string,
  importedAt: string,
  allowIncompleteDetails = false,
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
      if (
        !row ||
        !encryptJobId ||
        !jobName ||
        (!postDescription && !allowIncompleteDetails) ||
        ids.has(encryptJobId)
      )
        throw new Error(`第 ${index + 1} 条岗位链接、名称、描述无效或重复`)
      ids.add(encryptJobId)

      const jobLabels = text(row['job-keyword-list'])
        .split(/\r?\n/)
        .map((label) => label.trim())
        .filter(Boolean)
      let detail: BossZpDetailData | undefined
      if (postDescription) {
        detail = {
          jobInfo: { encryptId: encryptJobId, jobName, positionName: jobName, postDescription },
        } as unknown as BossZpDetailData
        try {
          assertCompleteJobDetail(detail, encryptJobId)
        } catch {
          return null
        }
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
        cityName: text(row.city),
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
        detailStatus: detail ? 'complete' : 'pending',
        analysisStatus: 'pending',
        reviewStatus: 'pending',
        sendStatus: 'pending',
        ...(detail ? { detail } : {}),
        detailRetryCount: 0,
        jobUrl: `https://www.zhipin.com/job_detail/${encodeURIComponent(encryptJobId)}.html`,
      }
    })
    .filter((record): record is BossJobLibraryRecord => record !== null)
}

export function parseHistoricalJobLibrary(
  value: unknown,
  batch: string,
  importedAt = new Date().toISOString(),
): BossJobLibraryRecord[] {
  return parseJobRows(value, batch, importedAt)
}

export function parseJobLibraryCsv(
  content: string,
  batch: string,
  importedAt = new Date().toISOString(),
): BossJobLibraryRecord[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const source = content.replace(/^\uFEFF/, '')

  for (let i = 0; i < source.length; i++) {
    const char = source[i]!
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"' && !field) quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\r' || char === '\n') {
      row.push(field)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      field = ''
      if (char === '\r' && source[i + 1] === '\n') i++
    } else field += char
  }
  if (quoted) throw new Error('CSV 格式错误：字段缺少双引号')
  if (field || row.length) {
    row.push(field)
    if (row.some((value) => value.trim())) rows.push(row)
  }
  if (rows.length < 2) throw new Error('CSV 必须包含表头和岗位记录')

  const [headers, ...data] = rows
  const columns = new Map(headers!.map((header, index) => [header.trim(), index]))
  const required = ['岗位名称', '岗位链接']
  if (required.some((header) => !columns.has(header)))
    throw new Error(
      `CSV 缺少必需表头：${required.filter((header) => !columns.has(header)).join('、')}`,
    )

  const get = (values: string[], header: string) => values[columns.get(header) ?? -1] ?? ''
  const records = data.map((values) => ({
    name: get(values, '岗位名称'),
    'company-info': get(values, '公司'),
    salary: get(values, '薪资'),
    city: get(values, '地点'),
    'job-name href': get(values, '岗位链接'),
    'job-sec-text': get(values, '职位描述'),
  }))
  return parseJobRows(records, batch, importedAt, true)
}
