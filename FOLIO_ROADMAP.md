# Folio Roadmap

审计基准：2026-09-30，`93697a4`。状态表示**当前仓库中的能力**，不是发布日期或跨设备验收结论。`COMPLETE` 表示有实现及相应仓库/阶段验证；`PARTIAL` 表示已有可运行路径但关键流程、目标平台或实机验收缺失；`NOT STARTED` 表示没有该产品能力。历史阶段报告只证明报告当时的范围；后续源码与 [同步迁移报告](docs/sync-migration-v7-report.md) 优先。本文取代 [旧开发计划](docs/project-development-plan.md) 的执行顺序。

## Current State

| 能力 | 状态 | 源码与实际边界 |
| --- | --- | --- |
| Rust Core | COMPLETE | `crates/folio-core` 解析 TTF/OTF/TTC/OTC、变量轴、身份/修订、家族聚合、诊断；[Phase 1 报告](docs/PHASE1_REPORT.md) 与 [审计](docs/PHASE1_AUDIT.md)。WOFF/WOFF2 仍是已识别但不支持。 |
| Storage / Query | COMPLETE | `folio-storage` 的 SQLite 根目录、缓存、持久用户状态及 `folio-query` 的搜索、Facet、分页、健康分析已实现；[2A 报告](docs/PHASE2A_REPORT.md)、[2A 审计](docs/PHASE2A_AUDIT.md)、[2B 报告](docs/PHASE2B_REPORT.md)。目前 schema v9，不能用旧报告的 v1/v2 代表当前 schema。 |
| Collections / Favorites / Recent | COMPLETE | 手动收藏夹、收藏、显式最近访问由 Storage 持久化，经 UniFFI、macOS 与 Tauri 界面使用；长期引用以 `FontIdentityId` 为锚。跨设备同步场景的验收单列于同步项。 |
| Smart Collection | PARTIAL | 已有 `smart_folders` schema、`SavedFontQuery`、UniFFI/Tauri 命令、macOS 与 React 管理界面，以及同步事件/冲突代码；旧计划“阶段 10 从零实现”已失效。缺独立的跨端、迁移、同步并发与离线回归验收记录。 |
| Incremental Refresh | COMPLETE | Storage 的 metadata 命中、改时间后 hash、真实变更重解析及离线根保留已有测试；macOS 启动/导入/目录操作和 Tauri 刷新均接入。`COMPLETE` 不含文件系统 watcher 或实时热重载；大小与 mtime 未变时有明确缓存假设。 |
| macOS UI | PARTIAL | `apps/macos/Folio.xcodeproj`、SwiftUI 四种浏览模式、查询/筛选、Inspector、预览、云库、在线字体与智慧收藏夹均有源码；[Phase 3 UI 报告](docs/PHASE3_UI_REPORT.md) 证明其当时的构建及基础交互。后续功能缺一份覆盖当前提交的整体验收报告。 |
| macOS 字体导入、启用、安装 | PARTIAL | `FontOperations.swift` 与 `LibraryViewModel.swift` 已有复制/引用、批量结果和重试、CoreText 会话注册及持久注册、Finder 打开入口。属于已实现路径，不应重做 Phase 3C；仍需针对当前版本做真实文件、权限、失败恢复和卸载边界的回归。 |
| WebDAV / 123PAN | PARTIAL | `folio-sync` 已有 WebDAV v1 事件/对象、上传下载、取消/重试、续传、云端占位与冲突；macOS、Tauri 均有连接与同步入口。123PAN 使用 WebDAV，不是独立协议。[v7 迁移报告](docs/sync-migration-v7-report.md) 记录单设备连接修复及一次成功同步，**双设备、断网恢复、冲突处理和 123PAN 实网矩阵仍未验收**。现有协议足以启动移动 PoC，不足以宣布移动同步可交付。 |
| Tauri / Windows baseline | PARTIAL | `apps/desktop-ui` 已有完整 React 页面、四种浏览样式、分页/预览、收藏/智慧收藏夹、同步设置；`src-tauri` 直接使用 Rust crates，并有 Windows 默认目录、渲染和命令。旧文档的“只有依赖基线”已失效。尚无完整 Explorer 批量导入、Windows 字体启用/安装流程及本轮 Windows 打包/运行验收；Linux 更未实测。 |
| Character Map | NOT STARTED | Core 已观察 `cmap` 以统计脚本、桌面端也用其做预览采样，但没有面向产品的码点/Glyph ID 枚举、分页、检索接口或字符表页面；不能把预览采样算作字符表。 |
| Android / iOS | PARTIAL（隔离 PoC） | `experiments/mobile` 已建立 RN/Expo、UniFFI 本地模块、导入/查询与原生预览基础；双端 Rust 打包、Android APK 和 arm64 iOS Simulator App 构建已通过，见 [验证记录](experiments/mobile/VALIDATION.md)。未交付正式移动客户端、`DocumentsProvider` 或 File Provider；架构 go/no-go 与实机验收仍待完成。 |
| 在线字体 | PARTIAL | `folio-online`、macOS 在线浏览与下载已有实现；旧 README 仍称未实现。镜像可用性、来源许可和跨平台范围需另验。 |

