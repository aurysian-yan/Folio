# Folio 版本与发布

## Sponsorship Planning

2026-10-17 新增 [官方 Release 赞助计划](sponsor-release-plan.md)，当前尚未实施。
后续官方构建的多 WebDAV、局域网多设备同步和目录监听／热重载需赞助解锁；
基础字体管理、单 WebDAV（含多设备）、冲突／删除恢复与导出继续免费。
自行编译默认开放全部已实现功能，优化 release 构建同样无需凭证。

实施时官方工作流必须显式选择 `official` 渠道，普通本地构建默认 `community`；
不得以优化级别或 Android 发布签名决定权益。各平台产物加入渠道一致性检查，
验签公钥可随包发布，赞助签发私钥与 Android 签名私钥分别管理。
既有版本、清单和签名流程在实施前保持原行为；按 S0–S3 与各功能验收门槛接入，
不把规划中的能力写作当前 Release 权益。多端同步协议及迁移见
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
同步 Cargo 锁文件、重新生成并校验许可目录后，才生成中文提交与 `vX.Y.Z` 标签。
任一步失败均不创建发布提交或标签；准备阶段可加 `--no-git`，检查变更后自行提交。
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
许可目录的提交。推送命令为 `git push origin main` 和 `git push origin vX.Y.Z`。
正式发布在构建前检查 Android 四项签名 Secrets，缺失时直接失败。

| 平台 | 原生 runner | 架构 | 安装包 |
| --- | --- | --- | --- |
| macOS | xcode-27 | arm64 | DMG，本地签名 |
| Windows | windows-2025 / windows-11-arm | x64 / arm64 | NSIS EXE，未签名 |
| Linux | ubuntu-22.04 / ubuntu-22.04-arm | x64 / arm64 | AppImage、deb、rpm |
| Android | ubuntu-24.04 | arm64-v8a + x86_64 | 单个双 ABI APK |

iOS 本轮不发布安装包。ARM AppImage 在 ARM Linux runner 上构建，不能在 x64
runner 上交叉打包。Node、pnpm、Rust、Java、NDK 与 Xcode 固定版本；外部 Actions
固定到提交。所有安装包构建、许可校验及产物检查成功后才汇总 SHA-256 和
`folio-release.json`。先上传草稿的完整附件，再公开 Release；正式版本不覆盖。
失败任务保留可用安装包或报告。公开前再次检查十个安装包、许可资料、更新清单和
全部 SHA-256；上传中断后可重跑失败任务，续传同一提交的工作流草稿。
正式版本、其他提交创建的草稿及含未知附件的草稿禁止覆盖。

客户端主动查询本仓库的最新正式 Release，再读取其中的 `folio-release.json`，
只选择当前平台与运行架构的产物。Linux 优先 AppImage，可选 deb/rpm。
下载由系统浏览器完成，不进行后台自动安装。iOS 缺少产物时显示暂无可用更新，
仍提供发行说明。清单格式如下：

```json
{
  "schemaVersion": 1,
  "version": "1.0.0",
  "publishedAt": "2026-10-08T12:00:00.000Z",
  "releaseUrl": "https://github.com/aurysian-yan/Folio/releases/tag/v1.0.0",
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

`publishedAt` 为本次发布准备时间，采用 UTC ISO 8601。完整矩阵共十个安装包；
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
产物检查，不能直接安装。Android 构建号使用 `github.run_number`，ABI 保持
`arm64-v8a` 与 `x86_64`。校验 APK 时检查 ABI、Rust 桥接、离线许可与签名证书。
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
