# 管理脚本

`tools/folio.mjs` 是 Folio 的统一管理脚本，负责三个客户端框架的开发调试、
构建，以及全平台版本号的批量提高。脚本使用 Node.js 实现，不产出也不依赖
`.cmd`/`.ps1`；Windows 下通过 pnpm、Gradle 等标准入口调用外部工具。

## 调用方式

首次使用前先在仓库根目录安装依赖，交互式界面依赖 `@clack/prompts`：

```sh
pnpm install
```

直接运行脚本或通过根目录的 pnpm 脚本转发：

```sh
node tools/folio.mjs                 # 无参数进入交互式 TUI
node tools/folio.mjs <框架> <动作> [选项]
pnpm manage <框架> <动作> [选项]
```

不带参数且位于交互式终端时进入 TUI；使用 `help` 或在非交互式环境运行会输出
完整用法。TUI 提供方向键菜单、表单输入与改动确认，选择外部命令后会暂停界面、
原样展示命令输出，按键后返回菜单。

## 主机与目标支持

| 命令 | macOS 主机 | Windows 主机 | Linux 主机 |
| --- | --- | --- | --- |
| `swiftui dev/build` | 支持 | 不支持 | 不支持 |
| `tauri dev` | 不支持 | Windows 版本 | Linux 版本 |
| `tauri build --platform windows` | cargo-xwin 交叉编译 | 原生 MSVC | cargo-xwin 交叉编译 |
| `tauri build --platform linux` | 不支持 | 不支持 | 原生构建 |
| `expo dev/build --platform android` | 支持 | 支持 | 支持 |
| `expo dev/build --platform ios` | 支持 | 不支持 | 不支持 |

Tauri 客户端只面向 Windows 与 Linux，脚本会拒绝 `--platform macos`。Expo 的
iOS 编译天然需要 Xcode，因此在非 macOS 主机上会直接给出提示。

## 命令说明

### SwiftUI（`apps/macos`）

- `swiftui dev`：以 Debug 配置构建并启动 `Folio.app`，构建过程自动编译
  `folio-ffi` 静态库。
- `swiftui build [--dmg]`：以 Release 配置构建；`--dmg` 额外生成带
  `/Applications` 快捷方式的 DMG 安装镜像。
- `swiftui open`：在文件管理器中打开 Release 产物目录（未构建时给出提示）。

中间产物位于 `apps/macos/.build/`（已忽略提交）。

### Tauri（`apps/desktop-ui`）

- `tauri dev`：在当前主机对应的目标平台上运行开发环境。
- `tauri build [--platform windows|linux] [--arch x64|arm64]`：构建指定目标。
  Windows 目标使用 MSVC 工具链；在 macOS 或 Linux 主机上构建 Windows 版本时，
  脚本会检查 `cargo-xwin`、NSIS、LLVM 与 Windows Rust 目标，再以交叉编译方式
  执行。
- `tauri open [--platform windows|linux] [--arch x64|arm64]`：打开对应目标的产物
  目录；未指定架构时依次尝试已存在的目录。

安装包输出位于 `apps/desktop-ui/src-tauri/target/<目标三元组>/release/bundle`,
脚本也能识别本机构建的 `target/release/bundle`。

### Expo React Native（`experiments/mobile`）

- `expo dev --platform ios|android`：按需构建 Rust 绑定、生成原生工程（iOS 还会
  安装 CocoaPods），随后在设备或模拟器上运行开发构建。附加参数可用 `--` 透传，
  例如 `-- --device "手机型号"`。
- `expo build --platform android [--aab]`：本地 Gradle 构建，默认产出 APK，
  `--aab` 产出 AAB。
- `expo build --platform ios`：本地 `xcodebuild` 归档，产物为
  `experiments/mobile/.build/Folio.xcarchive`；导出 IPA 需要自行配置签名。
- `expo open --platform ios|android`：打开对应平台的产物目录（Android 为
  `android/app/build/outputs`，iOS 为 `.build`）。

`--no-rust` 和 `--no-prebuild` 可跳过对应准备步骤，用于依赖未变化时的重复构建。

### 打开产物目录

三个目标的操作菜单都提供“打开构建产物目录”，命令行对应各自的 `open` 动作。
脚本按主机选择文件管理器：macOS 使用 `open`，Windows 使用 `explorer.exe`，
Linux 使用 `xdg-open`；目录不存在时提示先执行构建。

### 版本号批量提高（`version`）

- `version show`：列出各文件当前版本，并标注是否与权威版本一致。
- `version bump <major|minor|patch|x.y.z> [--build] [--dry-run] [--no-git]`：
  以 `Cargo.toml` 的 `[workspace.package] version` 为权威来源计算新版本，并写入
  下列全部位置：

  | 文件 | 字段 |
  | --- | --- |
  | `Cargo.toml` | `[workspace.package] version` |
  | `apps/desktop-ui/src-tauri/Cargo.toml` | `[package] version` |
  | `apps/desktop-ui/package.json` | `version` |
  | `apps/desktop-ui/src-tauri/tauri.conf.json` | `version` |
  | `apps/macos/Folio.xcodeproj/project.pbxproj` | `MARKETING_VERSION` |
  | `apps/macos/Folio/Info.plist` | `CFBundleShortVersionString` |
  | `experiments/mobile/package.json` | `version`（`app.config.ts` 由此读取） |

  - `--build`：同时把 macOS 的 `CURRENT_PROJECT_VERSION` 与 `CFBundleVersion`
    递增一位。
  - `--dry-run`：只打印改动计划，不写入任何文件。
  - `--no-git`：跳过提交与打标签。

写入后脚本会同步 `Cargo.lock`（根目录与 `src-tauri` 各自），重新读回校验；任一
字段不一致即回滚。默认在全部字段写入并校验通过后，按仓库提交规范创建
`chore: 发布 vX.Y.Z` 提交并打 `vX.Y.Z` 标签，但不推送远端；使用 `--no-git`
可只改文件。

## 环境自检

`doctor` 会检查 Node.js、pnpm、cargo、Xcode、Windows 交叉编译工具链以及
Android SDK/JDK 等前置条件，并对缺失项给出安装建议：

```sh
node tools/folio.mjs doctor
```

## 错误处理

单个任务执行失败时，脚本只输出一行提示并返回菜单，不会以原始堆栈中断交互；
命令行模式则以退出码 1 结束。排查问题时设置 `FOLIO_DEBUG=1` 可额外输出完整堆栈：

```sh
FOLIO_DEBUG=1 node tools/folio.mjs
```