本轮检查：`git status --short` 起始为空；`git log --oneline -n 20` 最新为 `93697a4`。Windows 主机上 `pnpm -C apps/desktop-ui typecheck`、`lint` 与 `test` 通过（12 个文件、69 项测试）。`cargo test --workspace` **退出码 1**：`folio-storage` 的 `root::tests::timestamps_keep_nanoseconds_and_reject_unrepresentable_values` 得到 `1234567890123456700` 而非 `1234567890123456789`；`db::tests::failed_commit_rolls_back_cache_changes` 的 `invalid.is_empty()` 断言失败。源码中后者用 `Path::new("/tmp/font.ttf")` 构造缓存来源，Windows 上该路径的绝对性假设需核查；前者需核查 Windows `SystemTime` 精度。此处记录测试失败，**不能据此断定生产事务回滚失效**。本轮没有 macOS、Android、iOS 或 Linux 运行验证。

## Architecture Decisions

1. `folio-core` 保持无平台 API；`folio-storage` 负责设备本地 SQLite 与可重建缓存；`folio-query` 是查询语义唯一来源。同步 wire schema 不等于 SQLite schema。所有客户端复用身份、查询、Facet 和冲突语义，不复制算法。
2. 用户状态锚定 `FontIdentityId`；具体二进制用 `FontRevisionId`，当前目录行用 `FontFaceId`。导入路径和库根不参与字体身份。添加目录、复制收集、会话启用、持久安装是不同操作。
3. macOS 保持 SwiftUI/AppKit + UniFFI；Windows/Linux 保持 React/TypeScript/Vite/Tauri 2 与仓库选定的 HeroUI v3/Tailwind v4。移动端 UI 技术栈尚未决定，不能从桌面 React 直接推出 RN 复用。
4. WebDAV 是共用协议，123PAN 作为服务端接入。凭据由各平台安全存储持有；同步状态、文件可用性和冲突必须是真实后端状态。目录缓存清理不得损伤用户状态。
5. **大卡片只有两种 presentation**：现有大卡片样式与 iPod / Cover Flow 样式。它们共用同一 query、分页、选中字体、preview、inspector 和收藏状态。Cover Flow 是大卡片视图内部样式选择，不是第五种顶层 View Mode；切换样式不重建查询或丢失选择。已有四种顶层浏览模式保持四种。
6. 手动收藏夹保存成员；智慧收藏夹保存查询条件，由当前库动态计算成员。现有实现应验收和修正，不再列为新建模块。

## Decisions To Validate

### RN + Expo 是否作为 Android/iOS 共享应用层

