# Folio 版本与发布

## 版本管理

仓库版本以根目录 `Cargo.toml` 的 `[workspace.package].version` 为准。使用
`pnpm manage version bump patch --build` 同步 Rust、Tauri、macOS 与移动端版本，
并生成中文提交与 `vX.Y.Z` 标签；准备阶段可加 `--no-git`，检查变更后自行提交。
正式版本必须采用 `X.Y.Z`，不接受预发行标签。发布前执行：

```sh
pnpm install --frozen-lockfile
pnpm --dir experiments/mobile install --frozen-lockfile
node tools/releases/release.mjs verify v1.0.0
node tools/about/validate.mjs
pnpm i18n:validate
```

版本或依赖变动后重新生成许可目录。目录同时保留 npm、Rust、Android、iOS、
字体资源及移植源码的原始版权与 NOTICE；未提供原文的来源保留实际声明与出处。

```sh
python3 tools/about/generate-licenses.py
node tools/about/validate.mjs
```

Android 运行依赖快照与原始 Maven 声明保存在 `shared/about/`；原生依赖升级时，
先用 `tools/about/android-licenses.gradle` 导出实际 `releaseRuntimeClasspath`，
再运行 `tools/about/collect-native.py` 收集对应 POM 与安装包内的原始许可。
iOS 原生许可从 CocoaPods acknowledgements 收集并保存为离线快照；缺少已安装
Pods 时复用该快照。生成字标矢量需要 Python fontTools，输入来自仓库内固定字体，
无需在运行时下载字体：`python3 tools/about/generate-glyphs.py`。

## 构建验证与正式发布

`Validate` 校验版本、共享资源、语言目录、类型、Lint、行为测试与 Rust 核心。
`Release` 手动运行只构建、打包和汇总完整发布矩阵，不创建 GitHub Release。
先在待发布提交上手动运行，检查六个原生构建目标和 `complete-release` 产物，
再推送对应 `vX.Y.Z` 标签触发正式发布。

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
失败任务保留可用安装包或报告，失败草稿需要检查后删除，才能重新发布同一标签。

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

## 未公证与未签名桌面包

macOS DMG 使用本地签名，暂不提交 Apple 公证。将应用拖入「应用程序」后，
首次打开若被系统拦截，在「系统设置 → 隐私与安全性」中确认来源后选择「仍要打开」。
仅在确认下载来自本项目 Release 且校验值一致时执行系统允许的打开操作。

Windows 使用未签名 NSIS 安装程序；SmartScreen 可能提示未知发布者。核对本项目
Release 与 SHA-256 后，可在系统提示中选择「更多信息 → 仍要运行」。
Linux AppImage 下载后赋予执行权限再运行；也可以选择对应架构的 deb 或 rpm，
通过系统软件管理器安装。
