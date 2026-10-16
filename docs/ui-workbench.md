---
stage: work
status: waiting_human
ai_scope: manage
project: boss-helper
source: 用户于 2026-10-16 确认 React 与 HeroUI 免费官方组件
related: []
next_action: 在原仓库唯一分支继续开发，用户重载扩展并刷新 BOSS 验收界面与任务操作
review_required: true
ai_confidence: high
last_ai_run: 2026-10-16
created_by: codex
created: 2026-10-16
---

# HeroUI 扩展工作台实现计划

> 用户于 2026-10-16 明确要求保存旧分支、合并新界面并只保留原仓库一个本地分支；该授权取代此前等待验收再合并的安排。代码合并与构建已交付，浏览器验收仍按“修改好代码，我来验证就行了”由用户完成。

## 目标与约束

保护现有业务和本地数据，先在独立分支实现 Chrome 原生侧边栏与独立扩展工作台，再按用户授权合并到原仓库的 `codex/submit-changes`。React 界面直接组合 HeroUI 免费官方组件与默认样式，只增加必要布局和业务连接，不使用 Pro、付费模板或自制基础控件。

原 BOSS 页面保留执行脚本，移除可见注入面板和针对面板的页面样式、原生筛选搬移。关闭侧边栏或工作台不停止执行器，关闭 BOSS 标签页后页面任务不可继续。保留原存储键、配置预设、简历、模型、岗位库、筛选、采集、分析、实时投递和单岗发送能力。真实投递仅由用户明确操作触发，开发验证不发送消息。

当前已确认的界面方向取代先前 Nuxt UI Dashboard/Chat 模板方案。商业网关未提供地址及接口版本，本轮不虚构登录、付款、兑换成功，也不放入管理员密钥。

## 已有基线

- 后续使用目录：`F:/AnchorOS/6-项目仓库/boss-helper`，唯一保留的本地分支为 `codex/submit-changes`。
- 原未提交业务已保存为 `13c11b1961ee1043219302171e9cbfeb65380437`，包含关键词轮换节奏、配额、恢复和通知增强。
- 本地可回退基线：`6647fcefa742400b487e26558f0f43bc4ff298d8`。
- HeroUI 功能提交：`7202121d7f6991d553ea6921a88717fd389d82af`；合并保留原分支较新的业务逻辑，并在新界面补齐轮换设置、暂停恢复和冷却倒计时。
- devlog-ui 原改动先保存为 `ace4633`，再合并界面分支同树快照，最终指针为 `5f4dc6a`。
- 原隔离目录：`C:/Users/20843/.codex/worktrees/9b4a/boss-helper`，退出分支占用；历史文件保留，日常开发使用原仓库。
- Chrome 加载目录仍为原仓库 `.output/chrome-mv3`，本轮直接在原仓库构建，重载后才生效。

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
- [x] 以上 282 项、109 条错误及逐文件同步为隔离分支交付时的历史检查记录。
- [x] 合并后逐文件独立执行全部 24 个源码测试文件，498 项通过；入口准备另 1/1 通过。
- [x] 合并后定向 lint、最后 26 个相关文件格式、Chrome 正式构建与入口/静态资源检查通过。
- [x] 合并后完整类型检查仍有 112 条错误，位于旧 Vue/业务模块与 devlog-ui；新工作台、桥接和扩展页面入口未报告错误，未宣称全仓通过。
- [x] 保存旧业务后合并 HeroUI 分支，原仓库只保留 `codex/submit-changes`，未推送远端。
- [ ] 用户重载扩展并刷新 BOSS，验证窄侧栏、独立工作台、原数据读回及实际控制操作；按本轮指令未自动操作 Chrome。
- [ ] 真实模型与真实投递仍待用户验证；付款兑换未实现。

## 交付与回退

- 产物：`F:/AnchorOS/6-项目仓库/boss-helper/.output/chrome-mv3`，合并后原仓库重建共 23 个文件、2,809,841 bytes。
- 回退包：`F:/AnchorOS/6-项目仓库/boss-helper/.output/chrome-mv3-before-heroui-20261016`，保留同步前文件。
- 扩展 ID：`ogkmgjbagackkdlcibcailacnncgonbn`。工作台入口为 `chrome-extension://ogkmgjbagackkdlcibcailacnncgonbn/workbench.html`，工具栏图标打开侧边栏。
- 先在 `chrome://extensions` 重载同一扩展，再刷新 BOSS；已写入磁盘不代表运行版本已更新。
- 最终构建报告分块大小与插件耗时提示。原工作区现在包含合并后的新界面和原业务，未改扩展持久数据。

## 执行记录

- 2026-10-16：用户确认采用 HeroUI 免费组件并要求修改、恢复 Goal。当时 Goal 工具无法修改正文或恢复状态，因此本文件维护实际目标；本轮按后续明确合并授权收口，浏览器验收由用户完成。
- 原 lockfile 与 package.json 在新隔离目录不能冻结安装，先核对并更新依赖锁定，不修改原目录依赖。
- 2026-10-16 合并交付：用户明确选择原仓库作为后续唯一开发入口；原仓库冻结安装与 WXT 准备完成，依赖随合并后的 lockfile 更新。分支清理仅删除已合并的本地引用，提交历史和原隔离目录文件保留。
- 合并复核：模型增删改、复制与设默认先读取最新存储再修改，跨窗口更新、损坏数据或读取失败时保留原配置；移除配置初始化的第二次重复写入。任务主操作重组后，“采集并分析”和“补全详情”保留为次级按钮，继续调用原有业务入口。
