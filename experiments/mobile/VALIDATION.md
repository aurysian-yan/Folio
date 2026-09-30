# Mobile Foundation Validation

日期：2026-09-30。当前基线提交 `75869e7`；本次范围是路线图 D 的隔离基础工程，不是阶段 D 全部通过或阶段 E 正式移动客户端。

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
| iOS SwiftUI / Android Compose、MIUIX / Liquid Glass navigation | 未开始；本次只有原生预览容器和系统文件选择入口，没有这些 UI 互操作验证。 |
| Android DocumentsProvider / SAF/USB | 未开始；系统 Picker 导入不等于字体 Provider 或导出。 |
| iOS Files/Share / File Provider 需求判定 | 文件选择接入；分享导出与 Provider 需求判定尚未完成。 |

阶段 D 保持 PARTIAL，生产采用结论仍待 go/no-go。真实设备、目标 ROM、许可和性能阈值需在后续实验记录中明确；不能从本次构建结果推断。
