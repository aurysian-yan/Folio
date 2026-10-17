# Folio Roadmap

原审计基准：2026-09-30，`93697a4`；本轮规划补充：2026-10-17，源码基准 `7d45929`，未重新执行设备验收。状态表示**当前仓库中的能力**，不是发布日期或跨设备验收结论。`COMPLETE` 表示有实现及相应仓库/阶段验证；`PARTIAL` 表示已有可运行路径但关键流程、目标平台或实机验收缺失；`NOT STARTED` 表示没有该产品能力。历史阶段报告只证明报告当时的范围；后续源码、[同步迁移报告](docs/sync-migration-v7-report.md) 与 [移动验证记录](experiments/mobile/VALIDATION.md) 优先。本文取代 [旧开发计划](docs/project-development-plan.md) 的执行顺序。

## Current State

| 能力 | 状态 | 源码与实际边界 |
| --- | --- | --- |
| Rust Core | COMPLETE | `crates/folio-core` 解析 TTF/OTF/TTC/OTC、变量轴、身份/修订、家族聚合、诊断；[Phase 1 报告](docs/PHASE1_REPORT.md) 与 [审计](docs/PHASE1_AUDIT.md)。WOFF/WOFF2 仍是已识别但不支持。 |
| Storage / Query | COMPLETE | `folio-storage` 的 SQLite 根目录、缓存、持久用户状态及 `folio-query` 的搜索、Facet、分页、健康分析已实现；[2A 报告](docs/PHASE2A_REPORT.md)、[2A 审计](docs/PHASE2A_AUDIT.md)、[2B 报告](docs/PHASE2B_REPORT.md)。2026-10-17 源码为 schema v11，v10/v11 增加文件与来源策略，不能用旧报告的版本代表当前 schema。 |
| Collections / Favorites / Recent | COMPLETE | 手动收藏夹、收藏、显式最近访问由 Storage 持久化，经 UniFFI、macOS 与 Tauri 界面使用；长期引用以 `FontIdentityId` 为锚。跨设备同步场景的验收单列于同步项。 |
| Smart Collection | PARTIAL | 已有 `smart_folders` schema、`SavedFontQuery`、UniFFI/Tauri 命令、macOS 与 React 管理界面，以及同步事件/冲突代码；旧计划“阶段 10 从零实现”已失效。缺独立的跨端、迁移、同步并发与离线回归验收记录。 |
| Incremental Refresh | COMPLETE | Storage 的 metadata 命中、改时间后 hash、真实变更重解析及离线根保留已有测试；macOS 启动/导入/目录操作和 Tauri 刷新均接入。`COMPLETE` 不含文件系统 watcher 或实时热重载；大小与 mtime 未变时有明确缓存假设。 |
| macOS UI | PARTIAL | `apps/macos/Folio.xcodeproj`、SwiftUI 四种浏览模式、查询/筛选、Inspector、预览、云库、在线字体与智慧收藏夹均有源码；[Phase 3 UI 报告](docs/PHASE3_UI_REPORT.md) 证明其当时的构建及基础交互。后续功能缺一份覆盖当前提交的整体验收报告。 |
| macOS 字体导入、启用、安装 | PARTIAL | `FontOperations.swift` 与 `LibraryViewModel.swift` 已有复制/引用、批量结果和重试、CoreText 会话注册及持久注册、Finder 打开入口。属于已实现路径，不应重做 Phase 3C；仍需针对当前版本做真实文件、权限、失败恢复和卸载边界的回归。 |
| WebDAV / 123PAN | PARTIAL | 现有单连接与 wire v1 已有上传下载、取消重试、云端占位及冲突；macOS、Tauri 均有入口。移动第六批已接通前台自动同步、云端保留、重下、删除恢复与冲突，并记录受控双库往返／故障回归。123PAN 连接已验证，但完整真机往返、独立服务商及真实桌面／移动双端矩阵仍有缺口，见 [移动同步记录](experiments/mobile/VALIDATION.md#cloud-sync-cycle-batch-6)。多端点和 LAN 尚未实现。 |
| Tauri / Windows baseline | PARTIAL | `apps/desktop-ui` 已有完整 React 页面、四种浏览样式、分页/预览、收藏/智慧收藏夹、同步设置；`src-tauri` 直接使用 Rust crates，并有 Windows 默认目录、渲染和命令。旧文档的“只有依赖基线”已失效。尚无完整 Explorer 批量导入、Windows 字体启用/安装流程及本轮 Windows 打包/运行验收；Linux 更未实测。 |
| Character Map | PARTIAL | Core 字符映射、`folio-render` 共享渲染与 UniFFI/Tauri/Expo 四项会话接口已收尾，格式、快照与分页测试通过。各端 UI 原型保留，桌面二级导航和右侧栏复用待调整，移动详情下三级页面及目标设备验收继续单列；见 [字符表验证记录](docs/character-map-validation.md)。 |
| Android / iOS | PARTIAL（隔离 PoC） | `experiments/mobile` 已建立 RN/Expo、UniFFI 本地模块、导入/查询与原生预览基础；双端 Rust 打包、Android APK 和 arm64 iOS Simulator App 构建已通过，见 [验证记录](experiments/mobile/VALIDATION.md)。未交付正式移动客户端、`DocumentsProvider` 或 File Provider；架构 go/no-go 与实机验收仍待完成。 |
| 在线字体 | PARTIAL | `folio-online`、macOS 在线浏览与下载已有实现；旧 README 仍称未实现。镜像可用性、来源许可和跨平台范围需另验。 |
| Font Health | PARTIAL | `folio-query/src/health.rs` 已分析重复来源、多修订与关键元数据冲突；Core／Storage 有扫描问题，UniFFI 刷新统计损坏，macOS／Tauri 有健康入口。但 Tauri 损坏计数目前固定为零，移动健康动作尚未接通；文件级坏字体明细及恢复闭环由 A1／E／F1 补齐，不视为已完成全面检测。 |
| 桌面独立字体安装窗口 | NOT STARTED | macOS `RootView.swift` 当前仍以 Sheet 显示 `ImportReportView`，不满足产品要求；Tauri 的设置独立窗口不算安装窗口。按 B0／B／F1 交付，复用已有字体操作，不重建核心。 |
| WOFF / WOFF2 | NOT STARTED（产品 v2 Planned） | 当前仅 magic 识别并报告 known unsupported；Metadata、Library、Preview、Search、Collections、Sync 正式纳入 F2。管理支持不等于 OS 可直接安装。 |
| 多 WebDAV 同步 | NOT STARTED | 当前只有单 profile、全局发布标记与设备 cursor；同库多副本、端点独立进度和故障切换按 G/H 实施，见 [同步架构](docs/sync-architecture.md)。 |
| 局域网多设备同步 | NOT STARTED | 发现、配对、设备信任、直接传输及与 WebDAV 混合同步按 G/I 实施；移动首期只保证前台。 |
| 官方 Release 赞助解锁 | NOT STARTED | 已有发布工作流，尚无渠道策略或赞助凭证校验；功能范围及交付门槛见 [赞助计划](docs/sponsor-release-plan.md)。自行编译默认全部开放。 |

本轮检查：`git status --short` 起始为空；`git log --oneline -n 20` 最新为 `93697a4`。Windows 主机上 `pnpm -C apps/desktop-ui typecheck`、`lint` 与 `test` 通过（12 个文件、69 项测试）。`cargo test --workspace` **退出码 1**：`folio-storage` 的 `root::tests::timestamps_keep_nanoseconds_and_reject_unrepresentable_values` 得到 `1234567890123456700` 而非 `1234567890123456789`；`db::tests::failed_commit_rolls_back_cache_changes` 的 `invalid.is_empty()` 断言失败。源码中后者用 `Path::new("/tmp/font.ttf")` 构造缓存来源，Windows 上该路径的绝对性假设需核查；前者需核查 Windows `SystemTime` 精度。此处记录测试失败，**不能据此断定生产事务回滚失效**。本轮没有 macOS、Android、iOS 或 Linux 运行验证。

以上未单独更新的运行结论仍限于 2026-09-30 原审计范围；上段“本轮检查”指原审计，不是 2026-10-17 重新执行结果。新增规划只核对源码与现有报告，不能把历史失败直接认定为当前失败，也不能认定已解决。

## Architecture Decisions

2026-10-17 增补：多端点与 LAN 使用同一事件／对象模型，各副本独立记账；新增 wire v2 与 v1 隔离迁移。官方构建的能力策略留在应用服务，不进入字体核心或同步协议。完整边界见 [同步架构](docs/sync-architecture.md) 与 [赞助计划](docs/sponsor-release-plan.md)。

1. `folio-core` 保持无平台 API；`folio-storage` 负责设备本地 SQLite 与可重建缓存；`folio-query` 是查询语义唯一来源。同步 wire schema 不等于 SQLite schema。所有客户端复用身份、查询、Facet 和冲突语义，不复制算法。
2. 用户状态锚定 `FontIdentityId`；具体二进制用 `FontRevisionId`，当前目录行用 `FontFaceId`。导入路径和库根不参与字体身份。添加目录、复制收集、会话启用、持久安装是不同操作。
3. macOS 保持 SwiftUI/AppKit + UniFFI；Windows/Linux 保持 React/TypeScript/Vite/Tauri 2 与仓库选定的 HeroUI v3/Tailwind v4。移动端 UI 技术栈尚未决定，不能从桌面 React 直接推出 RN 复用。
4. WebDAV 是共用协议，123PAN 作为服务端接入。凭据由各平台安全存储持有；同步状态、文件可用性和冲突必须是真实后端状态。目录缓存清理不得损伤用户状态。
5. **大卡片只有两种 presentation**：现有大卡片样式与 iPod / Cover Flow 样式。它们共用同一 query、分页、选中字体、preview、inspector 和收藏状态。Cover Flow 是大卡片视图内部样式选择，不是第五种顶层 View Mode；切换样式不重建查询或丢失选择。已有四种顶层浏览模式保持四种。
6. 手动收藏夹保存成员；智慧收藏夹保存查询条件，由当前库动态计算成员。现有实现应验收和修正，不再列为新建模块。

## Product Workflows

2026-10-17 本轮补项的源码依据、平台契约和未决事项见 [产品工作流架构](docs/product-workflows.md)。本轮只改文档，源码不足的闭环保持 PARTIAL／Planned。

| 动作 | 固定语义 |
| --- | --- |
| Import / Analyze | 接收并分析候选字体，不默认等于 Collect、Activate 或 Install |
| Reference | 引用文件夹／外部字体，保存来源与权限，不复制；外部失效时保留用户状态 |
| Collect to Folio | 校验后建立 Managed Copy，原件保留；不隐式启用或安装 |
| Activate | 平台明确作用域的临时注册；停用与持久卸载分开 |
| Install | 平台允许范围的持久安装，单独记录权限、安装副本与卸载责任 |
| Collect + Activate | 先收集再启用；启用失败保留已收集副本，按阶段重试 |
| Export | 导出选择／收藏夹中的真实文件，逐项结果；不改变来源或隐式安装 |

Reference 与 Managed Copy 是独立来源，同一身份可同时具备两者；同步不传本地路径／书签，远端下载在接收端形成受管副本，不改变原设备引用归属。移除引用、外部离线、清理托管副本、卸载及全设备 tombstone／restore 分开；不得自动删除外部原件或把外部失效解释为全设备删除。完整状态矩阵见工作流架构 §3。

**桌面字体安装必须使用独立窗口**，覆盖待处理列表、Family／Face、格式与重复检查、冲突、Collect／Reference、独立 Activate／Install、批量状态、单项错误、Retry 与最终结果。macOS 使用 SwiftUI Window／WindowGroup，必要时 AppKit；Windows／Linux 使用 Tauri WebviewWindow。Library 同时保持可用，主页面普通 Sheet／Dialog 不满足此要求。

## Decisions To Validate

### RN + Expo 是否作为 Android/iOS 共享应用层

**React Native + Expo 是共享移动应用层的主要候选，尚未批准为生产架构。** Folio 的 Library、Font Card/Grid、搜索、查询状态、收藏夹和云库状态适合共享 React Native 页面结构与业务状态；Rust 仍是事实来源。iOS 经平台组件／Expo Native Module 接入 SwiftUI／Liquid Glass，Android 接入 Compose／经验证的 MIUIX／Liquid Glass；这不代表恢复两套独立客户端。风险集中在任意用户字体的精确 Face/TTC 渲染、变量轴、复杂大网格性能、原生导航的视觉/交互一致性，以及原生文件扩展与 Rust 包装的构建成本。最终以 D 的 PoC／go-no-go ADR 为准，双原生仅保留为有证据时比较的备选，不自动切换；不设共享率 KPI。

Expo 当前文档说明 `@expo/ui` 可从 React 使用 SwiftUI/Jetpack Compose 组件，也能混排 RN 视图，但跨框架布局边界需要控制；它是**组件互操作层**，不是 Folio 全部原生能力的替身。[Expo UI](https://docs.expo.dev/versions/v58.0.0/sdk/ui/)；[自定义原生代码](https://docs.expo.dev/workflow/customizing/)。Expo Router 原生 Tabs/Stack 可先验证 iOS 系统 Liquid Glass 行为，Android 定制底栏仍可做独立实现；Expo UI 的现有组件目录不等于 MIUIX 或自定义导航已获支持。[原生 Tabs](https://docs.expo.dev/router/advanced/native-tabs/)。需要自定义模块时使用 development build，不能以 Expo Go 作为完整 PoC 环境。[开发构建](https://docs.expo.dev/develop/development-builds/faq/)。

| 层 | 候选分工 |
| --- | --- |
| 共享 RN | Library 页面骨架、Font Card/Grid、查询与分页状态、搜索/筛选/手动及智慧收藏夹、下载/离线状态呈现、无平台字体 API 的交互。大列表需验证虚拟化与预览复用。 |
| `.ios` | 系统 Navigation/Tab/Sheet/Menu、适合的 SwiftUI 原生控件与 Liquid Glass、文件导入/分享入口；需要时将整个导航容器留给原生，不为共享 JSX 牺牲系统行为。 |
| `.android` | Compose 或经验证的 MIUIX 控件、系统返回/窗口 inset、原生菜单与 Sheet、可选自定义 Liquid Glass 风格底栏；效果须验证可访问性、性能与 ROM 兼容，不能以截图代替。 |
| Rust 桥接 | 首选复用现有 `folio-ffi` 的 UniFFI Swift/Kotlin bindings，在薄 Expo Native Module 中封装异步调用、错误和生命周期；Android Kotlin UniFFI/JNA 打包、线程及性能必须 PoC。若不合格，再比较专用 C ABI/JNI 或 TurboModule，不在 JS 中重新实现 Core。UniFFI 官方说明支持 Swift/Kotlin，Kotlin 使用 JNA；Expo 支持本地 Swift/Kotlin 模块。[UniFFI](https://mozilla.github.io/uniffi-rs/latest/)、[Kotlin/Gradle](https://mozilla.github.io/uniffi-rs/latest/kotlin/gradle.html)、[Expo Modules](https://docs.expo.dev/modules/module-api/)。 |
| 原生文件服务 | Android DocumentsProvider／content URI／GET_CONTENT／自有 Picker fallback 与 SAF／USB／OTG 由原生服务安全调用 Rust；iOS 分开评估 Files、Share workflow、Share Extension 与 File Provider Extension。Provider／Extension 不依赖 RN JS runtime；App Group、跨进程数据库／文件协调、凭据与取消先做 PoC。明细见 [平台工作流](docs/product-workflows.md#5-platform-file-workflows)。[Android DocumentsProvider](https://developer.android.com/guide/topics/providers/create-document-provider)、[Apple File Provider](https://developer.apple.com/documentation/fileprovider)。 |

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

G–I 是新增同步工作线，字母不表示必须等 F 的 Linux/v2 全部完成。依赖顺序为 A 的单端点可信度 → G 的共享契约 → H 多 WebDAV／I 局域网；H 与 I 的传输实现可并行，混合验收需两者完成。赞助策略 S0/S1 可并行准备，按功能独立解锁，不阻断 A–E 的免费能力。

A1 恢复健康诊断闭环，B0 固定桌面安装窗口契约并交付 macOS／Windows 承载；两者可与 A 的实网验收并行，但数据写入沿用同一存储边界。Windows B 以 B0 的本平台窗口为交付前提；Linux 窗口在 F1 验收。F1 Linux 与 F2 WOFF／WOFF2 为产品 v2 两条独立工作线，不把格式支持或窗口契约等到所有同步增强完成才开始。

### A. 当前桌面基线与同步可信度

- **Goal：**把现有 macOS/Tauri 能力从“源码已接入”提升为可依赖的基线。
- **Scope：**先确认历史两项 Windows `folio-storage` 测试失败在当前版本的处置结果，恢复可信的跨平台测试基线；核对当前 schema v11 与历史缺表迁移；macOS 导入/启用/安装/移除真实回归；在既有受控故障测试基础上完成 WebDAV/123PAN 双设备新增/删除/离线恢复/取消续传/冲突/凭据失效实网矩阵；智慧收藏夹跨设备与手动收藏夹互不干扰；Windows 当前页面和同步真实运行检查。修复验收中发现的 blocker。
- **Dependencies：**现有 Rust、macOS、Tauri 实现；两台可访问同一测试 WebDAV 的设备。
- **Deliverables：**当前版本验收报告、问题清单、必要修复与迁移回归样本。
- **Acceptance Criteria：**Windows `cargo test --workspace` 通过或每项剩余失败有明确处置结论；测试矩阵中的双设备收敛、离线恢复、可逆冲突选择及用户状态保留可复现；macOS 本地操作在真实字体文件上通过；Windows 页面与同步状态来自真实后端。未通过的子能力仍标 PARTIAL。
- **Explicitly Out of Scope：**Cover Flow、watcher、字符表、移动正式客户端和界面装饰优化。

### A1. Font Health 产品闭环

- **Goal：**将已有损坏诊断、重复来源、多修订与元数据冲突分析恢复为正式可用功能。
- **Scope：**共享文件级／Face 级问题与统计口径；坏字体无有效 Face 也进入列表；区分损坏、外部离线、无权限、云占位与 known unsupported；补齐 Tauri 损坏统计及 macOS／Windows 摘要→明细→重新检测／定位／重下／冲突决策。
- **Dependencies：**现有 Core／Storage 扫描问题、Query Health 与平台来源权限；不等待 G–I。
- **Deliverables：**共享问题契约、真实统计与两桌面入口／详情／恢复闭环、固定样本及验收报告；移动 E、Linux F1 复用。
- **Acceptance Criteria：**损坏文件即使无 Face 仍可定位；未知／未扫描不显示为零；缓存重建、重开、断网与修复来源后可复核统计；重复／多修订不误判为损坏；任何恢复不自动删外部原件或用户状态。
- **Explicitly Out of Scope：**自动字体修复、全量格式合规／恶意字体安全认证、自动选择修订。基础健康能力继续免费。

### B0. 桌面字体安装独立窗口

- **Goal：**使 macOS／Windows／Linux 共享独立安装窗口产品语义，Library 同时可用。
- **Scope：**待处理列表、Family／Face、格式／重复／冲突分析、Collect／Reference 决策、独立 Activate／Install、Collect + Activate、批量状态、单项错误、Retry 与最终结果；平台承载、批次归属、关闭／重开与多窗口状态协调见 [窗口架构](docs/product-workflows.md#4-desktop-installation-window)。
- **Dependencies：**现有解析、身份、来源与平台操作服务；A 的本地数据安全结论。窗口契约与只读分析可先行，不等待全部实网验收。
- **Deliverables：**共享批次／动作契约；macOS SwiftUI Window／WindowGroup（必要时 AppKit），迁出当前 ImportReport Sheet；Windows Tauri 独立 WebviewWindow；接收／分析／执行／Retry／结果全流程。Linux 同契约的 WebviewWindow 属 F1 明确交付。
- **Acceptance Criteria：**安装窗口打开及任务执行时，Library 仍能搜索／浏览／预览；多批次、重复路径转交和所选来源稳定；部分失败仅重试失败阶段；关闭／重开、取消与重启不重复复制／注册；Collect 成功但 Activate 失败分别报告；临时启用与持久安装／卸载实测区分；外部原件不被误删，浅深色及键盘／读屏可用。
- **Explicitly Out of Scope：**在主 Library 普通 Sheet／Dialog 中完成安装／批量结果，或以已有设置窗口宣称安装窗口已完成；不重写 Core 或更换前端架构。

### B. Windows 桌面闭环

- **Goal：**在已有 Tauri 页面上完成 Windows 用户最基本的字体库工作流。现有实现投资和 Rust/Tauri 边界使 Windows 比从零启动 Android 更适合先推进主线。
- **Scope：**Explorer 多选字体→Folio、冷启动／已运行单实例路径转交→独立窗口批量 Import / Analyze→Collect／Reference→Activate／Install；用户范围安装／卸载、临时启用作用域、权限／失败恢复、单项／批量／收藏夹 Export，现有查询与同步回归。
- **Dependencies：**A 的存储/同步可信度；B0 的 Windows 安装窗口；目标 Windows 机器。平台启用范围先形成 ADR，不能把进程私有字体称为其他应用可见。
- **Deliverables：**可安装 Windows 构建、独立安装窗口完整工作流、字体操作与 Export 适配、Explorer／单实例端到端验收记录。
- **Acceptance Criteria：**真实 Windows 上完成多选打开→独立分析／安装窗口→浏览预览→收藏→同步恢复→导出；Library 并行可用；空格／Unicode／重复转交／失效文件逐项可核对；临时启用、持久安装、停用、卸载和重启后状态分别验证；Reference／Managed Copy 不混淆，部分失败可重试且不覆盖原件。
- **Explicitly Out of Scope：**Linux 完成声明、跨平台字符表、Cover Flow、移动端。

### C. Character Map 共享契约与全平台页面

- **Goal：**使用同一字符映射与渲染契约，覆盖 macOS、Windows、Linux、Android、iOS/iPadOS；移动页面继续留在现有隔离工程，不改变生产架构决策。
- **Scope：**Rust 按实际字体字节及 collection face index 枚举 Unicode scalar/Glyph ID/脚本，稳定分页、单字符/U+ 精确检索及脚本筛选；独立 `folio-render` 提供轮廓、变量、COLR v0/v1、CBDT/CBLC、sbix、EBDT/EBLC、内嵌 SVG 渲染；UniFFI/Tauri/Expo 同义暴露只读快照；桌面双击字体卡片进入二级字符表并复用一级页面右侧栏，移动从字体详情进入三级页面，继承字款、来源及轴值，显示放大字形并复制字符或码位。
- **Dependencies：**稳定的 Face/source/axes 契约；B 的 Windows 本地文件与预览闭环。Rust 接口设计可先于 B 并行开始。
- **Deliverables：**共享接口、全部平台页面、固定版本渲染依赖、格式与生命周期测试，以及 [实施和验证记录](docs/character-map-validation.md)。本轮核心收尾，UI 导航调整暂停；当前状态为 PARTIAL，缺少设备的验收不能以主机编译替代。
- **Acceptance Criteria：**非零 TTC/OTC 成员、大型 cmap、非 BMP、私用区、组合和空白字符正确；彩色与位图保留颜色、透明度及定位；快照固定来源和 revision，关闭或切换后不回写旧结果；网格虚拟化、图片缓存不超过 32 MiB；返回库时保留查询、分页、滚动和选择；浅深色、键盘、读屏、安全区域及减少动态效果通过目标平台验证。
- **Explicitly Out of Scope：**未编码 glyph、连字/ZWJ/变体序列、WOFF/WOFF2、Unicode 名称检索、调色板编辑、字形导出、数据库迁移与同步协议变更。

### D. 移动架构 PoC 与决策

当前已建立 [隔离基础工程](experiments/mobile/README.md)、[边界决策](experiments/mobile/DECISION.md) 和 [验证记录](experiments/mobile/VALIDATION.md)。原审计只覆盖基础打包与调用；后续记录已扩展到导入、收藏／智慧收藏夹、最近记录、第六批同步闭环和字符表页面。阶段 D 仍保持 PARTIAL；RN + Expo 未被批准为生产架构，原 go/no-go 与实机门槛继续有效。

- **Goal：**确定 RN + Expo 混合原生方案能否达到 Folio 的字体准确性和平台体验要求。
- **Scope：**完成上表六个隔离 PoC；补做 Android DocumentsProvider／content URI／GET_CONTENT／目标 ROM Picker 与自有 fallback 最小实验；iOS Files import/export、Share workflow／Share Extension、File Provider Extension 采用评估；Provider／Extension 无 RN runtime 下的读取、取消和跨进程边界；iOS 字体安装仅做平台能力评估，不继承 macOS 承诺。
- **Dependencies：**现有 Core/UniFFI；不等待 A、B、C 全部完成，可与之并行。
- **Deliverables：**PoC 工程、设备/版本/性能数据、桥接与 UI 边界 ADR、是否采用 RN 的明确 go/no-go；Share Extension／File Provider 是否采用及替代路径、iOS 字体安装能力结论分别记录。
- **Acceptance Criteria：**每个实验有通过/失败证据；RN + Expo 保持主要候选。关键 TTC／变量轴、导航或 Provider 未达标时先记录阻塞与方案比较，以 go/no-go ADR 决定后续，不自动恢复双客户端；原生文件服务在 JS 未启动时可完成真实读取或明确失败。
- **Explicitly Out of Scope：**正式移动数据库迁移、上线 UI、追求固定代码共享比例。

### E. 移动字体库首版

- **Goal：**先交付 Android 的随身字体库，再在经 PoC 验证的共享层上推进 iOS；以 RN + Expo 为主要候选，最终采用方案遵循 D 的 ADR。
- **Scope：**Library/Card/Grid、查询／手动与智慧收藏夹、真实 Face／变量轴、字符表、Font Health、离线副本、单 WebDAV／123PAN 与导入导出；下表平台文件工作流分别交付。平台组件／Expo Native Module 按 D 的 ADR 接入。
- **Dependencies：**A 的双设备同步验收、D 的移动架构结论、C 的字符表接口契约、A1 的共享问题契约；健康接入可并行，不要求等待全部桌面健康 UI 完成。字符表移动页面已在隔离工程接入，生产交付仍依赖 D 的决策。
- **Deliverables：**Android 实机首版、iOS/iPadOS 实机首版、原生 Provider／Picker 与 Files／Share 分项报告、健康入口／恢复结果与同步验收报告；采用的 Extension 有独立 target／生命周期 ADR。
- **Acceptance Criteria：**下表平台矩阵通过；真实字体／TTC 成员与同步结果一致，文件权限、取消、离线和长文本／安全区域／读屏可复核。File Provider 按采用结论单独验收，Files 导出不冒充云端 Provider；未采用时记录原因和现有入口覆盖。
- **Explicitly Out of Scope：**Android 系统级字体安装承诺、未验证的 MIUIX/玻璃效果、两端像素一致。

| 平台工作流 | 独立 Deliverables / Acceptance Criteria |
| --- | --- |
| Android DocumentsProvider | 原生服务、稳定文档 ID 与 content://；本地／收藏夹／云端字体实际读取、按需下载、取消、断网和临时读授权；JS 未启动也可服务或明确失败 |
| Android GET_CONTENT / Picker | 标准 Picker、目标国产 ROM Picker 与真实 ACTION_GET_CONTENT 调用方矩阵；自有字体 Picker fallback 返回安全 URI，验证多选／重开且不制造重复入口 |
| Android SAF / USB / OTG | 选择／收藏夹批量导出到授权目录与 U 盘；同名、满额、权限撤销和中途拔出逐项恢复，不要求全盘访问 |
| iOS / iPadOS Files | import/export、复制／支持时的引用、外部权限与云占位；iPhone／iPad 真实文件和多窗口返回状态 |
| iOS / iPadOS Share | 导出 Share workflow；接收“分享到 Folio”的 Share Extension 采用 ADR，采用后验证原生收件区／App Group／主应用分析，不依赖 RN JS 存活 |
| iOS File Provider Extension | D 决定采用后，独立原生 target 直接调用 Rust／原生服务，验证 App Group、跨进程写入、凭据、按需 materialization、取消与系统重启；不能借主应用 JS／内存引擎完成 |

### F. 后续增强与 Linux/v2

其中目录 watcher／修订热重载在官方 Release 中计划属于 `library.watch` 赞助权益；已有手动、启动、导入触发的增量刷新继续免费。Cover Flow、主题、性能与无障碍修正继续免费，Linux 和 WOFF/WOFF2 支持不按格式或平台加锁。权益只在对应功能验收后接入，见 [赞助范围](docs/sponsor-release-plan.md#2-feature-matrix)。

- **Goal：**按实际使用数据完善体验并扩展格式/平台。
- **Scope：**按 F1–F4 分开推进 Linux 独立窗口／fontconfig／WebKitGTK 工作流、产品 v2 WOFF／WOFF2 完整管理能力、大卡片两种 presentation、目录 watcher／Hot Reload，以及已有在线字体的跨端覆盖；桌面性能与无障碍继续完善，字符表共享契约仍归 C，Linux 运行验收归 F1。
- **Dependencies：**前述核心工作流稳定；Linux/格式各有独立样本与运行环境。
- **Deliverables：**逐项独立 ADR/验收，不把不同增强捆为一个不可拆阶段。
- **Acceptance Criteria：**Cover Flow 不改变四种顶层模式且共享选择/分页状态；Linux 在目标发行版实测；WOFF/WOFF2 清楚区分可管理、可预览与可系统安装。
- **Explicitly Out of Scope：**将 polish 当作 A–E 的前置门槛，或承诺未经平台验证的安装能力。

#### F1. Linux Desktop Workflows — Product v2

- **Dependencies：**B0 批次／窗口契约、B 的 Tauri 操作边界、C 的共享字符表；不等待 F2 全部完成。
- **Deliverables：**Tauri 独立字体安装 WebviewWindow、Reference／Collect／Export、fontconfig 与用户范围 Install／Uninstall 适配、Activate 作用域 ADR、Font Health、发行版／桌面环境／WebKitGTK 运行报告与现有 Linux 发布产物回归。
- **Acceptance Criteria：**目标发行版实际完成批量分析→来源决策→字体操作→导出且 Library 同时可用；应用专属 fontconfig 字体不冒充全会话启用，不支持临时启用时明确禁用；字符表、TTC 成员、变量预览、权限、字体缓存与重启结果实测，构建成功不替代运行。

#### F2. WOFF / WOFF2 Management — Product v2

- **Dependencies：**共享解析／身份／查询与渲染边界；先固定解压限制、身份／修订及跨容器样本 ADR。与 F1 同期规划，独立验收；同步复用当前已交付传输，H/I 交付后补相应格式矩阵。
- **Deliverables：**两格式的识别与 Metadata、Reference／Collect／Library 管理、准确 Preview、Search／Facet、收藏／手动与 Smart Collections、原始字节对象 Sync，合法／损坏／变量样本和全部目标平台验证记录。
- **Acceptance Criteria：**不止 magic 识别；元数据、实际 Face／轴和查询结果可核对；原始容器指纹及既有身份语义保持明确；重开、离线、单 WebDAV／已交付 Multi-WebDAV／LAN 往返不丢来源与用户状态；旧客户端可明确报告格式不支持；安装窗口按 OS 能力独立禁用 Activate／Install，不将管理／预览支持写成可直接安装。
- **Explicitly Out of Scope：**未单独决定的 WOFF→TTF／OTF 转换、字体拆分、未经验证的系统安装承诺。转换／授权呈现保留 ADR 评估项。

#### F3. Cover Flow and Directory Watch

- **Deliverables：**大卡片 Style 1 普通大卡片／Style 2 iPod Cover Flow，共用查询、分页、选择、预览、Inspector；目录监听与 Hot Reload 复用来源／修订，分别记录验收。
- **Acceptance Criteria：**维持四种顶层模式；watcher 处理外部离线、权限、内容变化和受管副本，不自动收集／安装或删原件；遵循减少动态效果。Cover Flow 免费，`library.watch` 官方赞助／社区全开规则不变，现有增量刷新不加锁。

#### F4. Online Fonts Product Coverage

- **Deliverables：**基于现有 folio-online／macOS 路径登记各端浏览／下载范围、来源／镜像与许可元数据、下载后的 Collect／独立安装窗口（桌面）衔接，不从零重建模块。
- **Acceptance Criteria：**实际来源失败／取消／重试、下载校验与来源标识可核对；下载不自动 Install，跨端未接入项保持 PARTIAL；不由在线获取推断再分发权限。在线字体免费边界保持不变。

### G. 共享同步契约与兼容迁移

- **Goal：**为同库多副本和 LAN 建立可复用、可恢复的同步基础，保持现有单 WebDAV 免费可用。
- **Scope：**按 [架构设计](docs/sync-architecture.md) 增加组／副本身份、端点独立账本、不可变事件、因果与冲突契约、对象位置与断点；拆分现有传输边界；固定 wire v2 规范字节／设备签名与兼容样本；设计旧 profile、凭据、事件及用户状态迁移。
- **Dependencies：**A 的现有单端点与数据保留结论；身份／修订、Storage 与既有合并能力。
- **Deliverables：**共享接口及 wire 样本、新版本迁移、受控双／三库测试和迁移回滚记录；移动桥接继续留在原隔离边界。
- **Acceptance Criteria：**同一事件跨路径只应用一次；乱序缺口可补；每个目标单独确认送达；旧 schema v11／历史缺表样本和 v1 数据迁移不丢用户状态；不修改已发布迁移或让旧客户端误写 v2。
- **Explicitly Out of Scope：**独立工作区、多人权限、E2EE、日志 GC、付费后端和新 UI 架构。

### H. 多 WebDAV 同库副本

- **Goal：**让同一库同时同步到多个服务商／账号，故障各自隔离。
- **Scope：**多个端点的安全凭据、创建／绑定／停用、全量首次播种、事件转发、差集追赶、文件来源回退、各端状态与修复确认；接入 `sync.multi_webdav`，免费版保留一个启用端点。
- **Dependencies：**G；至少两个独立服务商测试目录；对应平台安全存储。
- **Deliverables：**共享实现、各端设置与真实进度、服务商实网矩阵；不预设发布日期。
- **Acceptance Criteria：**两设备两 WebDAV 及一端离线／认证失效／满额／删空后恢复可复现；不误删或重置设备；未完整副本如实显示；移除端点不删除资料；官方恢复模式与社区全开构建验证通过。
- **Explicitly Out of Scope：**不同库自动合并、任意云盘浏览、按收藏夹路由、只读订阅。

### I. 局域网多设备与混合同步

- **Goal：**在无公网、无 WebDAV 时让已配对设备同步，并与云副本共同收敛。
- **Scope：**平台发现／权限、手动地址与二维码、双端确认配对、成员签名与撤销、TLS 认证、事件批次和文件续传、局域网优先与云回退；接入 `sync.lan`。桌面应用运行时可监听，移动首期前台同步。
- **Dependencies：**G；原生网络／安全存储适配；移动生产交付依赖 D；H 完成后执行混合矩阵。
- **Deliverables：**双／三设备原型与跨平台验收、拒绝权限与网络隔离诊断、配对／取消／恢复流程。
- **Acceptance Criteria：**纯 LAN 两设备及 LAN+两 WebDAV 三设备环路无重复应用；坏文件／断电续传安全；跨组、伪造身份、邀请重放和撤销设备有明确处置；移动前后台不丢进度，跨渠道互通。
- **Explicitly Out of Scope：**公网穿透、云中继、系统常驻服务、移动全天后台在线承诺。

## Official Release Policy

详见 [官方 Release 赞助计划](docs/sponsor-release-plan.md)。本轮只确立规划，不修改当前发布产物或立即加锁。

- **免费基础：**现有字体管理、收藏／智慧收藏夹、字符表、Font Health、独立安装窗口及六种动作、平台文件互操作、单 WebDAV（含多设备与前台自动同步）、离线下载、冲突与删除恢复、主题及无障碍。
- **赞助权益：**多 WebDAV 同时同步、局域网多设备同步、后续桌面目录 watcher／修订热重载；按 H、I、F 各自验收后交付。
- **自行编译：**完整公开源码，默认全部开放，包含优化 release 构建；不需要赞助、账号或联网激活，沿用现有 `AGPL-3.0-only`。
- **授权方式：**同一赞助者多设备共用离线签名凭证，已授予权益长期有效；官方构建显式选择渠道，公共应用服务统一校验，凭证不进入同步协议。
- **数据保障：**未解锁／凭证损坏时只暂停受限任务，配置、资料、冲突处理、导出与恢复读取保留；免费用户可选择一个 WebDAV 继续基础同步。
- **交付：**S0 固定契约 → S1 渠道／离线凭证及发布验证 → S2 接入已验收同步能力 → S3 接入 watcher。价格和发放渠道待单独确定，不以账户／支付服务建设阻断基础版本。

## Parallel Work

- A 的 macOS 操作/同步矩阵与 B 的 Windows 缺口分析可并行；B 的同步最终验收依赖 A 的协议结论。
- D 的六个移动 PoC 可在隔离工程并行于 A/B；其中 Rust bridge 与动态字体预览先行，平台导航/控件实验可随后独立推进。
- C 的 Rust cmap 契约可与 B 的 Explorer/字体操作并行；Windows 字符页面验收需等待 B 的来源与预览闭环。
- Android Provider URI 实验和 iOS Files/Share 需求调研可提前进行；完整同步与离线验收须在 A 完成后。
- Cover Flow、watcher、动效和视觉微调是可延期 polish，不阻断 Windows 或移动 PoC。
- G 的协议样本与端点账本设计可先行，生产迁移提交依赖 A 的可信度结论；G 稳定后 H/I 的传输适配可并行，不能各自建立不同的事件合并算法。
- S0/S1 可与 G–I 并行；未完成的能力不能作为已交付赞助权益。F 的 watcher 独立推进，不阻断 H/I。
- A1 的文件级诊断与 B0 的窗口契约可并行；Windows B 验收依赖其独立窗口和操作适配，不等待 Linux F1。D 提前验证无 JS 的 Provider／Extension，E 按平台分项交付。
- F1 Linux 与 F2 格式可分别推进；F3 呈现／watcher、F4 在线字体覆盖及 G–I 同步增强不因本轮恢复工作流而删除或退回旧架构。

## Requirement Audit and Open Decisions

已恢复的早期工作流及源码缺口见 [追踪表](docs/product-workflows.md#8-requirement-traceability-and-open-decisions)。本轮找到的六种动作、独立窗口、平台 Provider／Picker／导出、Font Health、WOFF／WOFF2 与在线字体均已登记，不把“登记”当作完成。

仍需决策的项目已列入阶段：D/E 的 Share Extension 与 File Provider 是否采用及跨进程边界、iOS 字体安装能力；B/F1 的平台临时启用作用域；F2 的跨容器身份与可选转换范围。目标 ROM／发行版、调用方和实机验收清单需在相应阶段固定，不编造当前支持范围。

### Explicit Exclusions

沿用历史的 iCloud／CloudKit 排除，不以 iCloud Drive 文件夹作为替代同步方案；不新增团队权限／云托管或未要求的字体修复产品。它们不属于被遗漏的已承诺交付。

### Release Readiness

现有 [Release pipeline](docs/releases.md) 与发布矩阵保留。按平台能力加入独立安装窗口、Reference／Managed 删除保护、Export、Font Health 与平台文件互操作回归；F2 发布时追加格式矩阵，G–I 发布时追加对应同步／迁移矩阵。赞助 BuildChannel／离线凭证与源代码全开仍按 S0–S3，不以产物生成代替产品验收，也不把尚未实现的工作流写作已交付权益。

## Deprecated Plan Items

1. 旧计划“封面流第五种视图模式”无效；改为大卡片内部第二种样式，现有四种顶层模式不增加。
2. 旧计划将 WebDAV 当作未来阶段从零建立、将智慧收藏夹当作阶段 10 从零创建、将 Windows/Tauri 当作依赖空壳，都与当前源码冲突；改为现有实现的验收和缺口补齐。
3. 旧计划固定 Android=Kotlin/Compose/MIUIX、iOS=SwiftUI 的结论降为比较基线；RN+Expo 共享应用层须经 D 的 go/no-go，不预先承诺。
4. 旧顺序“Android 完成后才做 Character Map”撤销；共享映射契约在移动正式开发前确定，桌面页面在 Windows 闭环后验收。
5. 旧文档中 macOS Phase 3C/3D 的已实现内容不重开同名阶段；目录 watcher、实时热重载与 Cover Flow 均属延期增强。README、`docs/architecture.md` 与 AGENTS.md 中“仅依赖基线/无 UI/无同步”等句子也是历史状态，后续应单独做文档清理，不作为执行事实。

## Immediate Next Step

继续 **阶段 A 的桌面基线与同步实网验收**：确认历史 Windows 存储失败在当前版本的处置结果，以当前 schema v11 和移动第六批受控测试补齐实际客户端矩阵，同时回归 macOS 本地操作。并行固定 A1 的文件级诊断口径、B0 的独立安装窗口／来源／批次契约和 D 的原生文件服务 PoC，先补明确产品缺口，不重复从零开发已有模块。G 的事件／迁移样本及 S0 能力契约可同时准备；A 可信后推进 G，再分别交付 H/I。Windows B 验收纳入本平台 B0，F1/F2 独立推进 Linux／格式；Cover Flow、watcher 与赞助发放服务不占用基础同步关键路径。本轮停留在审计和文档，不执行上述开发工作。
