<div align="center">
  <img src="apps/desktop-ui/src-tauri/icons/128x128@2x.png" width="128" height="128" alt="Folio 应用图标">
  <h1>Folio</h1>
  <p>跨平台字体资产管理器</p>
</div>

Folio 用于整理、检索、预览和同步本地字体资产。项目以跨平台 Rust 字体目录为
核心，提供 macOS 原生客户端，以及由 React 和 Tauri 2 承载的 Windows/Linux
桌面客户端；移动端目前位于隔离的概念验证工程中。

> 当前项目仍在开发阶段。各平台能力和验收范围并不完全相同，请以
> [项目路线图](FOLIO_ROADMAP.md)中的状态说明为准。

## 主要能力

- 递归扫描目录或显式扫描文件，并解析 TTF、OTF、TTC 和 OTC 字体。
- 读取字体家族、字重、字宽、样式、版本、语言名称、变量轴、命名实例、
  OpenType 特性、许可证和字符脚本等元数据。
- 使用 BLAKE3 生成稳定的字体身份、修订、字体面和家族标识；文件路径不会影响
  字体身份或修订。
- 跨文件、目录和字体集合聚合家族，同时保留重复来源、多修订和元数据冲突信息。
- 使用 SQLite 保存字体库根目录、可重建解析缓存、收藏夹、收藏状态、最近访问和
  智慧收藏夹。
- 提供 Unicode 规范化搜索、多维筛选、分页、范围查询和字体库健康分析。
- 支持增量刷新：未变化的文件直接复用缓存，时间变化时重新校验内容，只有内容
  真正变化时才重新解析。
- 提供命令行检查工具、UniFFI 接口、WebDAV 同步模块和在线字体模块。
- 提供 macOS SwiftUI 客户端，以及 Windows/Linux 共用的 React/Tauri 桌面界面。

目前尚未完整交付文件系统实时监听、WOFF/WOFF2 解析、跨平台字符表、Linux 实机
验收，以及 Windows/Linux 完整字体安装流程。WebDAV、在线字体、智慧收藏夹和移动
端也仍有待补充跨设备或目标平台验收。

## 项目结构

```text
Folio/
├── apps/
│   ├── macos/                 # macOS SwiftUI 客户端
│   └── desktop-ui/            # Windows/Linux React + Tauri 客户端
├── crates/
│   ├── folio-core/            # 字体扫描、解析、身份与家族聚合
│   ├── folio-storage/         # SQLite 持久化与增量缓存
│   ├── folio-query/           # 搜索、筛选、分页与健康分析
│   ├── folio-cli/             # 命令行检查工具
│   ├── folio-ffi/             # 面向客户端的 UniFFI 接口
│   ├── folio-sync/            # WebDAV 同步
│   └── folio-online/          # 在线字体目录与下载
├── experiments/mobile/        # Android/iOS 隔离概念验证
├── locales/                   # 三端共用的界面语言目录（zh-CN 源、en）
├── fixtures/fonts/            # 可再分发的测试字体
├── docs/                      # 架构、审计与开发文档
└── FOLIO_ROADMAP.md           # 当前能力状态与开发路线
```

## 环境要求

### 通用环境

- Rust 1.91 或更高版本
- Node.js 20.19 或更高版本，或 Node.js 22.12 或更高版本
- pnpm 11.19.0

仓库根目录的 `package.json` 固定了 pnpm 版本。JavaScript 依赖和脚本统一使用
pnpm 管理。

### Windows 额外环境

- Visual Studio 2022 Build Tools
- “使用 C++ 的桌面开发”工作负载和 Windows SDK
- Rust stable MSVC 工具链
- WebView2 Runtime（Windows 10/11 通常已预装）

```powershell
rustup default stable-msvc
```

### Linux 额外环境

Debian/Ubuntu 可安装以下 Tauri 系统依赖：

