> [!CAUTION]
> 本项目仅供学习交流，禁止用于商业用途
>
> 使用该脚本有一定风险(如黑号,封号,权重降低等)，本项目不承担任何责任

| Chrome                                                                                                                                                                                             | Crx搜搜                                                                                                                                           | Edge                                                                                                                                                                                                                                                                                                                           | FireFox                                                                                                                                   | Github                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [![Chrome Web Store](https://img.shields.io/chrome-web-store/v/ogkmgjbagackkdlcibcailacnncgonbn?label=Chrome插件商店)](https://chrome.google.com/webstore/detail/ogkmgjbagackkdlcibcailacnncgonbn) | [![Crx 搜搜](https://img.shields.io/badge/Crx搜索-v%3F.%3F.%3F-EF7C3D)](https://www.crxsoso.com/webstore/detail/ogkmgjbagackkdlcibcailacnncgonbn) | [![Edge Web Store](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fjcllnbjfeamhihjpfjlclhdnjmggbgal&query=version&prefix=v&label=Edge插件商店&color=EF7C3D)](https://microsoftedge.microsoft.com/addons/detail/jcllnbjfeamhihjpfjlclhdnjmggbgal) | [![Firefox](https://img.shields.io/amo/v/boss-helper?label=Mozilla插件商店)](https://addons.mozilla.org/zh-TW/firefox/addon/boss-helper/) | [![GitHub Release](https://img.shields.io/github/v/release/Ocyss/boss-helper)](https://github.com/Ocyss/boss-helper/releases/latest/) |

> **国内**: 如果无法访问 `Chrome插件商店` , 请使用 `Crx搜搜` 或 `Edge插件商店` 安装

## 项目介绍

Boss直聘助手, 皆在减少投递简历的麻烦, 和提高投递简历的效率。本地二开界面使用 WXT + React 19 + HeroUI 3 免费组件 + TailwindCSS 4。旧 Vue 界面已删除，Vue 3 响应式业务服务与 Nuxt UI 通知依赖仍保留。

> 本项目处于积极维护状态, 一直很忙所以拖了比较久才开源，抱歉了~

## 本地二开版本

源码及 Git 仓库位于 `F:\AnchorOS\6-项目仓库\boss-helper`。Chrome 的“加载已解压的扩展程序”固定选择仓库内的 `.output\chrome-mv3`：

```text
F:\AnchorOS\6-项目仓库\boss-helper\.output\chrome-mv3
```

本地只保留 `codex/submit-changes` 分支，HeroUI 侧边栏和独立工作台已合入，后续直接在此仓库开发。工具栏图标打开侧边栏，完整工作台入口为扩展的 `workbench.html`。

本地产品名称为 OfferHunt。图标唯一源文件为 `public/icons/logo.png`，扩展清单、工具栏、工作台、页面页签及桌面通知统一引用该图；替换图片后重新构建即可。

在仓库根目录执行：

```powershell
git submodule update --init --recursive
bun install --frozen-lockfile
bun run build:chrome
npm run reload:extension
```

`build:chrome` 直接更新 `.output/chrome-mv3`，无需额外复制或同步。以后修改源码后先构建，再在本仓库执行 `npm run reload:extension`，成功后刷新已打开的 BOSS 页面。重载通过已有 Native Messaging Host 与 Windows 命名管道通知插件自身完成，不使用 Chrome 调试端口；命令等新启动标识回连才返回成功，15 秒未确认则报错。重载会中断正在执行的插件任务。源码不放进构建输出目录。

首次使用或迁移仓库、Node 后执行 `npm run diagnostics:install`。如果当前运行的是尚未包含重载桥的旧包，通过 FlowGuide 打开 `chrome-extension://ogkmgjbagackkdlcibcailacnncgonbn/workbench.html#reload-extension` 激活一次，再运行命令。此入口仅适用于包含 `nativeMessaging` 的本机 Windows Chrome 包，商店发布包不启用。

`bun run dev` 使用 WXT 默认的 `.output/chrome-mv3-dev`，与日常加载的正式包隔离。开发包依赖本地开发服务器，服务器停止后侧边栏无法启动；不要将开发产物覆盖到 `.output/chrome-mv3`。

原来的可加载扩展包完整保留在 `local/original-chrome`，仅用于回退。若本机 Bun 的依赖安装停在安装脚本，可用 `bun install --frozen-lockfile --ignore-scripts` 完成安装，再运行 `bun run postinstall` 准备 WXT。

工程入口见 [项目目录结构索引](docs/项目目录结构索引.md)。当前目录整理和构建入口不代表滚动采集、事前投或定时发送已经实现。

### 浏览器验收通道

本项目的 BOSS 页面、OfferHunt 工作台和 Chrome 标签页操作统一通过 FlowGuide Chrome 控制桥完成。每次操作先枚举窗口和标签页，再使用返回的 `browserDeviceId`、`tabId`；CUA、Chrome DevTools/CDP 和调试端口直连不作为执行方式。FlowGuide 不可用时停止浏览器实测并报告桥接状态；Native Messaging 只用于扩展诊断镜像，不用于控制 Chrome 或读取页面 DOM。

## 启动定制简历

侧边栏和工作台顶部的文件编辑图标为“启动定制简历”。点击后在后台启动 Resume Matcher，服务就绪后自动打开 `http://localhost:3000/tailor`；启动期间按钮禁用，重复使用会复用健康服务。仅本机 Windows Chrome 包显示此入口。

工作台“简历”页的“经历素材库”按钮复用同一启动器，打开 `/materials`。导入现有 Markdown 后按项目分组，每条只维护一份可编辑文案；未核实的 `-R` 示例不自动采用。在定制页启用“使用素材库”，程序按 JD 选材，预览显示来源和匹配理由。原文件更新后需重新导入，来源未变化的条目保留页面编辑。原始文件不改动，素材保存在本机服务数据库，不写入代码仓库。

首次使用或移动仓库、Node 后运行 `npm run diagnostics:install`，注册独立的 `cc.offerhunt.resume_matcher` 本机启动入口。它只允许本扩展调用固定启动脚本，和诊断、重载通道分开。

启动器复用已配置的 `ResumeMatcher-Backend`、`ResumeMatcher-Frontend` 计划任务，使用同级 `../Resume-Matcher/apps/backend/data/resume_matcher.db` 中的原数据；缺少数据库或任务时会报错，不创建空库。此按钮依赖这套本机环境，不会自动在新电脑安装服务。也可双击仓库根目录的 `start-resume-matcher.cmd` 启动并查看详细错误。

`resume-matcher` 子模块保存可追溯的源码版本，远程为账号下的私有仓库，克隆时需要相应 GitHub 权限。日常服务仍使用上述同级目录；不要直接覆盖其个人数据或未提交改动。

## 快速岗位匹配与 Jev

“分析岗位”现在每岗只发一次匹配请求，保存“匹配 / 不匹配 / 待确认”，可附同一次请求返回的一句依据。不会自动展开五维分析或生成招呼语；已完成分析的岗位跳过，历史评分与已有草稿保留。信息不足时标记待确认，不把简历未提及直接视为不具备。

在工作台“模型与提示词”编辑模型，打开“Jev Decisions API（岗位匹配专用）”，填写 OpenRouter API Key、基础地址 `https://openrouter.ai/api/v1` 和账号实际可用的 Jev 模型 ID，再保存。插件通过 `/api/alpha/decisions` 在同一次请求中获取结论和简短原因标签，不额外请求长解释；普通生成模型仍可用于招呼语和关键词提取。岗位匹配优先选择完整的 Jev 配置，没有时使用普通模型的简短 JSON 输出。Jev 模型 ID 手动配置，不假定普通模型列表中的路由模型等同于 Decisions 模型。

匹配规则统一放在“模型与提示词 → 岗位匹配”的提示词编辑区：判断标准、简短原因、普通模型 JSON 格式及 Jev 原因标签说明均可查看和修改。请求不再追加隐藏的匹配或输出规则；普通模型直接使用已保存提示词，Jev 选择题引用相同规则。代码保留接口结构和结果校验。默认要求普通模型在同次请求中给出 60 字以内的具体原因，Jev 返回一个简短原因类别；类别本身不增加筛选门槛。仅完全未修改的旧默认提示词自动更新，自定义内容和追加要求保留。

默认采用宽松投递初筛：经验要求仅排除“5～10年”（含等义写法）和明确限定应届生的岗位，其余不因简历年限不足而淘汰或待确认。“5年以上”“10年以上”不自动归入“5～10年”。方向相关或有可迁移能力即可尝试，学历、单项技能、行业、工具和资质等一般条件不逐项卡死；只在上述经验排除、方向明显无关或明确不可接受条件冲突时判不匹配。全部规则均可在编辑区修改，未新增代码层年限过滤。

AI 匹配以独立保存的个人求职画像、岗位资料与完整 JD、保存的匹配提示词为依据，比较画像方向和岗位职责的语义关系；当前简历不再作为岗位匹配门槛。个人画像支持直接编辑或导入 Markdown，岗位搜索关键词也从画像提取。已存岗位批量分析固定使用启动时的画像快照。简历仍用于招呼语和后续岗位定制，独立的本地排除词筛选也不等于 AI 匹配规则。

模型编辑器内可点击“连接测试”。Jev 会按当前填写的配置发送一次最小 Decisions 测试请求，不发送简历、不保存编辑内容；该请求可能按服务商规则计费。普通模型仍通过读取模型列表测试连接，不能据此保证推理可用。

接口格式与离线回归已核对；真实账号可用性、中文匹配质量、耗时和费用仍需用实际样本验收。构建后须重载 OfferHunt 并刷新 BOSS 才能使用新代码。

## Chrome 商店打包与升级

当前版本为 **1.0.0**，`package.json` 是唯一版本来源。已安装本项目依赖后，在仓库根目录双击 `package-chrome.cmd`，或执行：

```powershell
bun run release:chrome
```

命令先准备 WXT 类型并执行类型检查，再使用 WXT 正式构建并生成 `.output/offerhunt-1.0.0-chrome-store.zip`。将这个 ZIP 手动上传到自己的 Chrome Web Store 项目；后续版本继续上传到同一商店项目。每个版本的 ZIP 单独保留，重复打包同一版本会覆盖同名 ZIP。流程不上传、不创建 Git 提交或标签。

以后升级补丁版本并打包，一条命令即可从 `1.0.0` 升到 `1.0.1`：

```powershell
bun run release:patch
```

需要指定版本时，先执行 `npm version 1.1.0 --no-git-tag-version`，再执行 `bun run release:chrome`。版本使用三段数字，并高于上次上传的版本。如果升版后的检查或构建失败，版本号会保留；修复后执行 `release:chrome` 重试，避免再次升版。

商店产物临时写入 `.output/chrome-mv3-store`，打包及校验成功后自动删除该中间目录，保留 ZIP；不覆盖 Chrome 当前加载的 `.output/chrome-mv3`。发布脚本 `scripts/release-chrome.mjs` 使用 WXT 的生产构建 API，并自动断言版本、商店清单和许可证。ZIP 根目录包含 `manifest.json`、页面、脚本、图标、多语言资源和原 MIT 许可证，不包含源码仓库、本机配置或用户数据。商店清单不带开发公钥和 `nativeMessaging` 权限；普通用户无需安装本机诊断 Host，运行诊断保存在扩展本地并显示于日志页，本机镜像会显示不可用。原 `build:chrome` 保留开发公钥和本机诊断，日常开发入口及加载目录保持原约定。

现有 README 顶部的商店链接属于上游项目，不代表此二开版本已发布。首次从本地开发扩展切换到自己的商店扩展会使用新的 ID，旧扩展的数据不会自动迁移，切换前按需导出岗位和配置。首次商店上架的介绍、截图、隐私政策和权限用途说明由发布者在后台填写；自定义模型及高德接口使用的网络权限仍保留。ZIP 生成和本地检查不代表通过商店审核。

## 相关链接

唯一交流群:
微信麻烦, 飞书人数限制, 所以只开tg一个~

<img alt="交流群" src="./docs/img/tg.png" height="200" />

Github开源地址: <https://github.com/ocyss/boss-helper>

飞书反馈问卷(匿名): <https://gai06vrtbc0.feishu.cn/share/base/form/shrcnmEq2fxH9hM44hqEnoeaj8g>

> 每个提交都会给我发通知，我看见就会评论的形式回复 一般 1-2天

飞书问卷结果: <https://gai06vrtbc0.feishu.cn/share/base/view/shrcnrg8D0cbLQc89d7Jj7AZgMc>

greasyfork地址(0.2旧版本): <https://greasyfork.org/zh-CN/scripts/491340>

## 项目预览

[![卡片状态](docs/img/shot_2024-04-14_23-08-03.png)](docs/img/shot_2024-04-14_23-08-03.png)
[![账户配置](docs/img/shot_2024-04-14_23-09-05.png)](docs/img/shot_2024-04-14_23-09-05.png)
[![统计界面](docs/img/shot_2024-04-02_22-25-25.png)](docs/img/shot_2024-04-02_22-25-25.png)
[![配置界面](docs/img/shot_2024-04-02_22-26-54.png)](docs/img/shot_2024-04-02_22-26-54.png)
[![日志界面](docs/img/shot_2024-04-02_22-32-25.png)](docs/img/shot_2024-04-02_22-32-25.png)

## TODO

- [x] 优化UI去除广告
- [x] 批量投递简历
- 高级筛选
  - [x] 薪资,公司名,工作名,人数,内容简单筛选
  - 公司地址相关
    > 使用高德api，需要自行申请，或者使用关键字筛选, 暂时只有驾车和步行
    - [x] 驾车/步行距离
    - [x] 驾车/步行时间
  - [ ] 公司风险评控
  - [x] AI筛选
- 自动打招呼
  - [x] 模板语言
  - [x] 支持chatGPT
- AI赋能
  - [ ] 自动回复聊天
  - [x] 多模型管理
- 额外功能(有时间会写)
  - [x] 自适应UI适配手机
  - [ ] 黑名单
  - [x] 多账号管理 (废弃, 改为多配置切换)
  - [ ] 聊天阻止发送已读
  - [ ] boss消息弹窗

## 参与贡献

1. Fork 本仓库并克隆到本地。
2. 在新分支上进行您的更改：`git checkout -b 您的分支名称`
3. 提交更改：`git commit -am '描述您的更改'`
4. 推送更改到您的 Fork：`git push origin 您的分支名称`
5. 提交 Pull 请求。

## 鸣谢

- <https://github.com/yangfeng20/boss_batch_push>
- <https://github.com/lisonge/vite-plugin-monkey>
- <https://github.com/chatanywhere/GPT_API_free>

- <https://uiverse.io/>
- <https://www.runoob.com/manual/mqtt/protocol/MQTT-3.1.1-CN.pdf>

## 类似项目

- <https://github.com/Frrrrrrrrank/auto_job__find__chatgpt__rpa>
- <https://github.com/noBaldAaa/find-job>

## 最后

嗯...

## Star 趋势

<a href="https://star-history.dera.page/#ocyss/boss-helper&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://star-history.dera.page/svg?repos=ocyss/boss-helper&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://star-history.dera.page/svg?repos=ocyss/boss-helper&type=Date" />
   <img alt="Star History Chart" src="https://star-history.dera.page/svg?repos=ocyss/boss-helper&type=Date" />
 </picture>
</a>
