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
```

`build:chrome` 直接更新 `.output/chrome-mv3`，无需额外复制或同步。以后修改源码后执行同一构建命令，Chrome 继续使用同一加载目录；构建成功后重载扩展，再刷新已打开的 BOSS 页面。源码不放进构建输出目录。

原来的可加载扩展包完整保留在 `local/original-chrome`，仅用于回退。若本机 Bun 的依赖安装停在安装脚本，可用 `bun install --frozen-lockfile --ignore-scripts` 完成安装，再运行 `bun run postinstall` 准备 WXT。

工程入口见 [项目目录结构索引](docs/项目目录结构索引.md)。当前目录整理和构建入口不代表滚动采集、事前投或定时发送已经实现。

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

商店产物临时写入 `.output/chrome-mv3-store`，打包及校验成功后自动删除该中间目录，保留 ZIP；不覆盖 Chrome 当前加载的 `.output/chrome-mv3`。发布脚本 `scripts/release-chrome.mjs` 使用 WXT 的生产构建 API，并自动断言版本、商店清单和许可证。ZIP 根目录包含 `manifest.json`、页面、脚本、图标、多语言资源和原 MIT 许可证，不包含源码仓库、本机配置或用户数据。商店清单不带开发公钥和 `nativeMessaging` 权限；普通用户无需安装本机诊断 Host，运行诊断仍保存在扩展本地并可在日志页导出，本机镜像会显示不可用。原 `build:chrome` 保留开发公钥和本机诊断，日常开发入口及加载目录保持原约定。

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
