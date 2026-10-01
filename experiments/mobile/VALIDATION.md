# Mobile Foundation Validation

日期：2026-09-30。当前基线提交 `75869e7`；本次范围是路线图 D 的隔离基础工程，不是阶段 D 全部通过或阶段 E 正式移动客户端。

## Android Navigation Implementation

2026-09-30，底栏已接入 Expo `FolioNavigation` 模块，采用 Nexio 固定提交
`291e8b9b57c8f331d8f189c52553f41dfd0ce017` 的均衡材质与弹簧参数。
RN 页面通过独立 RenderNode 提供背景；来源和许可见
[源码记录](modules/folio-native/android/third-party/NOTICE.md)。

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS，未引入新 JS 依赖。 |
| `pnpm typecheck`、`pnpm lint` | PASS。 |
| Android `:app:assembleDebug` | PASS，新模块已进入 Expo 注册列表，生成 Debug APK。 |
| Android Expo export | PASS，生成 Hermes 包。 |
| 许可随 APK 打包 | PASS，包含六份许可原文及版权文件。 |
| 安装与启动 | 2026-10-01，USB 真机开发包安装及 MainActivity 启动命令通过；完整运行验收仍待完成。 |
| 交互、视觉、性能及旧版本验收 | 按用户要求留待后续，本轮未执行测试套件。 |

API 28–30、31–32 和 33+ 的效果分级已实现，运行表现尚未分别验证。

2026-10-01：拖动弹簧采用阻尼比 `0.65`、刚度 `5000`，左右边距各减少 4dp，底部距离增加 8dp，列表留白同步调整。
`pnpm typecheck`、`pnpm lint` 和 Android `:app:assembleDebug` 通过，已更新真机开发包。

2026-10-01：连续拖动改为按本次手势的完整位移计算，松手吸附使用同一目标；移动动画只保留最新任务，新手势取消上一轮移动及释放动画。
`pnpm typecheck`、`pnpm lint` 和 Android `:app:assembleDebug` 通过，已安装至 API 36 真机。
ADB 在已加载界面连续执行三次横向拖动（300ms、120ms、120ms），截图确认依次从设置到本地、从本地到设置、从设置到本地，均跨过全部菜单项并切换对应页面；手指操作的主观阻尼感及完整交互验收仍待确认。

2026-10-01：拖动位置改为同步状态更新，移除拖动过程中的位移弹簧；点击及松手后继续使用原有吸附弹簧，按压形变和折射保留。
Android `:app:assembleDebug` 通过，已更新 API 36 真机开发包。ADB 注入持续按下的触摸，依次移动到 x=310 和 x=540，截图确认滑块停留在菜单项之间，页面在松手前保持本地；松手后吸附到最近项。完整测试套件仍按用户要求留待后续。

## Batch Font Import

2026-10-01：修复显式文件来源的扩展名过滤，双端导入桥接改为 `importFonts(files)`，支持系统多选、ZIP、流式 SHA-256 去重及逐项报告。继续使用托管副本、既有 Rust 校验和数据库接口；未改变 Rust ABI 或数据库结构。

