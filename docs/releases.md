# Folio 版本与发布

## Sponsorship Planning

2026-10-17 新增 [官方 Release 赞助计划](sponsor-release-plan.md)，当前尚未实施。
后续官方构建的多 WebDAV、局域网多设备同步和目录监听／热重载需赞助解锁；
基础字体管理、单 WebDAV（含多设备）、冲突／删除恢复与导出继续免费。
自行编译默认开放全部已实现功能，优化 release 构建同样无需凭证。

2026-10-18 调整为云服务器在线验证：官方高级版通过激活码在线激活、查询权益与
续验，客户端缓存有期限的签名租约及有限离线宽限。一次赞助的长期权益保持不变；
租约超过最终截止时间或授权被明确撤销时，仅暂停受限的新任务，保留用户资料与
免费恢复能力。云服务只处理授权请求，不托管字体或参与同步传输。

实施时官方工作流必须显式选择 `official` 渠道，普通本地构建默认 `community`；
不得以优化级别或 Android 发布签名决定权益。各平台产物加入渠道一致性检查，
验签公钥可随包发布，授权签发私钥留在服务器受保护的密钥环境，与 Android 签名
私钥分别管理；激活码、续验凭据和租约不得进入安装包或更新清单。
既有版本、清单和签名流程在实施前保持原行为；按 S0–S3 与各功能验收门槛接入，
S1 服务端部署及对应客户端实网联调是官方高级版上线前置，覆盖断网、宽限到期、
撤销、限流／故障恢复、密钥轮换与数据库恢复；不阻断免费客户端发布，完整账号与
自动支付系统可后置。不把规划中的能力写作当前 Release 权益。多端同步协议及迁移见
[同步架构](sync-architecture.md)。

## Product Workflow Release Gates

按 [Roadmap](../FOLIO_ROADMAP.md) B0／B／E／F1／F2 分平台增加产品验收：独立
安装窗口及 Library 并行使用、Reference／Managed Copy 与删除保护、六种动作、
批量结果／Retry／Export、Font Health、Provider／Picker／Files／Share，以及交付
后的 WOFF／WOFF2 管理／预览／同步。File Provider 和 Share Extension 按采用 ADR
单独验收，不能以 Files 导出替代。现有 Release pipeline、安装包矩阵、签名和清单
规则保持；本轮不改工作流代码，不把打包成功视为产品闭环完成。契约见
[产品工作流架构](product-workflows.md)。

## 版本管理

仓库版本以根目录 `Cargo.toml` 的 `[workspace.package].version` 为准。使用
`pnpm manage version bump patch --build` 同步 Rust、Tauri、macOS 与移动端版本，
同步 Cargo 锁文件、重新生成并校验许可目录后，才生成中文提交与 `vX.Y.Z` 标签，
并原子推送当前分支与标签，包含该分支上之前已提交的功能更改，由标签触发
`Release` 工作流。执行前要求工作区干净且已检出分支，本地与远端均不存在目标
标签。版本与许可校验失败时不创建发布提交或标签；推送失败时远端分支与标签均
不更新，本地发布提交与标签保留，并给出同时重试两者的命令。准备阶段可加
`--no-git`，检查变更后自行提交。
正式版本必须采用 `X.Y.Z`，不接受预发行标签。发布前执行：

```sh
pnpm install --frozen-lockfile
pnpm --dir experiments/mobile install --frozen-lockfile
node tools/releases/release.mjs verify v1.0.0
node tools/about/validate.mjs
pnpm i18n:validate
```

Validate 与 Release 工作流会在校验前自动生成许可目录。Release 将生成结果作为构建产物传给各平台打包、汇总与发布任务，确保安装包和发布附件使用同一份目录。

本地版本或依赖变动后，也可重新生成并提交许可目录。目录同时保留 npm、Rust、Android、iOS、
字体资源及移植源码的原始版权与 NOTICE；未提供原文的来源保留实际声明与出处。

