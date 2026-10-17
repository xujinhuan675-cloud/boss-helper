import type { JobData } from '../../composables/useHelper'
import type { BossJobLibraryRecord } from './jobStore'
import type { BossZpDetailData, BossZpJobItemData } from './types'

function formatActiveTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const day = 24 * 60 * 60 * 1000

  if (diff < day) return '今日活跃'
  if (diff < 2 * day) return '昨日活跃'
  if (diff < 7 * day) return '本周活跃'
  if (diff < 30 * day) return '本月活跃'
  return '较久未活跃'
}

export function convertBossZpJobItemToJobData(item: BossZpJobItemData): JobData {
  const key = `boss::${item.encryptJobId}`

  return {
    key,
    link: `https://www.zhipin.com/job_detail/${item.encryptJobId}.html`,
    jobName: item.jobName,
    positionName: item.jobName,
    jobDescription: '',

    // 经验和学历要求 - 从 jobLabels 中解析或直接使用
    experienceName: item.jobExperience || item.jobLabels?.[0] || '经验不限',
    degreeName: item.jobDegree || '学历不限',
    salary: item.salaryDesc,

    // 地址相关
    address: [item.cityName, item.areaDistrict, item.businessDistrict].filter(Boolean).join('-'),
    addressCoords: item.gps ? [item.gps.longitude, item.gps.latitude] : undefined,

    // 技能标签
    showSkills: item.skills || [],
    jobLabels: item.jobLabels || [],
    skills: item.skills || [],

    // 活跃时间 - 从 lastModifyTime 获取
    activeTime: item.lastModifyTime,
    activeTimeStr: item.lastModifyTime ? formatActiveTime(item.lastModifyTime) : undefined,

    // 福利
    welfareList: item.welfareList,

    // 招聘者信息
    boss: {
      link: `https://www.zhipin.com/boss_detail/${item.encryptBossId}.html`,
      name: item.bossName,
      title: item.bossTitle,
      avatar: item.bossAvatar,
      certificated: item.bossCert > 0,
      isHeadhunter: item.goldHunter === 1,
      isFriend: false,
      isOnline: item.bossOnline ?? false,
    },

    // 公司品牌信息
    brand: {
      link: `https://www.zhipin.com/gongsi/${item.encryptBrandId}.html`,
      name: item.brandName,
      logo: item.brandLogo,
      scale: item.brandScaleName,
      industry: item.brandIndustry,
      stageName: item.brandStageName,
      introduce: '',
      labels: [],
    },

    // 状态信息
    // status: {
    //   status: item.contact ? 'warn' : 'pending',
    //   msg: item.contact ? '已沟通' : '未开始',
    // },
  }
}

export function applySavedJobDetail(job: JobData, detail: BossZpDetailData): JobData {
  return {
    ...job,
    activeTime: detail.brandComInfo?.activeTime ?? job.activeTime,
    activeTimeStr: detail.bossInfo?.activeTimeDesc ?? job.activeTimeStr,
    jobDescription: detail.jobInfo.postDescription ?? job.jobDescription,
    city: detail.jobInfo.locationName ?? job.city,
    address: detail.jobInfo.address ?? job.address,
    addressCoords:
      typeof detail.jobInfo.longitude === 'number' && typeof detail.jobInfo.latitude === 'number'
        ? [detail.jobInfo.longitude, detail.jobInfo.latitude]
        : job.addressCoords,
    boss: {
      ...job.boss,
      isOnline: detail.bossInfo?.bossOnline ?? job.boss.isOnline,
      isCertificated: detail.bossInfo?.certificated ?? job.boss.isCertificated,
    },
    brand: {
      ...job.brand,
      labels: detail.brandComInfo?.labels ?? job.brand.labels,
      introduce: detail.brandComInfo?.introduce ?? job.brand.introduce,
      stageName: detail.brandComInfo?.stageName ?? job.brand.stageName,
    },
  }
}

export function getSavedJobData(record: BossJobLibraryRecord) {
  const job = convertBossZpJobItemToJobData(record.snapshot)
  return {
    jobData: record.detail ? applySavedJobDetail(job, record.detail) : job,
    rawData: record,
    state: {},
  }
}
