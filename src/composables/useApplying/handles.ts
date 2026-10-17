import { renderTemplate } from '@/utils/ai'
import type { HelperContext } from '~/composables/useHelper'

import { sameCompanyKey, sameHrKey } from '../../entrypoints/boss/requests'
import { DEFAULT_MATCH_THRESHOLD, getFilteringDecision, validateMatchThreshold } from './scoring'
import type { JobStatus, TaskContext, TaskResult } from './type'
import { defineTaskHandler } from './type'
import { loadSet, parseFiltering, saveSet } from './utils'

export class DependencyMissingError extends Error {
  constructor(public taskId: string) {
    super(`Task dependency missing: ${taskId}`)
  }
}

export class HelperConfigError {
  constructor(
    public key: string,
    public message?: string,
  ) {}
}

// function chatBossMessage(_ctx: LogData, _msg: string) {
//   const _d = new Date()
//   // chatMessages.value.push({
//   //   id: d.getTime(),
//   //   role: 'boss',
//   //   content: msg,
//   //   date: [getCurDay(d), getCurTime(d)],
//   //   name: ctx.jobData.brandName,
//   //   avatar: ctx.jobData.brandLogo,
//   // })
// }

function amapHandler<C extends HelperContext<C, T, S>, T, S>(
  ctx: TaskContext<C, T, S>,
  id: string,
  distance: number,
  amap?: { ok: boolean; distance: number; duration: number },
): TaskResult | void {
  if (!amap || amap.ok === false) {
    return taskResult.skip('高德地图未初始化')
  }
  if (distance > 0 && amap.distance > distance * 1000) {
    return taskResult.skip(
      `${id}距离超标: ${amap.distance / 1000} 设定: ${ctx.helper.conf.formData.amap.straightDistance}`,
    )
  }
}

export const taskResult = {
  skip: (reason: string, status: JobStatus = 'warn'): TaskResult => ({
    isSkip: true,
    reason,
    status,
  }),
  error: (reason: string): TaskResult => ({
    isSkip: true,
    reason,
    status: 'error',
  }),
}

export class TaskRegistry<C extends HelperContext<C, T, S>, T, S = {}> {
  SameCompanyFilter = defineTaskHandler<C, T, S>(
    '重复沟通-相同公司',
    async (ctx) => {
      if (!ctx.helper.conf.formData.sameCompanyFilter.value) {
        return
      }
      const someSet = await loadSet(sameCompanyKey, ctx.helper.uid)
      return {
        fn: async (_, { jobData: data }) => {
          if (someSet.has(data.key)) {
            ctx.helper.statistics.todayData.value.repeat++
            return taskResult.skip('相同公司已投递')
          }
        },
        after: [
          async (ctx, { jobData: data }) => {
            someSet.set(data.key, Date.now())
            if (ctx.index % 3 === 0) {
              await saveSet(
                sameCompanyKey,
                ctx.helper.uid,
                someSet,
                ctx.helper.conf.formData.sameCompanyFilter.expire,
              )
            }
          },
        ],
        onEnd: async (ctx) => {
          await saveSet(
            sameCompanyKey,
            ctx.helper.uid,
            someSet,
            ctx.helper.conf.formData.sameCompanyFilter.expire,
          )
        },
      }
    },
    { label: '相同公司' },
  )

  SameHrFilter = defineTaskHandler<C, T, S>(
    '重复沟通-相同HR',
    async (ctx) => {
      if (!ctx.helper.conf.formData.sameHrFilter.value) {
        return
      }
      const someSet = await loadSet(sameHrKey, ctx.helper.uid)
      return {
        fn: async (_, { jobData: data }) => {
          if (data.key != null && someSet.has(data.key)) {
            ctx.helper.statistics.todayData.value.repeat++
            return taskResult.skip('相同hr已投递')
          }
        },
        after: [
          async (ctx, { jobData: data }) => {
            someSet.set(data.key, Date.now())
            if (ctx.index % 3 === 0) {
              await saveSet(
                sameHrKey,
                ctx.helper.uid,
                someSet,
                ctx.helper.conf.formData.sameHrFilter.expire,
              )
            }
          },
        ],
        onEnd: async (ctx) => {
          await saveSet(
            sameHrKey,
            ctx.helper.uid,
            someSet,
            ctx.helper.conf.formData.sameHrFilter.expire,
          )
        },
      }
    },
    { label: '相同HR' },
  )