```sh
python3 tools/about/generate-licenses.py --frozen-native
node tools/about/validate.mjs
```

`--frozen-native` 复用已提交的 iOS 原生许可快照，避免发布准备受本地 Pods 状态影响。
升级 iOS 原生依赖并安装对应 Pods 后，去掉该参数刷新快照，再提交许可资料。

Android 运行依赖快照与原始 Maven 声明保存在 `shared/about/`；原生依赖升级时，
先用 `tools/about/android-licenses.gradle` 导出实际 `releaseRuntimeClasspath`，
再运行 `tools/about/collect-native.py` 收集对应 POM 与安装包内的原始许可。
iOS 原生许可从 CocoaPods acknowledgements 收集并保存为离线快照；缺少已安装
Pods 时复用该快照。字标来源保存在 `shared/about/wordmarks/`，按 main、egg1 至 egg5
循环切换。运行 `python3 tools/about/generate-glyphs.py`，使用 Python fontTools
将 SVG 路径生成三端共用资源；原始画布与路径保持一致，无需运行时下载字体。
OFL 字体制作的字标图形无需字体署名，依据见 [OFL FAQ 1.1.2](https://openfontlicense.org/ofl-faq/)。
应用中实际内置的字体继续随包保留原始许可与版权。

## 构建验证与正式发布

`Validate` 校验版本、共享资源、语言目录、类型、Lint、行为测试与 Rust 核心。
`Release` 手动运行只构建、打包和汇总完整发布矩阵，不创建 GitHub Release。
先在待发布提交上手动运行，检查六个原生构建目标和 `complete-release` 产物，
再推送对应 `vX.Y.Z` 标签触发正式发布。
仅创建本地 tag 或只推送分支不会触发发布；标签必须指向包含最新工作流、版本与
许可目录的提交。`pnpm manage version bump` 会同时推送当前分支和标签；手动发布时
在待发布的 `main` 分支执行 `git push --atomic origin HEAD:refs/heads/main refs/tags/vX.Y.Z:refs/tags/vX.Y.Z`。
正式发布在构建前检查 Android 四项签名 Secrets，缺失时直接失败。

| 平台 | 原生 runner | 架构 | 安装包 |
| --- | --- | --- | --- |
| macOS | xcode-27 | arm64 | DMG，本地签名 |
| Windows | windows-2025 / windows-11-arm | x64 / arm64 | NSIS EXE，未签名 |
| Linux | ubuntu-22.04 / ubuntu-22.04-arm | x64 / arm64 | AppImage、deb、rpm |
| Android | ubuntu-24.04 | arm64-v8a / x86_64 | 按 ABI 拆分的两个 APK |

iOS 本轮不发布安装包。ARM AppImage 在 ARM Linux runner 上构建，不能在 x64
runner 上交叉打包。Node、pnpm、Rust、Java、NDK 与 Xcode 固定版本；外部 Actions
固定到提交。所有安装包构建、许可校验及产物检查成功后才汇总 SHA-256 和
`folio-release.json`。先上传草稿的完整附件，再公开 Release；正式版本不覆盖。
失败任务保留可用安装包或报告。公开前再次检查十一个安装包、许可资料、更新清单和
全部 SHA-256；上传中断后可重跑失败任务，续传同一提交的工作流草稿。
正式版本、其他提交创建的草稿及含未知附件的草稿禁止覆盖。

客户端主动查询本仓库的最新正式 Release，再读取其中的 `folio-release.json`，
只选择当前平台与运行架构的产物。Linux 优先 AppImage，可选 deb/rpm。
桌面端下载由系统浏览器完成。移动端从所选线路直接读取
`releases/latest/download/folio-release.json`；Android 在应用内下载、校验并调起系统
安装确认，iOS 只展示版本与日志，暂不提供安装按钮。清单格式如下：

```json
{
  "schemaVersion": 1,
  "version": "1.0.0",
  "publishedAt": "2026-10-08T12:00:00.000Z",
  "releaseUrl": "https://github.com/aurysian-yan/Folio/releases/tag/v1.0.0",
  "releaseNotes": {
    "zh-CN": "### 修复\n\n- 修复字体预览异常。",
    "en": "### Fixes\n\n- Fix font preview issues."
  },
  "artifacts": [
    {
      "platform": "macos",
      "arch": "arm64",
      "format": "dmg",
      "url": "https://github.com/aurysian-yan/Folio/releases/download/v1.0.0/Folio-v1.0.0-macos-arm64.dmg",
      "size": 123456,
      "sha256": "安装包原文的 64 位小写十六进制 SHA-256"
    }
  ]
}
```

`publishedAt` 为本次发布准备时间，采用 UTC ISO 8601。完整矩阵共十一个安装包；
大小以字节计，校验值必须来自上传的同一文件。`folio-licenses.json` 和
`LICENSE.txt` 也随 Release 发布，`SHA256SUMS.txt` 覆盖全部附件及更新清单。
客户端不接受其他仓库、外部下载站、损坏清单、重复产物或标签不一致的清单。

## Android 固定签名

正式应用身份保持 `com.folio.mobile.poc`，开发版保持 `com.folio.mobile.poc.dev`。
正式发布必须始终使用同一份密钥。首次发布前，在本地妥善创建并备份发布密钥，
将以下四项保存到仓库 Actions Secrets：

- `ANDROID_KEYSTORE_BASE64`：发布 keystore 文件的 Base64 内容。
- `ANDROID_KEYSTORE_PASSWORD`：keystore 密码。
- `ANDROID_KEY_ALIAS`：发布密钥别名。
- `ANDROID_KEY_PASSWORD`：密钥密码。

密钥只解码到 runner 临时目录，构建后删除，不写入仓库或 Actions 附件。
生产 Expo 配置插件将 Gradle Release 签名切换为固定密钥；缺少任何凭据时正式
发布立即失败，不回退到调试签名。手动仅构建且无密钥时生成未签名 APK，用于
产物检查，不能直接安装。Android 构建号使用 `github.run_number`，Gradle 按
`arm64-v8a` 与 `x86_64` 分别输出 APK，不生成通用包；应用内更新按设备架构选择
对应安装包。校验 APK 时检查 ABI、Rust 桥接、离线许可与签名证书。
此前使用调试密钥安装的正式身份 APK 与新发布密钥不兼容，不能原位升级；迁移前
先通过应用导出或云同步保留资料。

本地验证正式构建时，可将同样的四项写入未入库的
`experiments/mobile/.signing/android.properties`：`storeFile` 填 keystore 绝对路径，
其余为 `storePassword`、`keyAlias`、`keyPassword`。Gradle 优先读取环境变量，缺失时
才回退到该文件；目录已被忽略，不得提交。CI 始终只使用 Actions Secrets，读取行为不变。

## 未公证与未签名桌面包

macOS DMG 使用本地签名，暂不提交 Apple 公证。将应用拖入「应用程序」后，
首次打开若被系统拦截，在「系统设置 → 隐私与安全性」中确认来源后选择「仍要打开」。
仅在确认下载来自本项目 Release 且校验值一致时执行系统允许的打开操作。

Windows 使用未签名 NSIS 安装程序；SmartScreen 可能提示未知发布者。核对本项目
Release 与 SHA-256 后，可在系统提示中选择「更多信息 → 仍要运行」。
Linux AppImage 下载后赋予执行权限再运行；也可以选择对应架构的 deb 或 rpm，
通过系统软件管理器安装。


## 双语更新日志与 LLM 配置

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 配置：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Secret | `RELEASE_LLM_API_KEY` | 服务商 API 密钥 |
| Variable | `RELEASE_LLM_BASE_URL` | HTTPS API 基础地址，例如 `https://api.openai.com/v1`，不含 `/chat/completions` |
| Variable | `RELEASE_LLM_MODEL` | 服务商提供的准确模型 ID，不预设模型 |

三项齐全才启用模型；采用 OpenAI 兼容的 Chat Completions 协议、Bearer 鉴权和非流式
响应，不要求供应商支持 JSON 模式或特定采样参数。单次请求最多 45 秒，最多三次尝试，
全部总结受八分钟总时限约束。密钥仅用于日志生成任务，不进入客户端、安装包或产物。

日志任务与平台构建并行执行，范围为当前提交可达的上一个已公开正式 Release 至当前
提交；首次发布覆盖此前历史。失败标签、草稿、预发行及其他分支的 Release 不作为基线。
提交标题、正文及变更路径分批发送，超长单条记录也完整分批，再汇总中英双语 Markdown。
模型按新增、改进、修复及平台整理，不能把规划文档中的能力写成已交付功能。

缺少配置或模型失败时，按提交类别生成中英标题，正文保留原始提交及链接，不伪造英文
翻译。超过正文容量的历史使用分类数量与完整提交比较链接，保持全部记录可访问。
`release-notes` 工作流产物保存可审核的日志；手动构建同样生成，但不公开 Release。

汇总阶段将同一份日志写入 `folio-release.json` 的可选 `releaseNotes` 字段，保留
`schemaVersion: 1`，再生成 SHA-256。Release 正文与应用使用这份数据。旧清单仍可读取；
缺少日志时应用显示明确说明。日志不会作为额外附件改变既有十四项发布附件矩阵。

草稿正文保留发布提交标记和日志快照。重跑发布失败任务时沿用原产物；如重新执行日志
任务，先复用同一提交草稿中的清单或日志快照，不再次调用模型。存在清单时保留原始
发布时间，并要求安装包哈希一致；不一致时停止发布，重跑原工作流的失败任务。
正式 Release、其他提交的草稿以及正文与清单不一致的草稿仍禁止覆盖。

## 移动端镜像与 Android 安装

设置主页和关于页均可进入「软件更新」，设置搜索支持版本、更新、镜像等关键词。
默认 GitHub 直连；可手动固定 GhFast、GhProxy、GhProxyOrg、GhDdlc 或 Isteed。
镜像只改写请求地址，清单中的原始 URL 始终限于本仓库，进一步了解仍打开 GitHub Release。

每次展开原生菜单并行测速一次，完整下载并校验同一个 Folio 更新清单，单线路超时五秒。
结果为完整请求耗时，不代表 APK 大文件吞吐速度；关闭菜单取消本轮测速，最快标记不
改变已选择线路。切换镜像会重新检查更新；下载期间不能切换，须先取消当前下载。

Android 使用系统 DownloadManager 执行下载，任务与安装包信息持久保存在应用内；
下载进度在更新页显示，离开页面、切入后台或重新打开后可恢复，不重复创建下载。
下载完成后逐项检查字节数、SHA-256、正式包身份、版本、递增构建号与签名兼容性，
将校验通过的文件复制到应用私有目录，并在调起系统安装前再次校验。

安装需要用户在系统安装器确认；缺少安装来源权限时打开系统授权设置，授权返回后继续。
后台不弹出安装器，回到前台后接续。取消安装会保留已验证文件供再次安装，成功升级、
手动移除或七天过期后清理。开发包身份或历史调试签名不兼容时不会强行覆盖安装。
安装包通过限定更新目录的 FileProvider 临时只读授权提供，不申请广泛存储访问权限。


更新原生安全回归使用临时 `FolioUpdateTest` 模拟器，显式指定序列号：
`ANDROID_SERIAL=emulator-5554 pnpm --dir experiments/mobile test:updates`。
脚本生成独立临时签名与不同签名、包名、版本、构建号的最小 APK，验证校验失败清理、
任务恢复、授权返回、过期移除和 FileProvider 目录隔离，不使用正式签名密钥。