| 检查 | 结果与实际范围 |
| --- | --- |
| Rust 回归 | PASS，`cargo test -p folio-storage -p folio-ffi --locked`；新增 `.font`、无扩展名、错误扩展名的显式来源与重新打开回归，目录过滤保持原规则。`cargo fmt --all -- --check` 通过。 |
| JS 验证 | PASS，`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、`pnpm test`；8 项测试覆盖查询边界、批量参数与计数、导入错误与回滚提示。 |
| Android 原生导入 | PASS，`:folio-native:testDebugUnitTest` 的 8 项测试使用生产 Kotlin 导入器与主机 Rust/JNA 临时数据库；覆盖部分失败、同名不同内容、同批与跨批去重、收藏持久化、旧 `.font` 恢复、TTC 非零成员、可变轴、Stored/Deflate、中文子目录、说明文件、嵌套包忽略、空包、CRC、加密标记、不安全路径、实际流大小与数量限制、刷新失败回滚及临时文件清理。 |
| Swift 原生导入 | PASS，`pnpm test:swift`；原有 Swift ↔ Rust 冒烟及新增 6 组生产导入器场景通过，覆盖批量、ZIP、内容去重、逐项失败、资源限制、收藏保留、刷新回滚与临时文件清理。ZIPFoundation 固定为 0.9.20。主机验证不等于 iOS 实机验收。 |
| Rust 库与开发包 | PASS，`pnpm bindings`、`pnpm pods`、`pnpm rust:android`、`pnpm rust:ios`、Android `:app:assembleDebug` 和 iOS arm64 Simulator Debug `xcodebuild`；已更新 Android 真机及 iPhone/iPad 模拟器开发包。 |
| Android 已有来源恢复 | PASS，USB 真机 `23013RK75C`（Android 16 / API 36）保留应用数据更新、重启初始化后，沙盒数据库原有三个 `.font` 来源均为 `parsed`，无需重新导入或重建数据库；核对时 39 个来源全部已解析。 |
| iPhone Files | PASS，iOS 27 iPhone 18 Pro 模拟器的一批 63 项结果显示成功 42、重复 7、失败 14；结果明细可打开，刷新查询后汇总仍可见。 |
| iPad Files 与 ZIP | PASS，iPadOS 27 iPad mini 模拟器的工具栏入口：含中文子目录字体、损坏字体和说明文件的 ZIP 返回成功 1、失败 1；同时多选原字体和该 ZIP，返回成功 0、重复 2、失败 1，明细展示压缩包名与条目路径；字体库仍为 2 个托管文件、1 个字体家族，临时目录为空。取消选择不产生错误并保留原报告。 |

默认边界保持单字体 64 MiB、单 ZIP 256 MiB、每包 10,000 条目、每批 1,000 字体、字体读取与解压总量 512 MiB。资源限制测试使用缩小的内部测试额度，验证实际字节检查与清理逻辑；没有在设备上生成全部上限体积的压力样本。

Android 原生结果界面的完整交互、所有字体的真机预览与再次冷启动、iOS 实机 Files/iCloud 文件读取和性能压力测试仍待验收。本轮 iOS 设备 slice 已构建，未进行实机签名、安装或运行；阶段 D 仍为 PARTIAL。

## Environment

macOS 27.2 arm64、Xcode 27.0（27A266a）、Rust 1.98.1、Node.js 24.14.1、pnpm 11.19.0、JDK 17.0.19、CocoaPods 1.16.2。Rust Android 库使用 NDK 29.0.13846066；Expo 生成工程使用其默认 NDK 27.1.12297006。依赖以本目录 `package.json` 和 `pnpm-lock.yaml` 为准。

## Verified

| 验证 | 结果与实际范围 |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS；独立 workspace，未改变桌面依赖或根锁文件。 |
| `pnpm bindings` | PASS；UniFFI 0.32.1 生成 Swift/Kotlin；使用全局配置及 Kotlin 错误字段 rename，未修改 Rust ABI。 |
| `pnpm rust:android` | PASS；arm64-v8a、x86_64 的真实 release `.so`；arm64 ELF 的 LOAD alignment 为 `0x4000`。 |
| `pnpm rust:ios` | PASS；arm64 iOS 设备与 arm64 模拟器静态库组成 XCFramework。 |
| 两端 Expo autolinking `resolve` | PASS；识别 `FolioNativeModule` 和本地模块工程。 |
| `pnpm typecheck` / `pnpm lint` | PASS。 |
| `pnpm test` | PASS，6 项；分页参数透传、无效参数、调用前取消、调用中取消与迟到结果、取消后原生失败、错误边界。 |
| `pnpm samples` / `pnpm test:swift` | PASS；真实 Swift ↔ Rust 临时数据库、五个合法样本导入、分页、不为零的 TTC index、变量轴读取、收藏重新打开后保留、损坏文件拒绝；macOS CoreText 指定 TTC index 1 得到 Lato Bold。不是移动预览验收。 |
| `pnpm exec expo install --check` | PASS，SDK 依赖匹配。 |
| `pnpm exec expo export --platform all --output-dir .build/bundle` | PASS，Android/iOS Hermes 包生成。 |
| Android `:app:assembleDebug` | PASS；APK 包含两种 ABI 的 `libfolio_ffi.so` 和 JNA `libjnidispatch.so`。 |
| iOS arm64 Simulator Debug `xcodebuild` | PASS，完整 App 编译与链接。无实机签名/发布验证。 |

原生应用构建命令（从本目录执行）：

```sh
cd android
./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a,x86_64
cd ..
xcodebuild -workspace ios/Folio.xcworkspace -scheme Folio \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .build/xcode ARCHS=arm64 ONLY_ACTIVE_ARCH=YES \
  CODE_SIGNING_ALLOWED=NO build
