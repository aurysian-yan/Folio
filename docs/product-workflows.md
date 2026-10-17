# Product Workflow Architecture

审计与规划日期：2026-10-17。本文是当前产品工作流契约，区分已有源码与待交付能力，
不改变生产实现。阶段与优先级见 [Roadmap](../FOLIO_ROADMAP.md)，同步协议见
[同步架构](sync-architecture.md)，官方构建范围见 [赞助计划](sponsor-release-plan.md)。

## 1. Audit Findings

| 工作流 | 源码／历史依据 | 本轮结论 |
| --- | --- | --- |
| Reference／Collect／Activate／Install | `apps/macos/Folio/Data/FontOperations.swift`、[架构 §39](architecture.md#39-p3c-macos-字体导入与操作) | 已有操作基础，不代表完整跨平台闭环；Export 与失败语义须显式补齐 |
| 独立字体安装窗口 | `FolioApp.swift` 只有 Library WindowGroup 与 Settings；`Views/RootView.swift` 的 `ImportReportView` 由 `.sheet` 呈现 | 当前不符合独立窗口要求；B0 单列交付，不能将旧 Sheet 标为已完成窗口 |
| Windows 多窗口 | `apps/desktop-ui/src-tauri/src/lib.rs` 已有设置 WebviewWindow | 仅证明宿主有多窗口路径，不证明字体安装窗口或 Explorer 导入闭环完成 |
| Font Health | `folio-query/src/health.rs`、Core `ScanIssue`、UniFFI 刷新损坏计数、macOS／Tauri 健康入口 | 有真实基础，正式恢复为 PARTIAL 产品能力；不能当作全新空白或宣称完整检测已完成 |
| Font Health 缺口 | Tauri `library.rs::health_overview` 将 `damaged_files` 置零；移动 `LibraryHero.tsx` 不接健康动作 | 统计口径和问题明细仍有缺口，不能用零冒充没有损坏文件 |
| 平台文件互操作与 WOFF／WOFF2 | [历史计划](project-development-plan.md) Android／iOS／Windows／Linux 与 v2 范围；[移动边界](../experiments/mobile/DECISION.md) | 恢复到 D／E、B0／B、F1／F2，不恢复旧移动技术栈或旧阶段顺序 |

## 2. Action Semantics

Import / Analyze 是接收文件和分析候选项的入口，不自动等于复制、启用或安装。

| 动作 | 数据与副作用 | 完成／失败边界 |
| --- | --- | --- |
| Reference Folder / External Font | 保存外部目录／文件来源与平台访问授权，保留原地文件；不创建托管副本 | 持续依赖外部文件、设备与权限；来源不可用时保留逻辑身份与用户状态 |
| Collect to Folio | 校验并复制到 Folio 托管区，登记 Managed Copy；保留原件 | 副本确认落盘、解析与目录登记后才成功；不自动 Activate／Install |
| Activate | 按平台声明的临时作用域注册所选实际文件／Face | 不意味着持久安装；范围、注销与会话结束行为由平台能力明确提供 |
| Install | 按平台支持范围建立持久安装并记录 Folio 操作账本 | 不默认修改系统级目录；权限、重启保留及卸载责任独立验收 |
| Collect + Activate | 先完成 Collect，再对已确认托管副本 Activate | 分步记录结果；启用失败时保留已收集副本，仅重试启用，不重新复制 |
| Export | 向用户选择的位置写出所选实际文件，报告逐项结果 | 不隐式安装、不改变来源归属或同步状态；不覆盖同名目标、不移除原文件 |

Activate／Install 对应的停用／卸载只撤销 Folio 有权管理的注册或安装副本，
不能删除系统字体、其他应用安装的字体或用户外部原件。Install 为持久操作所需的
安装副本与 Collect 的库托管副本分别记录；Reference 字体安装后仍是 Reference，
不能靠一个 installed 状态把来源重新标为 Managed Copy。

Export 按文件去重，TTC／OTC 默认导出整个集合文件，不把单个 Face 拆成伪造字体；
Face 导出转换另行决策。云端占位先实际下载和校验，外部失效来源无其他可用副本时
逐项失败。选择／收藏夹导出采用执行时固定清单，智慧收藏夹先按共享查询形成快照。
保持原格式与字节，不附带用户绝对路径或账号；名字冲突须选择跳过、改名或明确覆盖。

## 3. Source, Offline and Deletion Matrix

来源归属、内容可用性、系统操作状态是三个独立维度。一个 Face 可以同时拥有外部
引用、托管副本和云端位置，去重不能抹去来源类型。字体身份不包含本地路径；
没有可读文件的失败条目也不能被强行赋予有效 Face ID。

| 场景 | Reference | Managed Copy / Cloud Replica |
| --- | --- | --- |
| 外接盘断开、原件移走、权限失效 | 标记对应来源不可用并支持重新定位／重新授权；不清空收藏、成员或最近记录 | 已验证的托管副本继续可用；外部来源失效不使其离线 |
| 外部原件内容更新 | 新内容校验后形成修订与健康分析；不能静默替换已有托管修订 | 保留已有副本／修订，更新或收集新版本需要明确策略 |
| 同步上传 | 仅对获准上传的来源读取稳定内容快照；临时暂存不代表完成 Collect | 按内容指纹上传；远端位置与本地归属分别保存 |
| 其他设备下载 | 不复制源设备绝对路径、书签或 URI，也不在接收端创建虚构 Reference | 下载成为接收端受管云副本，原设备引用关系不改变 |
| 移除引用／库根 | 只移除来源关联，不删除外部原件、不产生全设备删除 | 同身份还有副本时保持可用；用户状态与身份引用保留 |
| 仅保留云端／清理本地 | 不触碰外部文件，也不把外部引用冒充已清理 | 先验证云副本再清理可清理的托管副本；正在启用／安装依赖的文件须先安全处理 |
| 全设备删除／恢复 | 不远程删除外部原件；是否移除本地引用单独呈现和确认 | 使用 tombstone／restore；物理清理由可恢复策略管理，恢复不修改外部文件 |
| 取消同步或移除端点 | Reference 保持原状态 | 已下载托管副本、用户状态与其他端点继续保留 |

Reference 上传、删除、同步和 watcher 均先固定所选文件、指纹与来源；读取期间变化
须重试或报告，不能上传半份文件。全设备删除后保留本机同步排除／墓碑关联，后续
外部目录刷新不能自动复活相同同步资产；重新纳入同步须显式恢复或重新加入。
全设备删除的影响范围必须明确为同步资产和 Folio 可管理副本，不承诺删除所有设备
磁盘上的外部原件。原件变为另一内容指纹时，按新修订与上传策略重新分析。

## 4. Desktop Installation Window

### 4.1 Product Contract

macOS、Windows、Linux 的字体安装、批量 Import / Analyze 及结果操作使用独立
**字体安装窗口**。不得由主 Library 普通 Sheet／Dialog 承担这套工作流。
Library 在窗口打开和任务执行期间仍可搜索、浏览、预览和操作无冲突的字体。
系统文件选择器和局部危险操作确认可使用系统交互，但不能替代独立安装窗口。

窗口按批次承担：待处理列表、Family／Face／TTC 成员、实际来源与格式、重复项、
不同修订和健康问题、Collect／Reference 决策、独立 Activate／Install、
Collect + Activate、逐项执行进度、失败原因、Retry 与最终结果。默认导入偏好可
复用，但窗口必须显示实际决策；不能因为默认复制就跳过必要的重复／冲突选择。

Finder／Explorer 多选打开、应用内文件导入和 Library 字体操作都进入同一任务模型。
连续接收新文件可在同一个安装窗口追加独立批次；执行中批次固定清单，不改写用户
正在查看的 Library 选择。重复输入按文件内容及所选动作分析，不能只按文件名过滤。

### 4.2 Platform and State Boundary

| 平台 | 窗口承载 | 操作适配 |
| --- | --- | --- |
| macOS | SwiftUI `Window`／`WindowGroup`，必要时 AppKit | 复用 CoreText、书签与现有操作账本；迁出 RootView 的导入结果 Sheet |
| Windows | Tauri 独立 `WebviewWindow` | Explorer 路径接收／单实例转交和 Windows 字体 API；复用 Rust 分析 |
| Linux | Tauri 独立 `WebviewWindow` | fontconfig／用户字体目录与目标桌面环境；不照搬 Windows 字体作用域 |

窗口只是任务视图。宿主应用服务持有批次 ID、逐项状态和实际来源，复用共享 Rust
解析／查询；系统注册留在平台适配。Tauri 窗口只获得分析及相应任务的最小命令能力，
不能为复用现有 main-only 命令而对全部窗口放开访问。

Library 和安装窗口共享已提交的库状态，但各自保留查询、滚动、选择与草稿；
成功事务发出刷新事件，接收窗口可重新读取快照。安装、同步、清理与导入使用已有
协调门或细化任务锁，冲突操作可排队并显示状态，不能阻塞整窗线程或重建一套库实例。

Retry 仅处理失败项及失败阶段，执行前重新校验文件、权限、指纹和操作状态；已成功
项不重复复制或注册。未执行批次可取消；执行中关闭窗口须明确选择继续或安全取消，
已成功项不回滚成失败。继续任务由宿主持有、可重开查看；重启恢复结果需核对 OS
实际状态，不能把“关闭窗口”视为字体卸载。

### 4.3 Acceptance

- macOS／Windows 在 B0/B，Linux 在 F1 提供真实独立窗口；最小化、关闭／重开、
  多批次和单实例重复转交有记录，Library 始终能继续浏览、搜索与预览。
- 合法／损坏／不支持字体、同名不同内容、重复来源、多修订、非零 TTC 成员和
  权限失效按项呈现，Family 与 Face 信息来自实际分析，不静默覆盖或系统回退。
- Reference、Collect、Activate、Install、Collect + Activate 可独立核对；
  成功／部分成功、取消、重试与重启后的文件和 OS 状态符合各自语义。
- 系统字体及外部原件不被误删；使用中的受管文件清理有保护；同期同步和两窗口
  编辑不产生重复事件或丢失用户状态。浅深色、键盘／读屏与高 DPI 单列验收。

## 5. Platform File Workflows

### 5.1 Android

- `DocumentsProvider` 是原生 ContentProvider／manifest／URI 授权边界，向其他应用
  提供 `content://` 字体访问；支持本地、收藏夹和可下载云字体，明确文档 ID、MIME、
  显示名、按需下载、取消、离线失败与文件描述符生命周期。
- 分别验证 Folio 从系统 Picker 导入，以及其他应用通过 `ACTION_OPEN_DOCUMENT`／
  `ACTION_GET_CONTENT` 选择 Folio 字体；两者不能由一张系统文件选择截图替代。
- 标准 DocumentsUI 与目标国产 ROM Picker 建立实机矩阵，含真实 GET_CONTENT
  调用方、多选、临时读授权、调用方重开和云端读取取消。
- ROM 不展示 Provider 时提供自有字体 Picker Activity fallback，返回相同安全
  `content://` 与明确授权；处理 Intent 路由和重复入口，不假定所有 ROM 都能接管
  系统选择器。Fallback 不取代标准 Provider。
- SAF 导出到用户选定文档／目录；USB／OTG 是独立目标设备验收，覆盖断开、空间
  不足、拒绝权限、同名、集合文件与批量逐项结果。不要求任意绝对路径或全盘权限。
- Provider 与 Picker 原生入口在 RN JS runtime 未启动时仍能安全解析 URI、调用
  Rust／原生文件服务并完成读取或返回明确错误，不在 ContentProvider 中等待 JS 启动。

### 5.2 iOS / iPadOS

- Files import/export 与系统 Share workflow 分别交付：文件／目录授权、复制与引用
  能力、云占位下载、导出取消、长文件名和 iPad 多窗口／分享锚点单独验证。
  只支持复制的入口明确使用 Collect，不伪造持久 Reference。
- 导出分享使用系统 Share Sheet；从其他应用“分享到 Folio”单独评估 Share Extension，
  记录采用／不采用及替代入口。若采用，扩展原生接收附件并写 App Group 收件区，
  主应用接收后分析；不在扩展内安装字体或要求 RN runtime 先启动。
- File Provider Extension 保留正式评估项：只有需要其他应用在 Files 中持续浏览
  Folio 云端树与按需打开时才实施；Files 导出与 Share 不算 File Provider 已交付。
- 若采用 File Provider，它是独立原生进程／target，直接依赖受控 Rust／原生同步
  服务。App Group、跨进程文件协调／数据库访问、钥匙串共享、凭据可访问性、
  materialization、取消、系统重启、资源限制与错误映射必须先通过 PoC。
  不持有主应用内存引擎，不假定 RN JS runtime 存活；进程间串行写入与通知另立 ADR。

### 5.3 Windows and Linux

- Windows：Explorer 多选 → 单实例路径转交 → 独立窗口 Import / Analyze →
  Collect／Reference → Activate／Install → 逐项结果／Retry；冷启动和已运行两条
  路径验证空格、Unicode、多文件、重复转交和失效文件。字体 API 的临时作用域、
  用户范围持久安装、通知与卸载账本单独验收，不将进程私有字体称为所有应用可见。
- Linux：使用 fontconfig 和明确的用户字体安装／移除路径；先做作用域 ADR。
  应用专属 fontconfig 配置只证明 Folio 内可用，不能冒充桌面会话级 Activate。
  目标发行版不能提供可验证的临时启用时，明确标记不支持并保留 Preview／Install，
  不把持久安装换名成启用。系统范围安装不作为默认承诺。
- Linux 在目标发行版实测独立窗口、WebKitGTK、本地／云字体、非零集合成员、变量
  预览、文件授权、fontconfig 刷新和打包；不能用 Windows WebView2 或 Linux
  安装包生成成功替代目标系统运行。桌面单项／批量／收藏夹 Export 跟随对应平台闭环。

## 6. Font Health

正式产品能力，当前 **PARTIAL**；检测基础已有，产品闭环继续规划。

- 复用 `ScanIssue`／Storage 刷新问题识别损坏、读取失败、集合成员异常和元数据
  问题；复用 `CatalogHealth` 分析重复来源、多修订及 family／subfamily／manufacturer
  非空值冲突。不同严重程度和问题种类分开，不把所有异常都叫损坏。
- 未解析出 Face 的坏文件仍需文件级条目，可显示来源、格式、问题与重新检测结果；
  不能只按有效 Face 筛选而让它们从健康页消失。文件／Face／Family 的统计口径固定，
  不相加为未经去重的“字体总数”，扫描未完成或未获取时显示未知而非零。
- 外部盘离线、权限失效、云端尚未下载、已识别但暂不支持的 WOFF／WOFF2 与
  真正损坏分开呈现。诊断保留路径仅在本机，重新定位／重新授权后可再次检测。
- 提供摘要 → 问题列表 → 来源／修订详情 → 重新检测／重新定位／重下／进入已有
  冲突决策的工作流；移除引用和删除受管副本沿用 §3，任何处理不得自动删外部原件。
- A1 完成共享问题契约、真实统计与 macOS／Windows 入口闭环；移动在 E、Linux
  在 F1 接入同一结果。损坏／有效／离线／不支持／重复／多修订固定样本及重新打开、
  同步重下、缓存重建后复测列为验收，基础检测与恢复继续免费。
- 不承诺字体修复、恶意字体安全认证、全量 OpenType 合规验证或自动选择正确修订。

## 7. WOFF / WOFF2 in Product v2

两种格式保留产品 v2 正式工作线 F2，与 Linux F1 同期规划但不互相捆绑完成。
当前 Core 仅识别 magic 并报告 known unsupported，不视为下表已完成。

| 能力 | 交付与验收 |
| --- | --- |
| Recognition / Metadata | 校验容器与压缩结构、读取共享元数据；限制解压大小与错误影响；合法／截断／畸形／变量样本 |
| Library Management | Reference／Collect、原始文件指纹、Face／revision 与来源关联；不把解码临时文件冒充用户已收集的 TTF |
| Preview | 在 Folio 内准确渲染实际 Face／轴；各端可用渲染路径单独验证，不静默回退系统字体 |
| Search / Collections | 与既有查询、Facet、收藏和手动／智慧收藏夹使用同一语义；重开和迁移保留引用 |
| Sync | 单 WebDAV、多 WebDAV、LAN 均按原始对象字节与原始指纹校验；旧能力客户端明确不支持，不破坏事件与用户状态 |

新增格式先形成身份／修订 ADR 和跨容器样本，明确 WOFF 与对应 SFNT 的逻辑身份、
容器原字节指纹和解码渲染缓存键；不自行改变既有身份算法。支持管理或预览不等于
OS 可以直接安装／启用。独立安装窗口按平台能力禁用相应操作并提供真实原因。
WOFF→TTF／OTF 恢复／转换与转换后的授权呈现保留范围评估，未决前不作为首期必交付。

## 8. Requirement Traceability and Open Decisions

| 需求 | 当前登记位置 | 仍待决定／交付 |
| --- | --- | --- |
| 六种动作、Reference／Managed 生命周期、桌面 Export | Roadmap Product Workflows、B0／B／F1；本文 §2–5 | 各平台文件权限、状态及操作回归 |
| 独立安装窗口 | B0；Linux F1 | macOS 迁出 Sheet、Windows／Linux 新窗口与批次生命周期 |
| Android Provider／Picker／SAF／OTG | D 的隔离 PoC；E 的独立验收矩阵 | ROM／调用方名单与原生服务生命周期实测 |
| Files／Share／两种 Extension | D 的采用 ADR；E 的分项交付 | Share Extension 与 File Provider 是否采用、跨进程写入与凭据设计 |
| Font Health | A1；E／F1 | 文件级明细、统计口径和全部平台恢复闭环 |
| WOFF／WOFF2 | 产品 v2 F2 | 解码／身份 ADR、样本、渲染与全同步格式互操作；转换另议 |
| Online Fonts | F4 | 现有 macOS 浏览／下载的跨端范围、许可展示、来源／镜像可用性验收 |
| iOS 系统字体安装 | D 平台能力评估、E 根据结论呈现 | 不继承 macOS 安装承诺；无平台依据时保留 Files／Share 路径 |
| iCloud／CloudKit | Roadmap Explicit Exclusions | 沿用历史排除，不把它误写成遗漏或待开发能力 |

本轮检索到的上述早期需求均已重新登记；“已规划”不代表实现或实机验收完成。
其余未在仓库与本轮需求中找到依据的设想不扩充为新功能。同步 G–I、冲突／墓碑／
恢复、Smart Collections、Character Map、Hot Reload、赞助 BuildChannel 与现有
Release pipeline 保持最新边界；详细计划不得用本文件的补项替换。

## 9. Primary References

- [SwiftUI WindowGroup](https://developer.apple.com/documentation/swiftui/windowgroup)、
  [Tauri WebviewWindow](https://v2.tauri.app/reference/javascript/api/namespacewebviewwindow/)：窗口承载依据，批次和非阻塞行为是 Folio 产品要求。
- [Android DocumentsProvider](https://developer.android.com/guide/topics/providers/create-document-provider)：原生文件服务与授权；ROM fallback 的可达性需目标设备验证。
- [Apple Share Extension](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html)、
  [File Provider](https://developer.apple.com/documentation/fileprovider)：扩展生命周期；不依赖 RN runtime 是 Folio 的架构约束。
- [fontconfig 开发参考](https://fontconfig.pages.freedesktop.org/fontconfig/fontconfig-devel/)：应用配置与字体服务边界。
- [WOFF 2.0](https://www.w3.org/TR/WOFF2/)：压缩字体容器；不代表平台安装能力。