**候选，尚未批准为生产架构。** Folio 的 Library、Font Card/Grid、搜索、查询状态、收藏夹和云库状态适合共享 React Native 页面结构与业务状态；Rust 仍是事实来源。收益是两端功能一致、移动页面与状态只维护一次。风险集中在任意用户字体的精确 Face/TTC 渲染、变量轴、复杂大网格性能、原生导航的视觉/交互一致性，以及原生文件扩展与 Rust 包装的构建成本。通过 PoC 后再比较“RN 共享层 + 平台原生外壳”与 Kotlin/Compose + SwiftUI 两套客户端的实际维护成本；不设共享率 KPI。

Expo 当前文档说明 `@expo/ui` 可从 React 使用 SwiftUI/Jetpack Compose 组件，也能混排 RN 视图，但跨框架布局边界需要控制；它是**组件互操作层**，不是 Folio 全部原生能力的替身。[Expo UI](https://docs.expo.dev/versions/v58.0.0/sdk/ui/)；[自定义原生代码](https://docs.expo.dev/workflow/customizing/)。Expo Router 原生 Tabs/Stack 可先验证 iOS 系统 Liquid Glass 行为，Android 定制底栏仍可做独立实现；Expo UI 的现有组件目录不等于 MIUIX 或自定义导航已获支持。[原生 Tabs](https://docs.expo.dev/router/advanced/native-tabs/)。需要自定义模块时使用 development build，不能以 Expo Go 作为完整 PoC 环境。[开发构建](https://docs.expo.dev/develop/development-builds/faq/)。

| 层 | 候选分工 |
| --- | --- |
| 共享 RN | Library 页面骨架、Font Card/Grid、查询与分页状态、搜索/筛选/手动及智慧收藏夹、下载/离线状态呈现、无平台字体 API 的交互。大列表需验证虚拟化与预览复用。 |
| `.ios` | 系统 Navigation/Tab/Sheet/Menu、适合的 SwiftUI 原生控件与 Liquid Glass、文件导入/分享入口；需要时将整个导航容器留给原生，不为共享 JSX 牺牲系统行为。 |
| `.android` | Compose 或经验证的 MIUIX 控件、系统返回/窗口 inset、原生菜单与 Sheet、可选自定义 Liquid Glass 风格底栏；效果须验证可访问性、性能与 ROM 兼容，不能以截图代替。 |
| Rust 桥接 | 首选复用现有 `folio-ffi` 的 UniFFI Swift/Kotlin bindings，在薄 Expo Native Module 中封装异步调用、错误和生命周期；Android Kotlin UniFFI/JNA 打包、线程及性能必须 PoC。若不合格，再比较专用 C ABI/JNI 或 TurboModule，不在 JS 中重新实现 Core。UniFFI 官方说明支持 Swift/Kotlin，Kotlin 使用 JNA；Expo 支持本地 Swift/Kotlin 模块。[UniFFI](https://mozilla.github.io/uniffi-rs/latest/)、[Kotlin/Gradle](https://mozilla.github.io/uniffi-rs/latest/kotlin/gradle.html)、[Expo Modules](https://docs.expo.dev/modules/module-api/)。 |
| 原生文件服务 | Android `DocumentsProvider` 必须是 Android `ContentProvider`/manifest/URI 授权实现，按需下载与取消在原生服务中安全调用 Rust；SAF/USB 导出另验。iOS 先验证 Files/Share 和本地文档暴露需求；只有需要让其他应用按需浏览云端树时才规划 File Provider 扩展，它是独立原生 extension，须处理 app group、进程和同步生命周期。[Android DocumentsProvider](https://developer.android.com/guide/topics/providers/create-document-provider)、[Apple File Provider](https://developer.apple.com/documentation/fileprovider)。 |

Expo Font 文档对运行时 TTF/OTF 和新版变量轴提供支持，但不能据此认定 Folio 所需的 **TTC/OTC 指定 face index、任意轴、无安装渲染及反复切换**已可靠；官方格式指南只保证 TTF/OTF。优先验证原生 CoreText/`Typeface.Builder` 预览容器，并以文件 + face index + axes + revision 作为缓存键。Android `Typeface.Builder` 有 `setTtcIndex` 与 `setFontVariationSettings`。结论取决于实机 PoC。[Expo Fonts](https://docs.expo.dev/develop/user-interface/fonts/)、[Android Typeface.Builder](https://developer.android.com/reference/android/graphics/Typeface.Builder)。

### 独立移动 PoC 门槛

PoC 放在独立临时工程或隔离工作区，使用固定许可测试字体、临时库和可删除凭据；产出报告、样本与决策记录。验证通过前不改生产 `folio-ffi` ABI、持久 schema、`apps/macos` 或 Tauri 架构，也不把实验页面并入正式客户端。

| PoC | 最小验证与通过门槛 |
| --- | --- |
| Rust ↔ RN/Expo | 两端 development build 调用同一 Core/Storage/Query 的真实查询、分页、错误、取消；证明 Android ABI/JNA 与 iOS 静态库打包、后台线程、内存占用和冷启动可控。 |
| 动态 TTF/OTF/TTC | 用户导入文件，不预置为应用字体；两端准确显示指定 Face，含非零 TTC index、无字形与损坏/离线文件状态，不静默回退为系统字体。 |
| Variable axes | 读取 Rust 轴范围/实例，连续拖动至少两轴；实际字形变化可核对，缓存与换字体不串 Face，帧率和内存满足目标设备验收阈值（PoC 报告先记录设备与阈值）。 |
| iOS SwiftUI | RN 页面内接入真实 SwiftUI 原生 Sheet/Menu 或导航组件，验证 iOS 版本差异、Liquid Glass、焦点、VoiceOver、暗色与返回状态保留。 |
| Android Compose / MIUIX | Expo 模块承载真实 Compose 控件；MIUIX 仅在许可、依赖、目标 ROM 兼容都可复现时采用，验证触摸、TalkBack、系统返回和主题。 |
| Android Liquid Glass navigation | 比较系统/Compose 底栏与自定义玻璃效果，在目标 ROM 上检查 inset、手势、键盘、无障碍和低端机性能；失败时保留可靠的原生底栏。 |

## Revised Roadmap

阶段按**依赖和可验收结果**排序，不映射旧 Phase 编号。每阶段交付记录实际执行命令、设备/OS、成功与未验证项；跨平台验收不得用 Windows 构建代替 macOS/移动实机。

### A. 当前桌面基线与同步可信度

- **Goal：**把现有 macOS/Tauri 能力从“源码已接入”提升为可依赖的基线。
- **Scope：**先复现并归因本轮两项 Windows `folio-storage` 测试失败，恢复可信的跨平台测试基线；核对 schema v9 迁移；macOS 导入/启用/安装/移除真实回归；WebDAV/123PAN 双设备新增/删除/离线恢复/取消续传/冲突/凭据失效；智慧收藏夹跨设备与手动收藏夹互不干扰；Windows 当前页面和同步真实运行检查。修复验收中发现的 blocker。
- **Dependencies：**现有 Rust、macOS、Tauri 实现；两台可访问同一测试 WebDAV 的设备。
- **Deliverables：**当前版本验收报告、问题清单、必要修复与迁移回归样本。
- **Acceptance Criteria：**Windows `cargo test --workspace` 通过或每项剩余失败有明确处置结论；测试矩阵中的双设备收敛、离线恢复、可逆冲突选择及用户状态保留可复现；macOS 本地操作在真实字体文件上通过；Windows 页面与同步状态来自真实后端。未通过的子能力仍标 PARTIAL。
- **Explicitly Out of Scope：**Cover Flow、watcher、字符表、移动正式客户端和界面装饰优化。

### B. Windows 桌面闭环

- **Goal：**在已有 Tauri 页面上完成 Windows 用户最基本的字体库工作流。现有实现投资和 Rust/Tauri 边界使 Windows 比从零启动 Android 更适合先推进主线。
- **Scope：**Explorer 多文件打开/单实例转交、复制或引用与逐项结果、Windows 用户范围字体启用/停用/安装/卸载适配、权限/失败恢复、现有查询与同步回归；仅修复阻碍流程的 UI 问题。
- **Dependencies：**A 的存储/同步可信度；目标 Windows 机器。
- **Deliverables：**可安装 Windows 构建、操作适配、端到端验收记录。
- **Acceptance Criteria：**真实 Windows 上完成导入→浏览/预览→收藏→同步→恢复→字体操作；重复项和失败不会静默覆盖或丢失；重启后状态一致。
- **Explicitly Out of Scope：**Linux 完成声明、跨平台字符表、Cover Flow、移动端。

### C. Character Map 共享契约与桌面页面

- **Goal：**在移动正式页面增加之前定义一次正确的字符映射接口；不再排在 Android 完成之后。
- **Scope：**Rust 按具体来源及 collection face index 枚举 Unicode scalar/Glyph ID/脚本，稳定分页与 U+ 检索；UniFFI/Tauri 同义暴露；macOS/Windows 页面与准确 Face 渲染、复制、离线/损坏状态。
- **Dependencies：**稳定的 Face/source/axes 契约；B 的 Windows 本地文件与预览闭环。Rust 接口设计可先于 B 并行开始。
- **Deliverables：**共享接口、两端页面与 TTF/OTF/TTC/变量字体测试矩阵。
- **Acceptance Criteria：**非零 TTC 成员、大型 cmap、变量轴和不可读来源的结果正确；返回库时保留查询、分页和选择；键盘/读屏可用，不静默换相似字体。
- **Explicitly Out of Scope：**未编码 glyph、复杂连字塑形、WOFF/WOFF2、Linux 实机验收。

### D. 移动架构 PoC 与决策

当前已建立 [隔离基础工程](experiments/mobile/README.md)、[边界决策](experiments/mobile/DECISION.md) 和 [验证记录](experiments/mobile/VALIDATION.md)。本次只打通基础打包与调用路径，阶段 D 保持 PARTIAL；RN + Expo 未被批准为生产架构。

- **Goal：**确定 RN + Expo 混合原生方案能否达到 Folio 的字体准确性和平台体验要求。
- **Scope：**完成上表六个隔离 PoC；额外做 Android `DocumentsProvider` 的最小 URI/按需读取实验和 iOS Files/Share 与 File Provider 需求判定；比较双原生备选。
- **Dependencies：**现有 Core/UniFFI；不等待 A、B、C 全部完成，可与之并行。
- **Deliverables：**PoC 工程、设备/版本/性能数据、桥接与 UI 边界 ADR、是否采用 RN 的明确 go/no-go。
- **Acceptance Criteria：**每个实验有通过/失败证据；若关键 TTC/变量轴、原生导航或 Provider 集成无法可靠达标，选用 Kotlin/Compose 与 SwiftUI 双原生应用层，继续共享 Rust。
- **Explicitly Out of Scope：**正式移动数据库迁移、上线 UI、追求固定代码共享比例。

### E. 移动字体库首版

- **Goal：**先交付 Android 的随身字体库，再在经 PoC 验证的共享层上推进 iOS；若 D 选择双原生，则按同一业务契约分别实施。
- **Scope：**Library/Card/Grid、查询/搜索/手动与智慧收藏夹、真实 Face 预览与变量轴、离线副本、WebDAV/123PAN、导入/导出；Android `DocumentsProvider`、SAF/USB；iOS Files/Share。平台导航和控件按 D 的 ADR 处理。
- **Dependencies：**A 的双设备同步验收、D 的移动架构结论、C 的字符表接口契约（首版页面可排后）。
- **Deliverables：**Android 实机首版、iOS/iPadOS 实机首版、平台文件互操作与同步验收报告。
- **Acceptance Criteria：**Android 标准 Picker 与目标 ROM/调用方验证 URI 权限、云端按需下载和断网行为；iOS Files/Share 可用；两端真实文件与同步结果一致。iOS File Provider 仅在产品需求确认后单独验收，不能以 Files 导出冒充云端 Provider。
- **Explicitly Out of Scope：**Android 系统级字体安装承诺、未验证的 MIUIX/玻璃效果、两端像素一致。

### F. 后续增强与 Linux/v2

- **Goal：**按实际使用数据完善体验并扩展格式/平台。
- **Scope：**大卡片内的 Cover Flow presentation、macOS 目录 watcher/热重载、桌面性能与可访问性 polish；Linux 复用 Tauri 页面并做 WebKitGTK/fontconfig/打包实测；WOFF/WOFF2 管理与预览另立格式验收。字符表移动页面可在 E 后接入。
- **Dependencies：**前述核心工作流稳定；Linux/格式各有独立样本与运行环境。
- **Deliverables：**逐项独立 ADR/验收，不把不同增强捆为一个不可拆阶段。
- **Acceptance Criteria：**Cover Flow 不改变四种顶层模式且共享选择/分页状态；Linux 在目标发行版实测；WOFF/WOFF2 清楚区分可管理、可预览与可系统安装。
- **Explicitly Out of Scope：**将 polish 当作 A–E 的前置门槛，或承诺未经平台验证的安装能力。

## Parallel Work

- A 的 macOS 操作/同步矩阵与 B 的 Windows 缺口分析可并行；B 的同步最终验收依赖 A 的协议结论。
- D 的六个移动 PoC 可在隔离工程并行于 A/B；其中 Rust bridge 与动态字体预览先行，平台导航/控件实验可随后独立推进。
- C 的 Rust cmap 契约可与 B 的 Explorer/字体操作并行；Windows 字符页面验收需等待 B 的来源与预览闭环。
- Android Provider URI 实验和 iOS Files/Share 需求调研可提前进行；完整同步与离线验收须在 A 完成后。
- Cover Flow、watcher、动效和视觉微调是可延期 polish，不阻断 Windows 或移动 PoC。

## Deprecated Plan Items

1. 旧计划“封面流第五种视图模式”无效；改为大卡片内部第二种样式，现有四种顶层模式不增加。
2. 旧计划将 WebDAV 当作未来阶段从零建立、将智慧收藏夹当作阶段 10 从零创建、将 Windows/Tauri 当作依赖空壳，都与当前源码冲突；改为现有实现的验收和缺口补齐。
3. 旧计划固定 Android=Kotlin/Compose/MIUIX、iOS=SwiftUI 的结论降为比较基线；RN+Expo 共享应用层须经 D 的 go/no-go，不预先承诺。
4. 旧顺序“Android 完成后才做 Character Map”撤销；共享映射契约在移动正式开发前确定，桌面页面在 Windows 闭环后验收。
5. 旧文档中 macOS Phase 3C/3D 的已实现内容不重开同名阶段；目录 watcher、实时热重载与 Cover Flow 均属延期增强。README、`docs/architecture.md` 与 AGENTS.md 中“仅依赖基线/无 UI/无同步”等句子也是历史状态，后续应单独做文档清理，不作为执行事实。

## Immediate Next Step

执行 **阶段 A 的桌面基线与同步验收**：先归因并处理本轮 Windows `folio-storage` 两项测试失败，明确是测试跨平台假设还是生产行为问题；随后用当前 schema v9 和两台设备建立可重复的 WebDAV/123PAN 测试矩阵，覆盖双向新增/删除、断网续传、并发收藏夹/智慧收藏夹修改及冲突恢复，同时回归 macOS 导入/启用/安装。把失败项转成具体修复任务。Windows 主线和移动 PoC 可并行启动；Cover Flow 不占用这一关键路径。