```

## Build Findings

- 初次 Kotlin 编译发现错误记录的 `message` 与 `Throwable.message` 冲突；已用 UniFFI 官方 rename 配置生成 `detail`，后续 APK 构建通过。生成前清理本地生成目录，避免遗留旧 package。
- 当前中文路径在 CocoaPods 1.16.2 的二进制子进程输出中发生编码冲突；`pnpm pods` 只对有效 UTF-8 输出恢复编码。
- 当前含空格路径暴露 Expo Constants 和 RN 打包入口的 shell 引用问题；`pnpm pods` 修正本实验生成的 Xcode 工程引用，后续完整 iOS 构建通过。第三方安装文件不改动。
- XCFramework 暂无 Intel Simulator slice。第一次通用模拟器构建包含 x86_64，已改用明确的 arm64 构建；不宣称 Intel Simulator 可用。

## Runtime Boundary

2026-09-30 补充运行验证：iOS 27 的 iPhone 18 Pro 模拟器已从 Xcode 直接构建启动，显示 Folio 主界面和空库查询结果。Android 改用 USB 真机 `23013RK75C`（Android 16 / API 36、arm64）：development build 编译、安装和启动通过，应用沙盒创建 `files/FolioMobilePoC/folio.sqlite`，前台 Activity 为 `.MainActivity`，用户确认显示导入按钮和搜索框。Android Studio 的 Gradle 同步通过，已识别 `app` 与该真机。

此前 Android API 37 模拟器的系统/Launcher ANR 不记作 UI 验收通过。本次按用户要求使用安卓真机，未再启动 Android 模拟器。两端完整的字体导入、TTC/变量预览和生命周期压力测试仍待验收。

字体主页已按 Figma 实现。iOS 27 模拟器确认原生 SwiftUI Menu 玻璃弹层、网格/列表菜单项、TabView 滑块拖动至云端空页、系统深色外观与 Inter 真实字体预览；更新开发包后托管字体路径恢复正常。用户确认界面无问题后停止后续测试，未将这些结果扩展为 Android 原生导航或实机性能验收。

本次未连接 WebDAV 或真实凭据，未实施正式数据库迁移。实验数据库由现有 Rust 在独立应用沙盒内创建。JS 取消不等于原生 Rust 中断。

## IDE Recovery

- Xcode 最初打开 `Folio.xcodeproj`，未包含 Pods，出现 Expo module map 缺失。打开 `Folio.xcworkspace` 后原生依赖可构建。
- iOS 27 / Xcode 27 随后暴露 Scene 生命周期启动断言。已在 `app.json` 启用当前 SDK 57 提供的 `ios.enableSceneSupport`，重新生成工程并执行 `pnpm pods`；再次 `xcodebuild` 和 Xcode `⌘R` 均通过，未升级技术栈。依据：[Apple UIKit Scene 生命周期](https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle)、当前安装的 `expo-build-properties/src/iosSceneSupport.ts`。
- Android Studio 从 GUI 启动时的 Gradle daemon 找不到 nvm Node。已复现精简 PATH 下的同一错误；停止旧 daemon 并携带当前 Node PATH 启动 IDE 后同步和构建通过。`pnpm ide:android` 固定此启动流程，`pnpm ide:ios` 固定 workspace 入口。
- Android 的 `buildArchs` 固定为 Rust 默认交付的 `arm64-v8a`、`x86_64`，避免 IDE 默认生成缺少 Rust 库的 32 位安装包。
- `pnpm prebuild` 使用 `--no-clean` 更新工程。SDK 57 的默认重建会删除原生目录；更新时保留工程并在 iOS 后执行 `pnpm pods`，避免正在打开的 IDE 引用失效。

真机启动命令（此型号已实际验证；从实验目录执行）：

```sh
pnpm start
pnpm android --device "23013RK75C" --no-bundler
```

两条命令分别在终端运行；后者复用前者的 Metro。设备通过名称选择，Expo 的 `--device` 参数不使用 adb 序列号。独立 IDE 安装时的 USB 转发和连接方法见 [README.md](README.md#ide-run)。

## Remaining Gates

| 路线图 D 实验 | 当前边界 |
| --- | --- |
| Rust ↔ RN/Expo | 双端打包/编译和主机真实调用已验证；移动实机上的查询、取消、生命周期、冷启动与内存仍待验收。 |
| 动态 TTF/OTF/TTC | 已有导入和原生预览实现及可复现样本；双端导入、非零成员、缺字、损坏/离线、反复切换需实机验证。 |
| Variable axes | 桥接返回轴范围，预览接收轴值；两轴连续拖动、实际字形变化与缓存/帧率/内存待做。 |
| iOS SwiftUI / Android Compose、MIUIX / Liquid Glass navigation | iOS 已接入原生 TabView、Menu 和 Button，模拟器玻璃菜单及 Tab 拖动切页已确认；Android Compose、MIUIX 与实机导航性能仍待验收。 |
| Android DocumentsProvider / SAF/USB | 未开始；系统 Picker 导入不等于字体 Provider 或导出。 |
| iOS Files/Share / File Provider 需求判定 | 文件选择接入；分享导出与 Provider 需求判定尚未完成。 |

阶段 D 保持 PARTIAL，生产采用结论仍待 go/no-go。真实设备、目标 ROM、许可和性能阈值需在后续实验记录中明确；不能从本次构建结果推断。
