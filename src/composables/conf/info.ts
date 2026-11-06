import type { FormData, Prompt } from '@/types/formData'

import {
  DEFAULT_MATCH_THRESHOLD,
  MATCH_SCORING_PROMPT,
  MATCH_SCORING_VERSION,
} from '../useApplying/scoring'

// TODO: 移除info, 忘记当初为啥要维护这一坨了, 还是直接写组件里面好看

export const defaultAiGreetingPrompt: Prompt = [
  {
    role: 'system',
    content: `## 角色
你是负责 BOSS 招聘初聊的 AI 产品求职助理，面向非专业 HR 写清求职者做过什么、采取了什么核心动作、取得什么结果，以及与岗位的匹配点。

## 任务
根据岗位信息和求职者完整简历，生成一条让 HR 快速看懂经历和岗位匹配度的招呼语。先找出 JD 中最相关的一项要求，再从简历中找一个真实项目作为主要证据。只讲核心，不写技术说明。

## 输出要求
- 只输出招呼语正文，不加标题、引号、项目符号或解释。
- 正文按 3 段输出，每段之间空一行。第一段以“您好，我有2年产品经验”开头，再写与 JD 最相关的核心技能；第二段写一个核心项目及采取的动作和结果；第三段使用指定结尾。
- 当前经验按简历写“2年产品经验”。非金融岗位不要默认写“海外产品经验”或用交易背景开场；引用海外交易项目时，明确写“海外交易产品”。
- 项目职责和成果必须来自简历或已核实材料。“独立负责”仅在事实支持时使用，否则写“负责”或“参与”。团队成果不得全部归为个人，不能把相关版本的数据夸大为单一动作的因果结果。
- 优先写与岗位直接相关的数据；没有数据就写真实交付或验证结果，不得编造数字或成果。
- 默认只写一个最相关的核心项目。只有第二项经历能补足 JD 的另一条核心要求时，才在第二段用一句话补充，并且必须证明不同能力；没有新增匹配价值时省略。不写第三项，不重复证明同一能力，不写成项目清单。
- 不使用顿号，不排比罗列职责，不堆叠技术名词或模块名称。用简单自然的表达说明核心工作，让非专业 HR 能直接理解。
- 不编造行业经验、客户资源、落地情况或简历中没有的事实。不要写姓名、毕业年份、经验门槛、放宽条件或个人短板。
- 最后一段必须使用以下内容，不得改写：接手后能快速产出，切实解决业务问题。为方便您快速预览，简历图片已附上。您先看看，如果觉得背景匹配，我随时发一份详细的 PDF 简历和作品集给您。`,
  },
  {
    role: 'user',
    content: `### 待处理的岗位信息:\`\`\`
<岗位信息>
岗位名: {{ jobData.jobName }}
薪资: {{ jobData.salary }}
学历要求: {{ jobData.degreeName }}
经验要求: {{ jobData.experienceName }}
技能要求: {{ jobData.skills }}
岗位标签: {{ jobData.jobLabels }}
<岗位描述>
{{ jobData.jobDescription }}
</岗位描述>
</岗位信息>
\`\`\``,
  },
]

export const formInfoData: Record<string, any> = {
  keywordRotationAutoResume: {
    label: '页面刷新后自动恢复轮换',
    'data-help': '默认关闭；开启后仍遵守冷却时间和每日关键词上限。',
  },
  configLevel: {
    options: [
      {
        value: 'beginner',
        label: '新手',
      },
      {
        value: 'intermediate',
        label: '初学者',
      },
      {
        value: 'advanced',
        label: '中级',
      },
      {
        value: 'expert',
        label: '高级',
      },
    ],
    'data-help': '为不同人群展示不同的配置项, 减少上手难度跟配置过多而产生的恐惧',
  },
  company: {
    label: '公司名',
    'data-help': '公司名排除或包含在集合中，模糊匹配，可用于只投或不投某个公司/子公司。',
  },
  jobTitle: {
    label: '岗位名',
    'data-help': '岗位名排除或包含在集合中，模糊匹配，可用于只投或不投某个岗位名。',
  },
  jobContent: {
    label: '工作内容',
    'data-help':
      "会自动检测上文(不是,不,无需),下文(系统,工具),例子：[外包,上门,销售,驾照], 排除: '外包岗位', 不排除: '不是外包'|'销售系统'",
  },
  hrPosition: {
    label: 'Hr职位',
    'data-help':
      'Hr职位一定包含/排除在集合中，精确匹配, 不在内置中可手动输入,能实现只向经理等进行投递，毕竟人事干的不一定是人事',
  },
  customGreeting: {
    label: '自定义招呼语',
    'data-help':
      '因为boss不支持将自定义的招呼语设置为默认招呼语。开启表示发送boss默认的招呼语后还会发送自定义招呼语',
  },
  greetingVariable: {
    label: '招呼语变量',
    'data-help': '使用mitem模板引擎来对招呼语进行渲染;',
  },
  activityFilter: {
    label: '活跃度过滤',
    'data-help': '打开后会自动过滤掉最近未活跃的Boss发布的工作。以免浪费每天的100次机会。',
  },
  goldHunterFilter: {
    label: '猎头过滤',
    'data-help':
      'Boss中有一些猎头发布的工作，但是一般而言这种工作不太行，点击可以过滤猎头发布的职位',
  },
  friendStatus: {
    label: '好友过滤(已聊)',
    'data-help': '判断和hr是否建立过聊天，理论上能过滤的同hr，但是不同岗位的工作',
  },
  bossGoldMedalHr: {
    label: '过滤金牌面试官',
    'data-help': '通过头像框来判断是否是金牌面试官, 据小红书经验 金牌面试官多数是刷kpi,并不靠谱',
  },
  sameCompanyFilter: {
    label: '相同公司过滤',
    'data-help': '投递过的公司id存储到浏览器本地，避免多次向同公司投递，即使岗位不同hr不同',
  },
  sameHrFilter: {
    label: '相同Hr过滤',
    'data-help': '投递过的hr存储到浏览器本地，避免多次向同hr投递。',
  },
  aiGreeting: {
    label: 'AI招呼语',
    'data-help':
      '根据岗位要求和真实简历生成三段招呼语，突出相关核心项目及结果，保留简历图片预览和后续提供 PDF 简历与作品集的结尾；实际发送时须附上简历图片。',
  },
  aiFiltering: {
    label: '岗位匹配',
    'data-help': '按照可编辑的岗位匹配提示词，一次判断匹配、不匹配或待确认，并返回简短原因。',
  },
  aiReply: {
    label: 'AI回复',
    'data-help': '万一消息太多，回不过来了呢. 功能暂未实现',
  },
  record: {
    label: '内容记录',
    'data-help': '拿这些数据去训练个Ai岂不是美滋滋咯？',
  },
  amap: {
    key: {
      label: '高德地图key',
      'data-help': '高德地图key, 需要自己申请',
    },
    origins: {
      label: '起点经纬度',
      'data-help': '起点经纬度, 经度和纬度用","分隔, 可以输入完整地址点击按钮自动获取',
    },
    straightDistance: {
      label: '最大直线距离',
      'data-help': '最大直线距离, 为0不筛选，单位: km',
    },
  },
}

