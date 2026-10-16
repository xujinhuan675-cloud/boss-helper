---
stage: work
status: waiting_human
ai_scope: manage
project: boss-helper
source: 用户于 2026-10-16 确认 React 与 HeroUI 免费官方组件
related: []
next_action: 用户重载固定目录扩展并刷新 BOSS，验收侧边栏与工作台后决定合并
review_required: true
ai_confidence: high
last_ai_run: 2026-10-16
created_by: codex
created: 2026-10-16
---

# HeroUI 扩展工作台实现计划

> 代码与构建已交付，按用户“修改好代码，我来验证就行了”保留人工验收；禁止验收前合并。

## 目标与约束

保护现有业务和本地数据，在独立分支 `codex/ui-workbench` 实现 Chrome 原生侧边栏与独立扩展工作台。React 界面直接组合 HeroUI 免费官方组件与默认样式，只增加必要布局和业务连接，不使用 Pro、付费模板或自制基础控件。

原 BOSS 页面保留执行脚本，移除可见注入面板和针对面板的页面样式、原生筛选搬移。关闭侧边栏或工作台不停止执行器，关闭 BOSS 标签页后页面任务不可继续。保留原存储键、配置预设、简历、模型、岗位库、筛选、采集、分析、实时投递和单岗发送能力。真实投递仅由用户明确操作触发，开发验证不发送消息。

当前已确认的界面方向取代先前 Nuxt UI Dashboard/Chat 模板方案。商业网关未提供地址及接口版本，本轮不虚构登录、付款、兑换成功，也不放入管理员密钥。

## 已有基线

- 原分支：`codex/submit-changes`，原未提交文件和暂存区保持不变。
- 本地可回退基线：`6647fcefa742400b487e26558f0f43bc4ff298d8`。
- devlog-ui 本地基线：`95dc3ee33b5eb09d604642b91da73df5e542ba6b`。
- 隔离目录：`C:/Users/20843/.codex/worktrees/9b4a/boss-helper`。
- Chrome 加载目录仍为原仓库 `.output/chrome-mv3`，隔离构建需同步后重载才生效。

## Task 1: 页面执行器与扩展消息

- [x] 在 `src/workbench/protocol.ts` 定义明确的状态和命令，拒绝未知命令及无效参数。
- [x] 在 `src/entrypoints/boss/workbench.ts` 连接现有 BossHelperCtx 方法；耗时任务保留在页面运行，错误进入可读状态。
- [x] 在 `src/entrypoints/content.ts` 连接扩展内部请求和原有脚本消息适配器；只接受本扩展页面的控制请求。
- [x] 在 `src/index.ts` 和 `runtime.ts` 把配置、模型、简历和统计初始化从旧 App 生命周期移出，去掉可见面板挂载，保持路由及业务初始化。
- [x] 用回归覆盖非法控制、错误反馈、无界面启动、配置重载及任务不中断。

## Task 2: HeroUI 页面与原存储连接

- [x] 在 `src/workbench/store.ts` 复用现有 Vue 数据服务，提供 React 订阅；扩展页面直接读写原存储，执行前重载配置。
- [x] 在 `src/entrypoints/sidepanel`、`src/entrypoints/workbench` 添加 React 入口。
- [x] 用官方 Button、Tabs、Table、Modal、TextField、Select、Switch、Accordion、ProgressBar、Chip 等组合任务、岗位库、简历、模型、提示词、配置、日志与 AI 结果视图。
- [x] 只增加必要布局 CSS，使用官方主题与组件状态；图标来自 lucide-react，不自绘基础控件。
- [x] `wxt.config.ts` 同时支持旧 Vue 执行器与新 React 页面；增加原生 sidePanel 行为，点击扩展工具栏图标打开侧边栏。

## Task 3: 验证与交付

- [x] 运行执行器、存储和相关原业务回归，12 个独立进程合计 282 项通过。
- [x] 运行类型检查：全仓仍有 109 条错误，位于旧 Vue/业务模块及 devlog-ui；新增工作台、桥接和入口未报告类型错误，未宣称全仓通过。
- [x] 定向 lint、46 文件格式检查、入口准备 1/1、Chrome 正式构建和入口/静态资源检查通过。
- [x] 备份原加载包，同步 23 个文件到固定目录，每个文件 SHA256 相同。
- [x] 更新仓库索引和原推进记录，留在功能分支等待用户验收。
- [ ] 用户重载扩展并刷新 BOSS，验证窄侧栏、独立工作台、原数据读回及实际控制操作；按本轮指令未自动操作 Chrome。
- [ ] 用户验收通过后合并分支。真实模型、真实投递未验证；付款兑换未实现。

## 交付与回退

- 产物：`F:/AnchorOS/6-项目仓库/boss-helper/.output/chrome-mv3`，总计 2,787,581 bytes。
- 回退包：`F:/AnchorOS/6-项目仓库/boss-helper/.output/chrome-mv3-before-heroui-20261016`，保留同步前文件。
- 扩展 ID：`ogkmgjbagackkdlcibcailacnncgonbn`。工作台入口为 `chrome-extension://ogkmgjbagackkdlcibcailacnncgonbn/workbench.html`，工具栏图标打开侧边栏。
- 先在 `chrome://extensions` 重载同一扩展，再刷新 BOSS；已写入磁盘不代表运行版本已更新。
- 最终构建只报告分块大小警告。未变更原工作区源码或暂存区，也未改扩展持久数据。

## 执行记录

- 2026-10-16：用户确认采用 HeroUI 免费组件并要求修改、恢复 Goal。Goal 工具只支持读取和暂停/完成/阻塞，无法修改正文或恢复；本文件记录新版目标，自动目标控件仍需用户在界面操作。当前授权的实现继续推进。
- 原 lockfile 与 package.json 在新隔离目录不能冻结安装，先核对并更新依赖锁定，不修改原目录依赖。