```sh
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### macOS 额外环境

安装当前稳定版 Xcode 及其命令行工具，并确保本机已有可用的 Rust 工具链。

## 获取与构建

安装前端依赖：

```sh
pnpm install
```

构建全部 Rust 工作区成员：

```sh
cargo build --workspace
```

构建 Windows/Linux 共用前端：

```sh
pnpm -C apps/desktop-ui build
```

## 管理脚本

仓库提供统一的管理脚本，用于三个客户端框架的开发调试、构建和版本号批量提高。
无参数运行会进入交互式 TUI，也可以直接使用命令行参数：

```sh
node tools/folio.mjs                              # 交互式 TUI
node tools/folio.mjs doctor                       # 检查构建前置条件
node tools/folio.mjs swiftui build                # 构建 macOS 客户端
node tools/folio.mjs tauri build --platform windows
node tools/folio.mjs expo build --platform android
node tools/folio.mjs version bump patch --build   # 提高版本号并提交打标签
```

脚本使用 Node.js 实现，不产出也不依赖 cmd/ps1；交互式界面依赖 `@clack/prompts`，
使用前先执行 `pnpm install`。完整命令、主机支持矩阵与版本号写入点见
[管理脚本文档](docs/management-script.md)。

## 运行桌面客户端

### Windows/Linux

启动 Tauri 开发环境：

```sh
pnpm -C apps/desktop-ui tauri dev
```

生成当前平台的安装包：

```sh
pnpm -C apps/desktop-ui tauri build
```

### macOS

使用 Xcode 打开 `apps/macos/Folio.xcodeproj`，选择 `Folio` 方案后运行或构建。

## 使用命令行工具

扫描目录（默认递归扫描）：

```sh
cargo run -p folio-cli -- scan <字体目录>
```

常用参数：

- `--no-recursive`：只扫描目录顶层。
- `--show-internal`：显示被归类为内部字体的字体面。
- `--json`：输出稳定的检查用 JSON；该格式不是持久化或 FFI 协议。
- `--verbose`：在标准错误输出调试日志。

显式扫描多个文件：

```sh
cargo run -p folio-cli -- scan-files font1.ttf font2.otf font3.ttc
```

显式传入的文件不要求具有已知扩展名，每个路径都会作为候选字体处理。

## 测试与代码检查

运行 Rust 测试：

```sh
cargo test --workspace
```

检查 Rust 格式和静态分析：

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
```

检查并测试 Windows/Linux 前端：

```sh
pnpm -C apps/desktop-ui typecheck
pnpm -C apps/desktop-ui lint
pnpm -C apps/desktop-ui test
```

## 技术边界

- `folio-core` 保持无界面、无数据库和无平台 API，负责跨平台字体语义。
- `folio-storage` 负责设备本地持久化和可重建缓存，`folio-query` 统一查询语义。
- macOS 客户端使用 SwiftUI/AppKit 和 UniFFI。
- Windows/Linux 客户端共用 React、TypeScript、Vite、Tauri 2、HeroUI v3 和
  Tailwind CSS v4。
- 移动端隔离工程已接入 RN/Expo 字体管理和第五批 WebDAV 同步基础（平台安全凭据、手动同步、取消与真实进度）；独立服务商实网双向验收仍待完成，尚未确定
  正式客户端架构。

## 延伸阅读

- [项目路线图](FOLIO_ROADMAP.md)：当前能力、验证缺口和后续阶段。
- [管理脚本](docs/management-script.md)：多框架调试、构建与版本号批量提高。
- [核心架构](docs/architecture.md)：字体身份、修订、家族聚合和持久化设计。
- [第一阶段报告](docs/PHASE1_REPORT.md)与[第一阶段审计](docs/PHASE1_AUDIT.md)：
  字体目录核心的实现与验证。
- [第二阶段 A 报告](docs/PHASE2A_REPORT.md)与[第二阶段 A 审计](docs/PHASE2A_AUDIT.md)：
  SQLite 持久化和增量刷新。
- [第二阶段 B 报告](docs/PHASE2B_REPORT.md)：用户状态、元数据和查询能力。
- [第三阶段界面报告](docs/PHASE3_UI_REPORT.md)：macOS 界面的阶段性验证。
- [同步迁移报告](docs/sync-migration-v7-report.md)：当前同步模型、迁移与已知边界。
- [移动端实验说明](experiments/mobile/README.md)：隔离概念验证的范围和运行方式。
- [测试字体说明](fixtures/fonts/README.md)：字体样本来源与许可证。

## 鸣谢
- [Nexio课程表](https://github.com/HaoZai000/NexioSchedule)：安卓端底部导航栏参考
- [Kyant0](https://github.com/Kyant0): 液态玻璃与平滑圆角

## 许可证

Folio 以 GNU Affero 通用公共许可证第 3 版（仅该版本，
`AGPL-3.0-only`）发布，完整条款见 [LICENSE](LICENSE)。第三方依赖及测试字体
保留各自的许可证；测试字体的许可信息见[测试字体说明](fixtures/fonts/README.md)。
