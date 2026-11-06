import fs from 'node:fs'

const root = 'jobs/.work/'
const specs = [
  {
    key: 'ai_agent',
    id: '06b8ae43-3b75-4fb4-9859-9b1e7d86ee5f',
    source: 'live-06b8ae43-3b75-4fb4-9859-9b1e7d86ee5f-20261027.json',
    edits: {
      OpenEvolve: [
        '<strong>Agent 治理：</strong>针对 Coding Agent 运行结果难追踪、问题经验难复用的问题，将运行证据、问题经验、候选资产、检索、评测与人工复核拆为 <strong>6 个</strong>可追踪环节，形成受控复用闭环；完成历史导入，覆盖 <strong>1,814 份来源记录、1,708 个宿主会话 ID</strong>，扫描 <strong>2,961 个文件且 0 失败</strong>。',
        '<strong>长期协作：</strong>针对失败经验难回流和晋升边界不清的问题，将记忆与技能治理拆为可追踪环节，保留失败回流和人工复核边界，支撑本地协作工作流。',
      ],
    },
  },
  {
    key: 'enterprise_workflow',
    id: '80a3cf4a-852e-4c09-8b62-1d8730bd8ab1',
    source: 'live-80a3cf4a-852e-4c09-8b62-1d8730bd8ab1-20261027.json',
    edits: {
      OpenEvolve: [
        '<strong>治理流程：</strong>针对 Coding Agent 的运行记录难追踪、问题经验难复用的问题，将运行记录、问题复盘、候选资产、检索、评测和人工复核拆为 <strong>6 个</strong>可追踪治理环节；完成历史导入，覆盖 <strong>1,814 份来源记录、1,708 个宿主会话 ID</strong>，扫描 <strong>2,961 个文件且 0 失败</strong>。',
        '<strong>交付机制：</strong>针对失败经验难回流和晋升边界不清的问题，把任务前检索、运行后记录、失败回流和受控晋升串成长协作工作流，支撑团队持续复用已验证经验。',
      ],
      'FlowGuide 浏览器 AI 助手': [
        '<strong>工具链：</strong>针对网页上下文分散、跨标签检索与 AI 操作难衔接的问题，组织页面理解、跨标签检索与交互等 <strong>20+ 个 MCP 工具</strong>，复用用户现有浏览器会话。',
        '<strong>受控操作：</strong>按页面理解、工具调用和结果回传拆分浏览器助手的任务流程，使网页操作保持在可追踪的执行链路中。',
      ],
    },
  },
  {
    key: 'ai_knowledge',
    id: '2aff0d23-668d-4cdd-979d-732a916787a8',
    source: 'live-2aff0d23-668d-4cdd-979d-732a916787a8-20261027.json',
    edits: {
      'FlowGuide 浏览器 AI 助手': [
        '<strong>浏览器协作：</strong>针对页面理解、跨标签查找和受控网页操作之间缺少连续上下文的问题，设计 Chrome 扩展与 MCP 工具链，组织覆盖 <strong>20+ 个</strong>浏览器管理、网络监控、内容分析与交互工具，复用用户现有浏览器会话。',
        '<strong>上下文组织：</strong>围绕页面理解、工具调用与结果回传拆分任务流程，让跨标签查找和网页操作保持在同一协作链路中。',
      ],
      'Immersive Input 文本增强工具': [
        '<strong>跨应用输入：</strong>针对跨应用文本处理需要频繁切换工具的问题，组织翻译、OCR、TTS、生词本和轻 AI 等 <strong>5 类</strong>文本服务入口，覆盖 <strong>21 种界面语言</strong>，探索桌面端效率工具形态。',
        '<strong>连续操作：</strong>通过快捷入口和文本浮层承载多服务调用，串联不同输入场景，保持处理过程连续。',
      ],
    },
  },
  {
    key: 'finance_ai',
    id: '16d58800-dbe0-43b3-8085-f0a4cd77443c',
    source: 'live-16d58800-dbe0-43b3-8085-f0a4cd77443c-20261027.json',
    edits: {
      'NOFX 交易 Agent 二次开发': [
        '<strong>交易产品拆解：</strong>针对交易 Agent 涉及策略配置、交易运行时、交易所接口与模型服务多边协作的问题，基于开源交易项目梳理覆盖 <strong>8 类模型提供商</strong>与 <strong>9 家交易所</strong>的接入范围及模块边界。',
        '<strong>回测联调：</strong>围绕自定义模块与 VectorBT 回测服务开展扩展和联调，验证策略配置、回测运行与结果反馈链路。',
      ],
    },
  },
]

for (const spec of specs) {
  const record = JSON.parse(fs.readFileSync(root + spec.source, 'utf8').replace(/^\uFEFF/, ''))
  const projects = record.resume_data.personalProjects
  for (const [name, descriptions] of Object.entries(spec.edits)) {
    const project = projects.find((item) => item.name === name)
    if (!project) throw new Error(`${spec.key}: project not found: ${name}`)
    if (project.description.length !== descriptions.length)
      throw new Error(`${spec.key}: unexpected bullet count for ${name}`)
    project.description = descriptions
    project.descriptionStyles = descriptions.map(() => 'bullet')
  }
  fs.writeFileSync(
    root + `metric-update-${spec.key}-20261027.json`,
    JSON.stringify({ resume_id: spec.id, resume_data: record.resume_data }, null, 2),
    'utf8',
  )
}