  jobTitle = defineTaskHandler<C, T, S>('岗位名', (ctx) => {
    const keywords = ctx.helper.conf.formData.jobTitle.value.filter((item) => item.trim())
    if (!keywords.length) return
    return async (_ctx, { jobData: data }) => {
      const text = data.jobName.toLowerCase()
      if (!text) return taskResult.skip('岗位名为空')
      const match = keywords.find((keyword) => text.includes(keyword.toLowerCase()))
      if (match) return taskResult.skip(`岗位名含有排除关键词 [${match}]`)
    }
  })

  goldHunterFilter = defineTaskHandler<C, T, S>('猎头过滤', (ctx) => {
    if (!ctx.helper.conf.formData.goldHunterFilter.value) {
      return
    }
    return async (_ctx, { jobData: data }) => {
      if (data?.boss.isHeadhunter === true) {
        return taskResult.skip('猎头过滤')
      }
    }
  })

  company = defineTaskHandler<C, T, S>('公司名', (ctx) => {
    const keywords = ctx.helper.conf.formData.company.value.filter((item) => item.trim())
    if (!keywords.length) return
    return async (_ctx, { jobData: data }) => {
      const text = data.brand.name
      if (!text) return taskResult.skip('公司名为空')
      const match = keywords.find((keyword) => text.includes(keyword))
      if (match) return taskResult.skip(`公司名含有排除关键词 [${match}]`)
    }
  })

  jobContent = defineTaskHandler<C, T, S>('工作内容', (ctx) => {
    const keywords = ctx.helper.conf.formData.jobContent.value.filter((item) => item.trim())
    if (!keywords.length) return
    return async (ctx, { jobData }) => {
      const content = jobData.jobDescription.toLowerCase()
      for (const x of keywords) {
        const re = new RegExp(`(?<!(不|无).{0,5})${x.toLowerCase()}(?!系统|软件|工具|服务)`)
        if (content != null && re.test(content))
          return taskResult.skip(`工作内容含有排除关键词 [${x}]`)
      }
    }
  })

  hrPosition = defineTaskHandler<C, T, S>('Hr职位', (ctx) => {
    const keywords = ctx.helper.conf.formData.hrPosition.value.filter((item) => item.trim())
    if (!keywords.length) return
    return async (_, { jobData }) => {
      const content = jobData.boss.title
      const match = keywords.find((keyword) => content != null && content.trim() === keyword)
      if (match) return taskResult.skip(`Hr职位在排除关键词中: ${match}`)
    }
  })

  jobFriendStatus = defineTaskHandler<C, T, S>('好友状态', (ctx) => {
    if (!ctx.helper.conf.formData.friendStatus.value) {
      return
    }
    return async (_, { jobData }) => {
      if (jobData.boss?.isFriend === true) {
        return taskResult.skip('已经是好友了')
      }
    }
  })

  aiFiltering = defineTaskHandler<C, T, S>(
    'AI筛选',
    (ctx) => {
      if (!ctx.helper.conf.formData.aiFiltering.enable) {
        return
      }
      const threshold = ctx.helper.conf.formData.aiFiltering.score ?? DEFAULT_MATCH_THRESHOLD
      validateMatchThreshold(threshold)
      if (
        !ctx.helper.chatModel.createAgent(ctx.helper.conf.formData.aiFiltering, 'filtering', {
          json: true,
        })
      ) {
        throw new HelperConfigError('aiFiltering', 'AI筛选模型未配置')
      }
      return async (ctx, data) => {
        const content = await ctx.helper.chatModel.chat('filtering', data).then((r) => r.text)
        const result = parseFiltering(content)
        if (getFilteringDecision(result, threshold) !== true) {
          return taskResult.skip(result.message)
        }
      }
    },
    {
      state: 'ai',
      stateMsg: 'AI筛选中',
    },
  )

