# Folio Roadmap

原审计基准：2026-09-30，`93697a4`；优先级复审：2026-10-17，仓库 HEAD `c8bd70e`（代码基线 `7d45929`）。本轮仅核对源码与报告、重排计划，未重新执行构建、设备或网络验收。状态表示**当前仓库中的能力**，不是发布日期或跨设备验收结论。`COMPLETE` 表示有实现及相应仓库/阶段验证；`PARTIAL` 表示已有可运行路径但关键流程、目标平台或实机验收缺失；`NOT STARTED` 表示没有该产品能力。历史阶段报告只证明报告当时的范围；后续源码、[同步迁移报告](docs/sync-migration-v7-report.md) 与 [移动验证记录](experiments/mobile/VALIDATION.md) 优先。本文取代 [旧开发计划](docs/project-development-plan.md) 的执行顺序。

后续执行更新：2026-10-17 已启动 P0／P1 首批实现与验证，见 [执行记录](docs/p0-p1-validation.md)；上段的“仅审计”描述保留优先级复审时点。

2026-10-18 规划调整：官方高级版解锁改为云服务器在线激活／续验，客户端缓存有期限的签名授权并提供离线宽限。S1 包含验证服务与客户端接入，是官方高级版上线门槛；免费基础、自行编译全开和 P0–P9 产品顺序保持不变，详见 [赞助计划](docs/sponsor-release-plan.md)。

## Current State

