# Folio Mobile PoC

对应 [路线图阶段 D](../../FOLIO_ROADMAP.md#d-移动架构-poc-与决策) 的隔离基础工程。RN + Expo 仍是候选方案，正式移动客户端和架构采用结论尚未交付。这里不连接桌面数据库，不修改生产 UniFFI ABI 或 schema。

## Scope

- 独立 pnpm workspace、固定依赖及锁文件，Android/iOS 正式身份使用 `com.folio.mobile.poc`，Debug 身份使用 `com.folio.mobile.poc.dev`。
- 共享 React Native 字体主页按 Figma 实现双列卡片、网格/列表切换、真实文件导入、搜索、分页、字款选择、收藏和原生预览；空库不填充示例数据。
- Swift/Kotlin 本地 Expo Module 复用 `folio-ffi`；SQLite、解析和查询均由现有 Rust 实现。
- 导入是复制到实验应用的托管目录，验证通过后以文件根加入 Rust 库；无系统字体安装、全盘存储权限或 iCloud capability。
- 系统文件选择器支持多选字体与 ZIP；原生逐项读取、校验和按内容去重，完成后显示汇总及文件明细。ZIP 遍历子目录中的 TTF/OTF/TTC/OTC，支持 Stored/Deflate，忽略说明文件和嵌套压缩包，不支持加密、分卷或文件夹导入。单字体上限 64 MiB、单 ZIP 上限 256 MiB、每包 10,000 条目，每批最多 1,000 个字体且总读取字体内容不超过 512 MiB；失败继续处理其他文件，刷新失败仅回滚本批新增来源。
- 预览按文件、TTC index、revision 和 axes 定位；不通过全局注册字体。iOS 使用 CoreText，Android 使用原生 Font/字形塑形与绘制。
- iPadOS 常规宽度使用 `@expo/ui` 的原生 SwiftUI NavigationSplitView、侧边栏 List 和系统 Toolbar，提供全部字体、最近与收藏导航；侧拉及宽度小于 600 点的窗口沿用 iPhone 的原生 TabView、顶部操作区与搜索布局。Menu 和 Button 在 iOS 26 及以上使用系统 Liquid Glass，旧系统使用原生兼容样式。云端、设置与紧凑布局最近页面保持空白。
- 系统浅色/深色、Safe Area 和列表虚拟化。更新 iOS 开发包后重定位托管字体，保留字体库和收藏。
- Android 底栏由本地 Expo `FolioNavigation` 模块承载 Compose，保留本地、最近、云端、设置四项。外观与动效采用 Nexio 固定提交的均衡材质，RN 内容通过独立 RenderNode 提供背景；API 33+ 支持胶囊折射、31–32 支持模糊、28–30 使用半透明兼容材质。来源及许可见 [源码记录](modules/folio-native/android/third-party/NOTICE.md)。

## Setup

Node.js 24、pnpm 11.19.0、仓库要求的 Rust 工具链。iOS 需要 Xcode/CocoaPods；Android 需要 JDK 17、Android SDK 与 NDK 29.0.13846066。Rust 目标需提前安装：

```sh
rustup target add aarch64-linux-android x86_64-linux-android \
  aarch64-apple-ios aarch64-apple-ios-sim
cd experiments/mobile
pnpm install --frozen-lockfile
pnpm bindings
pnpm samples
```

`pnpm samples` 只复制仓库已有 OFL 字体并生成测试 TTC、SHA-256 manifest 和许可文件；样本不预置为应用字体。TTC 的 index 0 是 Lato Regular，index 1 是 Lato Bold。Inter 提供变量轴；`not-a-font.ttf` 用于损坏文件拒绝验证。

## Debug 与 Release 变体

应用身份由环境变量 `APP_VARIANT` 显式控制，与 Gradle、Xcode 的 Debug/Release 构建类型无关。配置入口是 `app.config.ts`：

| 项目 | Debug（`APP_VARIANT=development`） | Release（`APP_VARIANT=production`） |
| --- | --- | --- |
| 应用名称 | Folio Dev | Folio |
| Android package | `com.folio.mobile.poc.dev` | `com.folio.mobile.poc` |
| iOS bundleIdentifier | `com.folio.mobile.poc.dev` | `com.folio.mobile.poc` |
| URL scheme | `folio-poc-dev` | `folio-poc` |
| 图标 | `assets/design/dev/` | `assets/design/` |

两者 package 与 bundle identifier 不同，可以同时安装在同一台设备上。

便捷命令会先以对应身份执行一次 `expo prebuild --no-clean`，再运行原生构建：

```sh
pnpm android          # Debug，可追加 --device
pnpm android:release  # Release
pnpm ios              # Debug
pnpm ios:release      # Release
```

Debug 图标位于 `assets/design/dev/`（`icon.png`、`foreground.png`、`background.png`、`monochrome.png`，以及 iOS Icon Composer 的 `AppIcon.icon/`）；某个 Debug 资源缺失时会自动回退到 `assets/design/` 的正式图标。

Android 的 URL scheme 由 Expo 以追加方式写入 manifest，Release 与 Debug 来回切换时旧 scheme 可能残留；官方说明额外 scheme 不影响运行，如需完全干净的清单，执行一次带 `--clean` 的预构建：`APP_VARIANT=development pnpm exec expo prebuild --platform android --no-install --clean`。

## Android

配置 `ANDROID_HOME` 指向 SDK；非默认 NDK 路径可通过 `ANDROID_NDK_HOME` 指定。Rust 脚本默认打包 arm64-v8a 和 x86_64，并使用 16 KB ELF 对齐；其它 ABI 可显式传入，但仍需独立验收。

```sh
pnpm rust:android
pnpm android --device
```

`pnpm android` 会先以 Debug 身份生成原生工程，再构建并安装。

实验应用最低 Android API 28。准确字形预览当前需要 API 31 的 `TextRunShaper`/`Canvas.drawGlyphs`；低版本明确返回不可预览状态，不使用系统相似字体替代。此限制是待 PoC 决策的范围，不是正式产品的最低版本承诺。

真机通过 USB 连接，开启 USB 调试并允许这台电脑调试。`pnpm android --device` 中选择已连接的手机；也可用 `pnpm android --device "手机型号"` 指定名称。Expo 的参数匹配设备名称，不接受 adb 序列号。需要保持 Metro 运行；使用 USB 访问 Metro 的方式见下方 IDE Run。

## iOS

默认 XCFramework 包含 arm64 设备和 arm64 模拟器；Intel 模拟器尚未纳入。iOS 最低版本 16.4。

已通过 `expo-build-properties` 的 `enableSceneSupport` 启用 SDK 57 的 Scene 生命周期支持，兼容 Xcode 27 / iOS 27 的启动要求。

```sh
pnpm rust:ios
pnpm prebuild:dev --platform ios
pnpm pods
pnpm ios
```

`pnpm ios`、`pnpm ios:release` 会先以对应身份刷新原生工程再运行；重新生成 iOS 工程后需再次执行 `pnpm pods`。

`pnpm pods` 对 CocoaPods 的有效 UTF-8 子进程输出恢复编码，并修正生成的 Expo Constants 和 React Native 打包脚本中的路径引用，使当前仓库的中文及空格路径可构建；不修改 CocoaPods 安装或第三方源码。新增依赖或重新生成 iOS 工程后再次执行此命令。

必须使用 development build：`pnpm start` 启动 Metro，Expo Go 不包含本地 Rust 模块。原生工程、生成绑定、二进制、临时数据库及构建输出均不入库；`expo prebuild` 仅在本目录生成工程，不操作 `apps/macos` 或 `apps/desktop-ui`。

## IDE Run

从本目录执行 `pnpm start`，保持 Metro 终端运行，再打开 IDE：

- Xcode：执行 `pnpm ide:ios`，打开的是 `ios/Folio.xcworkspace`。选择 `Folio` scheme 和 Apple Silicon 的 iPhone 模拟器后按 `⌘R`。单独打开 `Folio.xcodeproj` 不包含 Pods，会出现 Expo module map 缺失和 `No such module 'Expo'`。
- Android Studio：先用 `⌘Q` 退出已运行的 Android Studio，再执行 `pnpm ide:android`。此入口把当前 Node 的目录传给 IDE，并停止旧 Gradle daemon，避免 nvm 的 Node 在 GUI 启动环境中不可见。同步完成后选择 `app` 和 USB 连接的真机，点击 Run。若单独在 IDE 安装，执行 `adb -s "设备序列号" reverse tcp:8081 tcp:8081`，在开发客户端填入 `http://127.0.0.1:8081`。生成工程的默认 ABI 与 Rust 库一致。

若之前从 Dock 启动 Android Studio 后遇到 `command 'node'` 错误，须退出 IDE 并使用上述入口重新打开；仅在已有窗口中执行 `pnpm android` 仍可能复用缺少 Node 的 Gradle daemon。

`pnpm prebuild` 使用 `--no-clean` 更新已有原生工程，保留 IDE 的工程引用；`pnpm prebuild:dev`、`pnpm prebuild:release` 分别以 Debug、Release 身份执行同一操作。更新 iOS 后仍需执行 `pnpm pods`。

## Verification

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:swift
pnpm exec expo install --check
pnpm exec expo export --platform all --output-dir .build/bundle
```

`test:swift` 需要先生成 bindings/samples 并执行 `pnpm pods`，验证 macOS 主机上的真实 Swift ↔ Rust 调用及 Swift 原生批量/ZIP 导入器，不能代表移动运行验收。Android 导入器回归测试在生成 bindings/samples 后从 `android` 目录执行 `./gradlew :folio-native:testDebugUnitTest`，使用 `pnpm bindings` 构建的主机 Rust 库，不代表 Android 设备预览验收。查询的 `AbortSignal` 立即取消 JS 等待并丢弃迟到结果；现有同步 Rust 调用会继续执行，没有原生查询中断承诺。

当前结果、实验边界和后续验收项见 [VALIDATION.md](VALIDATION.md)，架构决策见 [DECISION.md](DECISION.md)。