  activityFilter = defineTaskHandler<C, T, S>('活跃度过滤', (ctx) => {
    if (!ctx.helper.conf.formData.activityFilter.value) {
      return
    }
    return async (_, { jobData }) => {
      const activeText = jobData.activeTimeStr
      const activeTime = jobData.activeTime

      if (!activeText && !activeTime) {
        ctx.helper.statistics.todayData.value.activityFilter++
        return taskResult.skip(`无活跃内容,如果全失败请反馈`)
      } else if (!activeText && activeTime) {
        if (ctx.now.getTime() - activeTime >= 7 * 24 * 60 * 60 * 1000) {
          ctx.helper.statistics.todayData.value.activityFilter++
          return taskResult.skip(`不活跃 [${new Date(activeTime).toLocaleString()}]`)
        }
      } else if (!activeText) {
        ctx.helper.statistics.todayData.value.activityFilter++
        return taskResult.skip(`无活跃信息,如果全失败请反馈`)
      } else if (activeText.includes('月') || activeText.includes('年')) {
        ctx.helper.statistics.todayData.value.activityFilter++
        return taskResult.skip(`不活跃, [${activeText}]`)
      }
    }
  })

  customGreeting = defineTaskHandler<C, T, S>(
    '打招呼',
    (ctx) => {
      if (!ctx.helper.conf.formData.customGreeting.enable) {
        return
      }
      return async (ctx, data) => {
        // if (ctx.bossData == null) {
        //   const bossData = await requestBossData(ctx.jobData.card!)
        //   ctx.bossData = bossData
        // }
        let msg = ctx.helper.conf.formData.customGreeting.value
        if (ctx.helper.conf.formData.greetingVariable.value) {
          if (Array.isArray(msg)) {
            msg = msg.map((item) => {
              if (item.type === 'text') {
                return {
                  ...item,
                  content: renderTemplate(item.content, data),
                }
              } else {
                return item
              }
            })
          } else {
            msg = renderTemplate(msg, data)
          }
        }

        // ctx.message = msg

        // const buf = new Message({
        //   form_uid: uid.toString(),
        //   to_uid: ctx.bossData.data.bossId.toString(),
        //   to_name: ctx.bossData.data.encryptBossId, // encryptUserId
        //   friend_source: ctx.bossData.data.bossSource,
        //   content: msg,
        // })

        // await buf.send()

        await ctx.helper.sendMessage?.(data, msg)
      }
    },
    { label: '自定义招呼语' },
  )

  aiGreeting = defineTaskHandler<C, T, S>(
    '打招呼',
    (ctx) => {
      if (!ctx.helper.conf.formData.aiGreeting.enable) {
        return
      }
      if (!ctx.helper.chatModel.createAgent(ctx.helper.conf.formData.aiGreeting, 'greetings')) {
        throw new HelperConfigError('aiGreeting', 'AI招呼模型未配置')
      }
      return async (ctx, data) => {
        const msg = await ctx.helper.chatModel.chat('greetings', data).then((r) => r.text)
        await ctx.helper.sendMessage?.(data, msg)
      }
    },
    { label: 'AI招呼语', state: 'ai', stateMsg: '生成招呼语中' },
  )

  amap = defineTaskHandler<C, T, S>('高德地图', (ctx) => {
    const maxDistance = ctx.helper.conf.formData.amap.straightDistance
    if (maxDistance <= 0) return
    return async (ctx, { jobData, state }) => {
      state.amap ??= {}

      if (!jobData.address) {
        return taskResult.skip('地址信息为空')
      }
      state.amap.geocode = await amapGeocode(jobData.address) // TODO: 直接使用经纬度
      if (!state.amap.geocode?.location) {
        return taskResult.skip('未获取到地址经纬度')
      }
      state.amap.distance = await amapDistance(state.amap.geocode.location)

      if (state.amap == null || state.amap.distance == null) {
        return taskResult.skip('api数据异常')
      }
      return amapHandler(ctx, '直线', maxDistance, state.amap.distance.straight)
    }
  })
}