| 能力 | 状态 | 源码与实际边界 |
| --- | --- | --- |
| Rust Core | COMPLETE | `crates/folio-core` 解析 TTF/OTF/TTC/OTC、变量轴、身份/修订、家族聚合、诊断；[Phase 1 报告](docs/PHASE1_REPORT.md) 与 [审计](docs/PHASE1_AUDIT.md)。WOFF/WOFF2 仍是已识别但不支持。 |
| Storage / Query | COMPLETE | `folio-storage` 的 SQLite 根目录、缓存、持久用户状态及 `folio-query` 的搜索、Facet、分页、健康分析已实现；[2A 报告](docs/PHASE2A_REPORT.md)、[2A 审计](docs/PHASE2A_AUDIT.md)、[2B 报告](docs/PHASE2B_REPORT.md)。2026-10-17 源码为 schema v11，v10/v11 增加文件与来源策略，不能用旧报告的版本代表当前 schema。 |
| Collections / Favorites / Recent | COMPLETE | 手动收藏夹、收藏、显式最近访问由 Storage 持久化，经 UniFFI、macOS 与 Tauri 界面使用；长期引用以 `FontIdentityId` 为锚。跨设备同步场景的验收单列于同步项。 |
| Smart Collection | PARTIAL | 已有 `smart_folders` schema、`SavedFontQuery`、UniFFI/Tauri 命令、macOS 与 React 管理界面，以及同步事件/冲突代码；旧计划“阶段 10 从零实现”已失效。移动手动／智慧互转、重新打开与受控双库同步已有记录；仍缺真实跨客户端、服务商及并发／离线的完整验收，不能重排为从零开发。 |
| Incremental Refresh | COMPLETE | Storage 的 metadata 命中、改时间后 hash、真实变更重解析及离线根保留已有测试；macOS 启动/导入/目录操作和 Tauri 刷新均接入。`COMPLETE` 不含文件系统 watcher 或实时热重载；大小与 mtime 未变时有明确缓存假设。 |
| macOS UI | PARTIAL | `apps/macos/Folio.xcodeproj`、SwiftUI 四种浏览模式、查询/筛选、Inspector、预览、云库、在线字体与智慧收藏夹均有源码；[Phase 3 UI 报告](docs/PHASE3_UI_REPORT.md) 证明其当时的构建及基础交互。后续功能缺一份覆盖当前提交的整体验收报告。 |
| macOS 字体导入、启用、安装 | PARTIAL | `FontOperations.swift` 与 `LibraryViewModel.swift` 已有复制/引用、批量结果和重试、CoreText 会话注册及持久注册、Finder 打开入口。属于已实现路径，不应重做 Phase 3C；仍需针对当前版本做真实文件、权限、失败恢复和卸载边界的回归。 |
| WebDAV | PARTIAL | 现有单连接与 wire v1 已有上传下载、取消重试、云端占位及冲突；macOS、Tauri 均有入口。移动第六批已接通前台自动同步、云端保留、重下、删除恢复与冲突，并记录受控双库往返／故障回归。123PAN 连接已验证，但完整真机往返、独立服务商及真实桌面／移动双端矩阵仍有缺口，见 [移动同步记录](experiments/mobile/VALIDATION.md#cloud-sync-cycle-batch-6)。多端点和 LAN 尚未实现。 |
| Tauri / Windows baseline | PARTIAL | `apps/desktop-ui` 已有完整 React 页面、查询、预览、收藏与同步；P2 已接入 Explorer／单实例转交、独立安装窗口、批次恢复、会话启用、当前用户安装和 Export。共享宿主测试及 Windows 交叉编译通过，Windows x64／arm64 原生测试与应用构建已纳入 CI；目标系统实际运行待验收，Linux 未实测。见 [P2/P3 验证记录](docs/p2-p3-validation.md)。 |
| Character Map | PARTIAL | Core 字符映射、`folio-render` 共享渲染与 UniFFI/Tauri/Expo 四项会话接口已收尾，格式、快照与分页测试通过。桌面二级三栏、移动详情下三级页面与连续滚动已接入；2026-10-17 又有轴值刷新、自动选择及部分页面验证。剩余为目标设备、生命周期与性能验收，不重建共享接口或导航；见 [字符表验证记录](docs/character-map-validation.md)。 |
| Android / iOS | PARTIAL（平台验收中） | RN/Expo、UniFFI 查询／预览／收藏／单 WebDAV 基础继续复用。P2/P3 已接入无 JS 原生文件服务、Android DocumentsProvider／Picker／SAF、iOS App Group／Files／Share Extension／只读 File Provider。构建、自动测试及模拟器分项结果见 [P2/P3 验证记录](docs/p2-p3-validation.md)；File Provider 系统物化链路、ROM／OTG、Apple 实机及生产签名仍须分别验收。既有记录见 [移动验证](experiments/mobile/VALIDATION.md)。 |
| 在线字体 | PARTIAL | `folio-online`、macOS 在线浏览与下载已有实现；旧 README 仍称未实现。2026-10-20 规划改为基于系统 WebView 的来源 tab + 网页内容与统一传输引擎，现有 Google Fonts 目录方向退场；范围、Tauri 本地壳/内容视图、网盘/用户脚本边界见 [在线字体浏览器规划](docs/online-font-browser.md)。镜像可用性、来源许可和跨平台范围需另验。 |
| Font Health | PARTIAL | 已补共享文件级缓存诊断和按文件去重的损坏统计，重开保留；修正 Tauri 固定零，macOS 接入问题明细、定位与重新检测，未完成首次扫描时不显示零损坏摘要。移动健康动作、跨平台未知／离线口径及完整恢复链仍待验收，见 [P0/P1 首批记录](docs/p0-p1-validation.md)。 |
| 桌面独立字体安装窗口 | PARTIAL | macOS 使用独立 SwiftUI Window；Windows 已接入独立 WebviewWindow、最小命令权限、宿主批次、逐项结果、失败阶段重试与 Export。macOS 完整人工矩阵、Windows 实际窗口／系统操作待验收；Linux 留 P7。 |
| WOFF / WOFF2 | NOT STARTED（产品 v2 Planned） | 当前仅 magic 识别并报告 known unsupported；Metadata、Library、Preview、Search、Collections、Sync 纳入 P7 的独立格式工作线。管理支持不等于 OS 可直接安装。 |
| 多 WebDAV 同步 | NOT STARTED | 当前只有单 profile、全局发布标记与设备 cursor；同库多副本、端点独立进度和故障切换按 P4／P5 实施，见 [同步架构](docs/sync-architecture.md)。 |
| 局域网多设备同步 | NOT STARTED | 发现、配对、设备信任、直接传输及与 WebDAV 混合同步按 P4／P6 实施；移动首期只保证前台。 |
| 官方 Release 高级版解锁 | NOT STARTED | 已有发布工作流，尚无渠道策略、在线验证服务或客户端授权接入；计划由云服务器处理激活／权益查询／续验，范围及门槛见 [赞助计划](docs/sponsor-release-plan.md)。自行编译默认全部开放。 |

**历史验证边界：**2026-09-30 原审计在 Windows 上记录前端类型、Lint 与 69 项测试通过；Rust workspace 曾有时间精度与事务回滚样本两项失败。优先级复审时源码仍包含纳秒往返断言与 `/tmp/font.ttf` 路径样本；本批已修正这两处平台假设并通过 macOS 回归，Windows 实测仍待补齐，历史失败也不等同于生产回滚失效。2026-10-10 至 17 的字符表记录已有更新的主机测试、构建和部分页面操作；它们不替代 Windows 或完整移动实机验收。

**优先级复审时的仓库检查（实现前）：**起始工作区已有 `FOLIO_ROADMAP.md` 将状态行名称改为 `WebDAV` 的修改，本轮保留；未改其他文件。源码确认 SQLite schema v11、wire v1、macOS 导入结果 Sheet、Tauri 健康损坏数固定为零；Windows 单实例回调只唤起主窗，尚未转交文件参数。Release 已覆盖 macOS／Windows／Linux／Android 构建，不证明对应产品工作流完成，iOS 当前无发布安装包。

## Architecture Decisions

2026-10-17 增补：多端点与 LAN 使用同一事件／对象模型，各副本独立记账；新增 wire v2 与 v1 隔离迁移。官方构建的能力策略留在应用服务，不进入字体核心或同步协议。完整边界见 [同步架构](docs/sync-architecture.md) 与 [赞助计划](docs/sponsor-release-plan.md)。

1. `folio-core` 保持无平台 API；`folio-storage` 负责设备本地 SQLite 与可重建缓存；`folio-query` 是查询语义唯一来源。同步 wire schema 不等于 SQLite schema。所有客户端复用身份、查询、Facet 和冲突语义，不复制算法。
2. 用户状态锚定 `FontIdentityId`；具体二进制用 `FontRevisionId`，当前目录行用 `FontFaceId`。导入路径和库根不参与字体身份。添加目录、复制收集、会话启用、持久安装是不同操作。
3. macOS 保持 SwiftUI/AppKit + UniFFI；Windows/Linux 保持 React/TypeScript/Vite/Tauri 2 与仓库选定的 HeroUI v3/Tailwind v4。移动端继续以现有 React Native + Expo 为主要共享架构方向；iOS 通过平台原生组件接入 SwiftUI／Liquid Glass，Android 接入 Compose／MIUIX／原生 Liquid Glass。生产交付仍须补齐验证与采用记录，不自动恢复旧双原生客户端计划。
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

**桌面字体安装必须使用独立窗口**，覆盖待处理列表、Family／Face、格式与重复检查、冲突、Collect／Reference、独立 Activate／Install、批量状态、单项错误、Retry、Export 与最终结果。macOS 使用 SwiftUI Window／WindowGroup，必要时 AppKit；Windows／Linux 使用 Tauri WebviewWindow。Library 同时保持可用，主页面普通 Sheet／Dialog 不满足此要求。

## New Priority Order

P0–P9 表示资源投入顺序，**不是全部串行的阶段锁**。只在明确的 Dependency 上等待；某平台没有设备时保留其待验收状态，不拖住无依赖的平台。P4 另设产品投入门槛，明确区别于协议本身的技术依赖。已完成的 Core、Storage、Query、基础增量刷新、收藏等只做相关回归，不重新进入开发主线。

| 优先级 | 下一步投入 | 旧阶段对应 |
| --- | --- | --- |
| P0 | 单 WebDAV v1 真实服务商／跨设备验收；共享存储与来源安全基线 | A 拆分 |
| P1 | macOS 独立安装窗口＋字体操作／Export 闭环；Font Health 共享问题与桌面恢复 | B0 的 macOS 部分＋A 本地部分＋A1 |
| P2 | Android 文件工作流正式实现与 Windows 完整工作流并行 | D/E Android 拆分前移；B 不再独占平台主线 |
| P3 | iOS/iPadOS Files／Share 产品闭环；Extension 分项决定与验收 | D/E iOS 拆出，PoC 提前 |
| P4 | wire v2／端点账本／兼容迁移 | G 后移并增加启动门槛 |
| P5 | Multi-WebDAV | H，优先于 LAN 正式交付 |
| P6 | LAN Sync 与云／LAN 混合验收 | I，保留技术并行但后交付 |
| P7 | Linux 产品化、WOFF／WOFF2 两条独立 v2 工作线 | F1／F2，互不捆绑 |
| P8 | Directory Watch／Hot Reload | 从 F3 拆出，属于功能增强 |
| P9 | Presentation polish：Cover Flow、Liquid Glass、动画微调 | F3 呈现部分及非必要视觉工作 |

Character Map 与 Smart Collections 属于**已实现能力的分平台验收线**，贯穿 P0–P3／P7，不另建阻塞所有客户端的大阶段。S0/S1 是并行授权准备，S2/S3 跟随已验收的高级功能，不加入免费基础产品串行路径；官方高级版上线须通过 S1 在线服务与客户端联调。

### P0 — Single WebDAV and Data Safety

- **Why now：**单连接已有真实实现，当前最大不确定性是服务商与实际客户端往返，而非缺少更多传输。来源、删除与迁移错误会影响所有平台，先验证可避免把问题带入 wire v2。
- **Scope：**确认当前 Windows 两项历史存储失败的处置；回归 schema v11 与 v6 缺表迁移、缓存重建保留用户状态；验证 Reference／Managed Copy、上传排除、外部离线、云端清理与墓碑／恢复边界。只补缺口，不重做同步或持久化模块。
- **Dependency：**现有 Rust／FFI／Tauri／移动桥接；合法测试字体、独立测试目录、真实服务商凭据及实际设备。受控测试和实网测试分别登记。
- **Blocks：**相关有损写入的交付、单 WebDAV 可靠性声明及 P4 正式启动；不阻塞独立窗口的只读分析、Android 原生文件实验或 Windows 入口开发。
- **Can run in parallel with：**P1、P2 的平台适配、P3 的 iOS 文件 PoC、S0/S1。
- **Acceptance：**按下表逐项补齐；问题只阻塞受影响的操作／平台。iOS 与 Linux 的完整矩阵跟随各自平台，不要求所有平台全通过才启动 Android／Windows 开发。

| 单 WebDAV 必须完成的验收 | 范围与完成依据 |
| --- | --- |
| 真实服务商 | 123PAN 专用连接完成上传、下载及下载后准确预览；另一个独立 HTTPS WebDAV 服务商执行同一矩阵。两者均为单连接测试，不以回环服务或“保存连接成功”替代 |
| 真实客户端 | 先做 macOS↔Android 实际应用往返；Windows 在 P2 补 macOS↔Windows、Windows↔Android。两个临时 Rust 库或手机内两库不等于跨设备客户端 |
| 字体与用户状态 | TTF／OTF／非零 TTC 成员／变量字体，校验原字节指纹、身份、成员与轴；收藏、手动／智慧条件、最近记录、并发修改及三种现有冲突决策结果可核对 |
| 故障与恢复 | 断网／重连、取消／重试、进程重开、前后台、认证失效、服务端配额／本地空间不足、部分传输与坏文件；失败不虚报完成、不丢已提交状态 |
| 来源与删除 | Reference 与受管副本并存、外部断盘／撤权、仅保留云端、重下、全设备删除／恢复；不删外部原件，不由刷新自动复活墓碑，不清理正在被操作或提供的文件 |
| 迁移与凭据 | 旧库升级后 roots／收藏／条件／最近／冲突保留；安全存储重开、断开与重连、账号／目录变化隔离；本地路径、书签、URI、密码、安装状态不进入同步资料 |

每个结果记录提交、平台／OS／设备、服务商、样本、故障与最终领域状态。发现 v1 与既定来源保护不符时先修正并验收；不得借 v2 迁移跳过现有免费能力的正确性。

### P1 — macOS Installation Workflow and Font Health

- **Why now：**macOS 不是待重做的客户端；真正 blocker 是安装仍在 Sheet、缺完整 Export／来源保护验收和可恢复的健康明细。独立窗口是产品要求，优先于任何 presentation。
- **Scope：**复用现有字体操作，迁入 SwiftUI Window／WindowGroup（必要时 AppKit）；覆盖 Analyze、duplicate／conflict、Reference／Collect、Activate／Install、Collect + Activate、批量状态、Retry、Export、final result，Library 同时可用。单项／批量／收藏夹导出按实际文件执行，TTC／OTC 不拆 Face。
- **Dependency：**现有解析／身份／查询／CoreText；写入与删除交付依赖 P0 对应安全结论，不等待全部服务商矩阵。Reference、Managed Copy 与安装副本分别记录，临时启用和持久安装分别验收。
- **Blocks：**macOS 本地操作正式闭环；窗口批次／来源契约和共享健康结果供 P2 Windows、移动健康与 P7 Linux 消费。**不要求 macOS 窗口代码全部完成才开始 Android／Windows。**
- **Can run in parallel with：**P0 实网、Android 文件服务、Windows 窗口承载／API 适配及 iOS 文件 PoC。
- **Acceptance：**Library 可继续搜索／浏览／预览；关闭／重开、取消、重启与重复输入不重复复制／注册；只重试失败项／失败阶段，Collect 成功但 Activate 失败分别报告；权限、冲突、停用／卸载与外部原件保护可核对。

Font Health 在本阶段先补**共享文件级问题、真实统计与最小恢复链路**：坏文件无有效 Face 仍可定位，损坏／离线／撤权／云占位／known unsupported 分开，未扫描不冒充零；修正 Tauri 固定零统计，提供摘要→明细→重新检测／定位／重下／既有冲突决策。macOS 在 P1、Windows／Android 在 P2、iOS 在 P3、Linux 在 P7 验收。完整健康页面外观不阻塞字体操作；真实诊断和删除保护不能降为 polish。范围不扩成自动修复或全面字体安全认证。

### P2 — Android and Windows Product Workflows

**2026-10-20 实施：**共享 schema v12 本机来源／任务／账本、文件读取保护与单文件云读取已接入；Android 原生文件服务和 Windows 安装工作流已有实现。自动测试、模拟器和目标环境按 [分批验证记录](docs/p2-p3-validation.md) 分开判定，未把 ROM／OTG 或 Windows 实际运行标为通过。

**两条同优先级平台线并行。资源冲突时先补 Android 对外文件链路，再补 Windows 操作缺口；Windows 不等待 Android 完成，Android 也不等待 Windows 或 macOS 全部收尾。** 理由是移动已有可运行共享层，需要尽早验证无 JS 的原生文件服务；Windows 已有完整页面，补系统操作的收益高于新增同步架构。

| 项目 | Android | Windows |
| --- | --- | --- |
| Why now | 已有导入、查询、预览、收藏与同步；Provider／Picker／SAF／OTG 才是尚未验证的核心平台价值 | React/Tauri 页面、查询和同步已有；Explorer、独立安装窗口、系统字体操作与 Export 缺失，不能按空壳重建 |
| Dependency | 现有 RN/Expo＋UniFFI；先补 Android 真实 Face／TTC／两轴、线程／取消／生命周期与原生 URI PoC，记录本平台生产 go/no-go；云端读取交付依赖 P0 本平台 v1 验收 | 已有 Tauri；共享批次／来源／健康契约、目标 Windows 主机；字体临时作用域 ADR；同步交付依赖 P0 Windows 矩阵 |
| Blocks | Android 首版完整文件闭环；P4 需要的移动读取／下载／清理生命周期证据 | Windows 首版完整工作流；共享桌面平台边界成熟及 P4 的桌面跨设备证据 |
| Can run in parallel with | Windows、P1、P0、iOS Files／Share／File Provider PoC | Android、P1、P0、Character Map／Smart Collections 验收 |

**Android 交付顺序：**已有桥接与准确字体渲染的实机门槛 → 无 RN runtime 的 DocumentsProvider 最小读取 → 标准 Picker／目标国产 ROM／真实 GET_CONTENT 调用方与自有 Picker fallback → SAF 选择／收藏夹导出 → USB／OTG 实机恢复矩阵。云端按需下载复用 v1 服务，与 P0 相互补齐，不等待 wire v2。URI 授权、取消、进程重启、权限撤销、满额、拔盘、同名和批量结果分别验收；文件可提供不等于 Android 系统字体安装。

**Windows 交付顺序：**Explorer 冷启动／已运行多选与单实例路径转交 → 独立 WebviewWindow Analyze／来源决策 → Activate／Install／停用／卸载与账本 → Retry／Export → 单 WebDAV 实际应用往返及可安装产物运行。空格、Unicode、重复转交、失效来源、权限和重启持久状态逐项验证；进程私有字体不冒充其他应用可见。Library 同时可用，设置窗口不算安装窗口。

移动继续 RN＋Expo 共享应用层与平台原生组件。PoC 是现有实现的缺口验证，不重开六项从零实验；Android 的正确性／文件服务 gate 与 iOS 专属实验分开排期。Liquid Glass 折射或动画精细度不阻塞平台采用记录；崩溃、错误 Face、手势不可用、读屏或文件生命周期缺陷仍是对应能力 blocker。任何架构切换须另有证据与明确决策，不在本轮自动恢复双原生计划。

### Existing Capability Acceptance — Character Map and Smart Collections

| 能力 | 优先级与依赖 | 阻塞范围／可并行项 |
| --- | --- | --- |
| Character Map | 共享映射、渲染、桥接和页面导航已有实现；P1/P2/P3 跟随当前平台做真实来源、非零 TTC、轴值、过期请求、退出释放、长网格、复制和辅助功能验收；Linux 留 P7 | 不再作为 Android／Windows **启动**前置，也不等待 Windows 完整安装流程才验证已有本地预览；准确 Face／泄漏等缺陷阻塞该平台字符表交付。可并行平台文件操作，视觉转场优化留 P9 |
| Smart Collections | P0 验证真实同步／并发／迁移，P1–P3 验证各端创建／编辑／互转、离线与刷新后的动态匹配，沿用 Rust 查询；已有受控测试不重复建模块 | 仅相关查询／数据保留缺陷阻塞对应能力；不等待 Linux、格式 v2 或高级同步才收尾。可与 Character Map、Provider、Windows 适配并行 |

### P3 — iOS/iPadOS Files and Share

**2026-10-20 采用决策：**同时采用 Share Extension 与只读 `NSFileProviderReplicatedExtension`，两个扩展直接链接独立 Rust／原生文件服务。App Group 可恢复迁移、Files 复制／持久引用、收件确认和导出已接入；File Provider 系统读取与实机矩阵仍按 [分批验证记录](docs/p2-p3-validation.md) 验收。

- **Why now：**已有共享页面与模拟器导入证据；先补真实设备 Files／Share，能验证共享移动层和原生扩展边界。PoC 可在 P0–P2 提前，不必机械等 Android 全部完成。
- **Dependency：**现有 RN/Expo／Swift 原生模块、iOS 准确字体及生命周期验证、本平台生产采用记录；完整云端流程依赖 P0 的 iOS 实际客户端矩阵。复用 Android 已验证的共享能力，不以其 ROM／OTG 验收作为 iOS 前置。
- **Blocks：**iOS/iPadOS 首版；若采用 File Provider，独立扩展交付依赖无 JS 的 App Group、跨进程写入／文件协调、凭据、按需读取与取消 PoC。File Provider 不阻塞其他平台、Multi-WebDAV 或基础 Files／Share。
- **Can run in parallel with：**P2；P2 核心闭环通过后，也可与 P4 共享协议工作并行，iOS 首版不依赖 v2。
- **Acceptance：**iPhone／iPad 实机 Files 导入／导出、外部授权、复制／支持时引用、云占位、系统分享、多窗口／安全区域与离线恢复。Share Extension 和 File Provider 分别记录采用／不采用及替代入口，采用后单独验收；Files 导出不冒充 Provider。系统字体安装／枚举沿用已有平台评估，不继承 macOS 承诺。

### P4 — wire v2, Replica Ledger and Migration

- **Why now：**仅在下面启动门槛满足后投入正式实现；当前**不立即启动大规模 v2 开发或生产迁移**。详细架构是设计输入，不能代替产品优先级。
- **Dependency：**技术依赖为现有身份／修订、事务、合并规则与来源生命周期。产品投入门槛为：P0 的 v1 真实服务商／跨设备与来源安全通过；P1 macOS 独立窗口及六种动作闭环；P2 Android Provider／Picker／SAF／OTG 与 Windows Explorer／独立窗口／字体操作／Export 基础闭环通过。后两项不是 wire 编码的技术前提，而是避免高级同步挤占基础产品的明确排期决定。相关 Smart Collections／健康数据安全结论纳入，纯视觉或字符表非关键微调不构成 gate。
- **Blocks：**P5/P6 的正式传输与混合收敛；不阻塞单 WebDAV、iOS 基础版、Linux 或 WOFF／WOFF2。
- **Can run in parallel with：**启动前仅做已有架构的协议样本、迁移 fixture 和问题记录，不先落生产 schema／ABI／v2 调度器；启动后可与 P3、成熟共享层上的 P7、S1 并行。
- **Acceptance：**沿用 [同步架构](docs/sync-architecture.md)：规范事件字节／签名、去重与缺口补拉、每目标独立账本、对象校验、因果／冲突与 tombstone；schema v11／v6 缺表和 v1 用户状态迁移，中断可恢复、v1/v2 隔离、旧设备迟到不双写。wire v2 不等于产品 v2，也不等于 SQLite schema。

**投入判断：**Android／Windows 尚未闭环时，不值得以大量 v2 代码替代平台文件工作。先用既有 v1 验证来源、并发、取消和跨进程读取边界，再扩展同库多副本；不要求 iOS File Provider、Linux、WOFF 或所有视觉效果完成后才启动 P4。

### P5 — Multi-WebDAV

- **Why now：**在 P4 后先交付，复用现有 WebDAV 传输经验，可先验证多副本账本和故障隔离，减少与新发现／配对／网络生命周期同时引入的变量。
- **Dependency：**P4；至少两个独立真实服务商与对应平台安全存储。
- **Blocks：**Multi-WebDAV 发布、相应 S2 权益接入；P6 最终云／LAN 混合矩阵依赖本阶段。不是纯 LAN 技术 PoC 的硬依赖。
- **Can run in parallel with：**P4 契约稳定后的有限 LAN 发现／权限／配对 PoC、P3、P7、S1；资源冲突优先本阶段。
- **Acceptance：**两设备两服务商独立进度、首次播种／转发／追赶／来源回退；认证失效、满额、删空后修复不影响其他端点、不重置设备、不误删字体；移除端点保留资料。先验收功能，再接入对应 S2。

### P6 — LAN Sync

- **Why now：**晚于 Multi-WebDAV 正式交付，新增发现、信任、TLS、权限与移动前后台风险较多；其离线直连价值保留，不以“必须先用 WebDAV”改变产品语义。
- **Dependency：**P4 的统一事件／对象模型与原生网络／安全存储；纯 LAN 两设备能力技术上不依赖 P5，云／LAN 三设备混合验收依赖 P5。
- **Blocks：**LAN 与混合同步发布、对应 S2；不阻塞任何基础平台工作流。
- **Can run in parallel with：**P5 后期有限 PoC、iOS／Linux 适配和 S1；不重复建立事件合并算法。
- **Acceptance：**无公网／无 WebDAV 的双设备直接同步；发现拒权／手动连接、双端确认配对、撤销、伪造身份／邀请重放、取消／续传；LAN＋两 WebDAV 三设备环路无重复应用。桌面应用运行时监听、移动首期前台，既定范围不扩为常驻后台或公网中继。

### P7 — Linux and WOFF/WOFF2

- **Why now：**资源优先补主力平台与同步可靠性；Linux 待 Windows 共享桌面操作边界成熟，格式支持待来源／身份／渲染闭环稳定，减少返工。两者保留产品 v2 范围，独立交付。
- **Dependency：**Linux 依赖 P2 Windows 已验证的共享 Tauri 层与窗口／任务契约、目标发行版环境；WOFF／WOFF2 依赖跨容器身份／修订 ADR、解压限制、合法样本和共享渲染。**均不依赖 P4–P6，具备独立资源可在这些同步阶段之前开工。**
- **Blocks：**只阻塞自身平台／格式完成声明，不相互阻塞，也不拖住免费基础平台。
- **Can run in parallel with：**Linux 与 WOFF／WOFF2 相互并行，亦可与 P3–P6 并行。
- **Acceptance：**Linux 实测独立安装窗口、Reference／Collect／Export、fontconfig 用户安装／卸载、临时启用作用域、WebKitGTK 字符表及 TTC／变量字体、权限和打包运行。WOFF／WOFF2 完成 Metadata、Library、Preview、Search／Facet、手动／智慧收藏夹及原字节 Sync；管理／预览不等于 OS 可安装，转换仍另行决定。先验证已交付传输，后补未来 Multi／LAN 矩阵，不能反向要求先完成高级同步。

### P8 — Directory Watch and Hot Reload

- **Why now：**已有启动／导入／目录操作／手动增量刷新可用；实时监听是效率增强，低于基础字体操作、平台文件服务和同步正确性。
- **Dependency：**P1/P2 来源生命周期与文件使用保护、既有刷新／修订契约；不依赖 Multi-WebDAV 或 LAN。
- **Blocks：**只阻塞 watcher／热重载交付及 S3，不阻塞各平台首版。
- **Can run in parallel with：**核心闭环稳定后的后续平台或同步工作，独立排资源。
- **Acceptance：**外部离线／撤权、文件内容变化、重开与使用中副本安全；不自动 Collect／Install、不误删原件、不复活墓碑。现有增量刷新保持免费。

### P9 — Presentation Polish

- **Why now：**默认延期；有独立资源可并行处理，不进入产品关键路径。
- **Dependency：**对应已稳定的页面／选择／分页状态；沿用浅深色、系统减少动态效果与无障碍约束。
- **Blocks：**仅自身呈现质量，不阻塞同步、字体操作、Android、Windows、Provider 或平台采用记录。
- **Can run in parallel with：**任意核心阶段，前提是不占用关键适配／验收资源、不扰动公共数据契约。
- **Acceptance：**Cover Flow 仅为 Large Card View 的 Style 2，Style 1 保留普通大卡片，四种顶层 View Mode 不变；两样式共享查询、分页、选择、预览与 Inspector。Liquid Glass／动画精细化只在现有原生组件内收尾；影响崩溃、输入、读屏或性能可用性的缺陷归对应平台 blocker，不藏到 polish。

## Critical Path

只列决定基础产品或高级同步交付的路径；没有统一的“macOS 全完再 Android 全完再 Windows”串行链。

1. **同步可信度：**v11／来源与用户状态安全 → 123PAN＋独立服务商 v1 → macOS↔Android 实际往返；Windows 客户端就绪后补 macOS↔Windows／Windows↔Android。该矩阵与平台实现交叉推进。
2. **macOS：**已有操作服务 → 独立安装窗口 → 六种动作／批次失败恢复／Export 与 Library 并行验收。
3. **Android：**已有 RN/Expo 桥接与真实 Face 实机门槛 → 无 JS 原生文件服务 → Provider／Picker／GET_CONTENT → SAF／OTG；云端读取合入 v1 实网验收。
4. **Windows：**共享任务／来源契约 → Explorer／单实例文件转交＋独立窗口 → 字体操作／Export → 真实 Windows 运行和 v1 跨端矩阵。
5. **高级同步：**上述基础闭环的产品投入门槛 → P4 wire v2／迁移 → P5 Multi-WebDAV；P4 同时支撑纯 LAN，P5＋LAN 完成后做三设备混合矩阵。P4→两种传输是技术依赖，Multi 先于 LAN 正式交付是资源顺序。

共享健康诊断与来源保护是相关操作的依赖，不把全部健康 UI、Character Map 微调、iOS File Provider、Linux、WOFF、Cover Flow 或赞助发放系统加入这些路径。

## Parallel Tracks

| Track | 现在可并行推进 | 必须等待的部分 |
| --- | --- | --- |
| Platform | P1 macOS 独立窗口／本地闭环；P2 Android URI／Provider PoC 与正式文件工作、Windows Explorer／窗口／API；iOS Files／Share、Extension 跨进程 PoC 提前 | 有损操作等对应来源安全结论；云端文件读取等本平台 v1 矩阵；Linux 等共享桌面边界成熟 |
| Infrastructure | P0 存储／迁移／实网；P1 共享 Health 问题与文件使用保护；协议样本、迁移 fixture；Character Map／Smart Collections 定向回归 | P4 生产实现等启动门槛；Multi／LAN 等 P4；同库写入／清理／Provider 生命周期相关变更先协调同一契约，不同时改出两套状态模型 |
| UI / polish | 已有页面键盘、读屏、浅深色与功能缺陷验收；有独立资源才做 Cover Flow／Liquid Glass／动画微调 | 不以视觉增强等候或重排平台文件／同步工作；watcher 是 P8 功能线，不能和视觉 polish 混成一个门槛 |
| Sponsorship | S0 能力／渠道／在线 API／租约与离线宽限契约；S1-Server 部署验证服务，S1-Client 接入激活／续验／缓存，可按契约并行开发 | S2-Multi 等 P5＋S1 实网联调；S2-LAN 等 P6＋S1，互不等候；S3 等 P8＋S1。服务器及对应客户端必须就绪才发布官方高级权益，不阻断 P0–P3 免费基础交付 |

并行表示无产品依赖，可以按团队资源分工；不要求同时实施所有工作。缺设备／凭据只保留该验收项 PENDING，其他无依赖工作继续。

## Official Release Policy

权益范围沿用 [赞助计划](docs/sponsor-release-plan.md)，发布矩阵沿用 [Release 规则](docs/releases.md)；高级版授权方式调整为云服务器在线验证。

- **免费基础：**字体管理、六种动作、独立安装窗口、Font Health、Character Map、Smart Collections、平台文件互操作、单 WebDAV（含多设备与前台自动同步）、离线／冲突／删除恢复、主题／无障碍与 Cover Flow。
- **高级权益：**Multi-WebDAV、LAN、后续 Directory Watch／Hot Reload；源码公开，自行编译默认全开，包括优化 release，无账号／联网激活要求。
- **在线解锁：**官方高级版使用激活码向云服务器验证，服务器登记长期权益并返回有期限的签名租约；各设备独立激活／续验，保留一次赞助与本人设备不限数量的政策。服务器只处理授权请求，不托管或中转字体。
- **断网与故障：**有效缓存含有限离线宽限，续验失败不立即回锁；超过最终截止时间仍无法验证，或服务器明确撤销授权时，仅暂停受限的新任务。LAN 传输不依赖公网，但官方高级版首次激活和续验需要联网。
- **S0/S1：**S0 固定 API、续验／宽限时长和停运保障；S1 交付云验证服务、权益数据库及客户端接入，覆盖部署、密钥、监测、备份恢复和故障联调。可与产品开发并行，不延迟免费客户端；完整账号与自动支付／发放系统可后置。
- **S2：**对应高级功能先真实完成并验收，再逐项接入；不能提前锁基础同步或把未完成能力列为已交付权益。
- **S3：**watcher 验收后接入，手动与现有自动增量刷新不加锁；不要求先完成所有 S2 权益。
- **数据保障：**授权异常仅暂停受限任务，配置、用户资料、冲突处理、导出与恢复读取保留；激活码、续验凭据和租约不进入字体核心或同步 wire。

现有完整发布矩阵、签名与更新清单继续遵循 releases.md。按平台加入工作流与数据安全验收；本轮不改变流水线或承诺发布日期。文档重排不拆改当前完整矩阵发布机制；S1 未来修改渠道时单独验收，不能由产物生成推断产品完成。

## Deprioritized

| 工作 | 当前处理与原因 | 重新投入的条件 |
| --- | --- | --- |
| 大规模 wire v2／Multi／LAN 开发 | 后移；v1 实网与 Android／Windows 文件闭环未完成，过早迁移会放大来源／生命周期返工 | P4 明确启动门槛；其后 Multi 优先、LAN 后交付 |
| Linux 产品化 | 延期至共享桌面操作成熟，避免先复制 Windows 尚未验证的窗口／注册模型 | P2 共享层稳定＋独立目标环境；不等待全部高级同步 |
| WOFF／WOFF2 | 产品 v2 独立范围；当前 TTF／OTF／TTC／OTC 的操作链未闭环 | 来源／身份／解压／渲染条件就绪；不与 Linux 或 wire v2 互锁 |
| Directory Watch／Hot Reload | P8 效率增强，已有增量刷新可覆盖基本管理；不是纯 UI polish | 来源／修订与在用文件保护稳定后独立推进 |
| Cover Flow／Liquid Glass／动画 polish | P9 presentation，不验证关键数据假设，也不补平台文件链路 | 独立资源，不占用核心闭环；功能／无障碍缺陷仍即时处理 |
| iOS File Provider 完整产品化 | P3 已决定采用只读复制式扩展，独立原生服务与 target 已接入；按系统链路和实机分别验收 | 原生无 JS 读取、协调、凭据、取消与主应用退出后读取通过；当前系统物化问题须解决 |
| S2／S3、自动赞助发放服务 | 跟随对应高级能力；分发策略不能替代核心产品价值 | 功能验收＋S1 在线验证服务与客户端就绪；可人工登记权益／发放激活码，完整账号／支付自动化后置 |
| 在线字体跨端扩展（旧 F4） | 改为系统 WebView 来源 tab + 网页内容（本地壳 + 单内容视图）、网盘 deeplink 直通与统一传输引擎；Google Fonts 目录拉取退场，不继续扩建 `folio-online` 目录 | 来源／许可、一壳一内容隔离、字体判定、下载→Collect／保存及云同步共用传输可验收 |

## Changes From Previous Roadmap

| 变化 | 旧顺序／问题 | 新处理 |
| --- | --- | --- |
| 前移 | D 被称为早期 PoC、B 以“Android 从零启动”为由先行 | 依据移动已有导入／收藏／同步／详情／字符表，Android 原生文件工作进入 P2，与 Windows 同级并行；平台正确性实验现在补缺 |
| 前移 | B0 同时打包 macOS／Windows／Linux，A 混有大量平台验收 | macOS 独立窗口＋本地动作为 P1；Windows 窗口归 P2，Linux 归 P7；只共享契约，不等待三端一起交付 |
| 后移 | A 可信即可启动 G，H/I 传输可全面并行 | G→P4，增加 macOS／Android／Windows 基础闭环 gate；P5 Multi 先、P6 LAN 后，允许有限 PoC 并行 |
| 拆分 | A 把存储、实网、macOS 操作和 Windows 状态捆成大基线 | P0 安全／v1；P1 macOS；P2 Windows，按受影响能力设门槛，不用全平台验收锁开发 |
| 拆分 | D/E 把 Android／iOS、导航效果及 Provider／Extension 绑在总 go/no-go 上 | Android gate／文件闭环 P2，iOS PoC 提前、基础 Files／Share P3；Extension 独立评估，效果精修 P9；保留 RN/Expo 方向 |
| 合并 | macOS 操作回归、B0 安装窗口、Export 分散；A1 容易成为完整健康 UI 大门槛 | 窗口＋本地动作＋Export 合为 P1 工作流；Health 先共享问题与最小恢复，再随平台交付，不要求全部健康 UI 完成 |
| 改为验收线 | C 仍写共享接口／页面待建，Windows 完整闭环成为其前置；Smart Collections 缺口未区分既有受控验证 | 共享实现和页面已完成，移出新开发主线；P0 同步验证＋分平台目标设备回归，不等待全部平台或新协议 |
| 拆分 | F3 将 Cover Flow 与 watcher 并列，易误称为同一类 polish | P8 监听功能与 P9 presentation 分开；均不阻塞基础平台或同步 |
| 取消隐含串行 | F1/F2 看似排在所有同步增强之后或必须同期完成 | P7 是资源优先级；Linux／格式各有依赖，满足即可并行，不要求 G–I 完成 |
| 不再作为 blocker | 玻璃效果、动画、全部移动 PoC、所有字符表页面与赞助批次可能挡住免费平台 | 只保留准确性、数据安全、文件权限、生命周期与可访问性等实际 gate；S0/S1 并行，S2/S3 追随功能 |
| 授权方式调整（2026-10-18） | 离线导入永久凭证，本地验签且不定时联网检查 | 云服务器处理高级版激活／查询／续验，客户端缓存签名租约并提供有限离线宽限；S1 服务端与客户端联调成为官方高级版上线门槛 |

旧文档中的 A/A1/B0/B/C/D/E/F1–F4/G/H/I 保留为历史交付范围标识，不再表示执行优先级；上表与优先级总表提供映射。2026-10-18 仅同步更新 sponsor-release-plan、releases 与 sync-architecture 的在线授权边界，不改产品工作流或同步协议设计。旧“只有依赖基线”“智慧收藏夹未实现”“字符表未实现”和双原生客户端顺序均不作当前事实。

## Explicit Exclusions

保持 iCloud／CloudKit 排除，不以 iCloud Drive 文件夹替代同步；不增加团队权限、字体云托管、自动字体修复、E2EE、日志 GC 或未决格式转换等新功能。允许用于高级版授权的独立云验证服务，不扩展为字体存储或同步中继。产品动作、Cover Flow 归属、移动共享架构方向与赞助免费边界保持已确定语义。

## Immediate Next Step

下一轮先执行 **P0 的当前基线与单 WebDAV 实网验收**，同时安排 **P1 macOS 独立窗口／动作闭环** 与 **P2 Android 无 JS 文件服务门槛、Windows 路径转交／字体作用域验证**；有 iOS 资源时提前做 Files／Share／File Provider PoC。先补共享来源／健康口径和真实客户端证据，不启动大规模 wire v2，不重做已完成模块。

高级版授权线可并行先完成 **S0 在线验证契约**，确定激活码发放、API、租约与续验／宽限规则、停运保障及部署选型，再推进 S1 云服务和各端接入；不提前开启未验收功能的收费限制。本轮只调整规划，不部署服务器或实现授权代码。

2026-10-17 已从 HEAD `a0552ed` 启动 P0／P1 首批实现，详见 [执行与验证记录](docs/p0-p1-validation.md)。当前仍为 PARTIAL：本地 HTTPS WebDAV／模拟器验证与真实服务商／实际跨客户端矩阵分开登记；macOS 独立窗口与来源／导出基础已落地，完整操作、批次持久恢复和同步清理协调继续按 P0／P1 验收，不启动 wire v2。