export const defaultFormData: FormData = {
  configLevel: 'beginner',
  company: {
    value: [],
    options: [],
  },
  jobTitle: {
    value: [],
    options: [],
  },
  jobContent: {
    value: [],
    options: [],
  },
  hrPosition: {
    value: [],
    options: ['经理', '主管', '法人', '人力资源主管', 'hr', '招聘专员'],
  },
  nativeSearch: null,
  customGreeting: {
    value: '',
    enable: false,
  },
  deliveryLimit: {
    value: 120,
  },
  greetingVariable: {
    value: false,
  },
  activityFilter: {
    value: true,
  },
  friendStatus: {
    value: true,
  },
  bossGoldMedalHr: {
    value: false,
  },
  sameCompanyFilter: {
    value: false,
    expire: 0,
  },
  sameHrFilter: {
    value: true,
    expire: 0,
  },
  goldHunterFilter: {
    value: false,
  },
  notification: {
    value: true,
  },
  useCache: {
    value: false,
  },
  aiGreeting: {
    enable: true,
    prompt: defaultAiGreetingPrompt,
  },
  aiFiltering: {
    enable: false,
    prompt: [
      {
        role: 'system',
        content: MATCH_SCORING_PROMPT,
      },
      {
        role: 'user',
        content: `## 待处理的岗位信息:
  <岗位信息>
  岗位名:{{ jobData.jobName }}   薪资: {{ jobData.salary }}
  工作地点: {{ jobData.city }} {{ jobData.address }}
  学历要求: {{ jobData.degreeName }}    工作经验要求: {{ jobData.experienceName }}
  福利列表: {{ jobData.welfareList }}
  技能要求: {{ jobData.skills }}
  岗位标签:{{ jobData.jobLabels }}
    <岗位描述>
    {{ jobData.jobDescription }}
    <岗位描述/>
  </岗位信息>`,
      },
    ],
    score: DEFAULT_MATCH_THRESHOLD,
    scoringVersion: MATCH_SCORING_VERSION,
  },
  aiReply: {
    enable: false,
    prompt: [{ role: 'user', content: '帮我写一个回复的提示' }],
  },
  jobProfile: '',
  resumeText: '',
  amap: {
    key: '',
    origins: '',
    straightDistance: 0,
  },
  record: {
    enable: false,
  },
  paddleOcr: {
    enabled: false,
    baseUrl: 'https://paddleocr.aistudio-app.com/api/v2/ocr',
    token: '',
    model: 'PaddleOCR-VL-1.6',
  },
  delayDeliveryStarts: 3,
  delayDeliveryInterval: 5,
  delayDeliveryPageNext: 60,
  delayCollectionScrollMin: 1,
  delayCollectionScrollMax: 2,
  delayCollectionDetailMin: 6,
  delayCollectionDetailMax: 10,
  collectionMaxRuntimeMinutes: 60,
  delayKeywordRotationMin: 300,
  delayKeywordRotationMax: 900,
  keywordRotationBatchSize: 3,
  delayKeywordRotationBatchMin: 1800,
  delayKeywordRotationBatchMax: 3600,
  keywordRotationDailyLimit: 10,
  keywordRotationAutoResume: { value: false },
  delayMessageSending: 2,
  version: '20261021',
}
