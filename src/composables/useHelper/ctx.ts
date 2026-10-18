import type { Toast } from '@nuxt/ui/runtime/composables/useToast.js'
import { extendRef } from '@vueuse/core'
import type { Reactive } from 'vue'
import { ref } from 'vue'
import type { Ref } from 'vue'

import { useConf } from '@/composables/conf'
import type { DeliveryWorkflow } from '@/composables/useApplying'
import type { BossHelperError } from '@/composables/useApplying/deliverError'
import type { TaskResult, WorkflowData } from '@/composables/useApplying/type'
import { useModel } from '@/composables/useModel'
import { ChatModel } from '@/composables/useModel'
import { useResumes } from '@/composables/useResume'
import type { FormDataInput } from '@/types/formData'
import { logger } from '@/utils/logger'

import type { NetConf } from './netConf'
import { initNetConf } from './netConf'
import type { Log, JobData, LogData } from './type'

export abstract class HelperContext<C extends HelperContext<C, T, S>, T, S> {
  netConf: Ref<NetConf | null>
  netConfTimer: NodeJS.Timeout | null = null
  conf: ReturnType<typeof useConf>
  models: ReturnType<typeof useModel>
  resumes: ReturnType<typeof useResumes>
  statistics: ReturnType<typeof useStatistics>

  chatModel: ChatModel
  workflow: DeliveryWorkflow<C, T, S> | null = null
  workflowRunning = computed(() => this.workflow?.status.value === 'running')
  jobResultMaps: Reactive<Map<string, TaskResult>>

  abstract jobList: Ref<JobData[]>
  abstract jobMaps: Map<string, WorkflowData<T, S>>

  currentJob: Ref<string | null>
  _logs: Ref<Log[]>
  logs: {
    add: (job: JobData, err?: BossHelperError, logdata?: LogData, msg?: string) => void
    info: (title: string, message: string) => void
    clear: () => void
    value: Log[]
  }
  pendingMessages: Ref<string | undefined>
  constructor() {
    this.pendingMessages = ref()
    this.conf = useConf()
    this.models = useModel()
    this.resumes = useResumes()
    this.statistics = useStatistics()
    this.currentJob = ref(null)
    this._logs = ref([])
    this.logs = extendRef(this._logs, {
      add: (job: JobData, err?: BossHelperError, logdata?: LogData, msg?: string) => {
        const state = !err ? 'success' : err.state
        const message = msg ?? (err ? err.message : undefined)
        this._logs.value.push({
          job,
          title: job.jobName,
          state,
          state_name: err?.name ?? '投递成功',
          message,
          data: logdata,
        })
      },
      info: (title: string, message: string) => {
        this._logs.value.push({
          title,
          state: 'info',
          state_name: '消息',
          message,
          data: undefined,
        })
      },
      clear: () => {
        this._logs.value = []
      },
    })

    this.chatModel = new ChatModel(this)

    this.jobResultMaps = reactive(new Map())
    this.netConf = ref(null)
  }

  abstract loadMoreJob(delay: Promise<any>): Promise<boolean>
  abstract onMount(): Promise<void>

  abstract start(): Promise<void>
  abstract sendMessage(data: WorkflowData<T, S>, msg: FormDataInput['value']): Promise<void>
  abstract get uid(): string
  abstract get userInfo(): {
    id: string
    name: string
    avatar: string
  }
  abstract get key(): string
  abstract get label(): string

  initNetConf() {
    initNetConf().then((data) => {
      this.netConf.value = data
    })
    if (!this.netConfTimer) {
      this.netConfTimer = setInterval(
        () => {
          initNetConf().then((data) => {
            this.netConf.value = data
          })
        },
        1000 * 60 * 5,
      )
    }
  }

  stop() {
    this.workflow?.stop()
  }
  reset() {
    this.workflow?.reset()
  }
  async notification(
    msg: string,
    opt?: {
      notification?: typeof notification extends (
        message: string,
        options?: infer O,
      ) => Promise<any>
        ? O
        : never
      toast: Partial<Toast>
    },
  ) {
    const toast = useToast()
    toast.add({
      ...opt?.toast,
      title: msg,
    })
    if (this.conf.formData.notification.value && document.visibilityState !== 'visible') {
      try {
        await notification(msg, { type: 'basic', title: 'BOSS助手', ...opt?.notification })
      } catch (error) {
        logger.error('发送桌面通知失败', error)
      }
    }
  }

  async onJobCardClick(_key: string) {
    throw new Error('Method not implemented.')
  }
}
